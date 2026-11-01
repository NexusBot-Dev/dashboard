import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { login, resetBot, waitForBotCall, botCalls, collectDialogs, guildPath, t } from './support/helpers';
import { APP_URL, FOREIGN_GUILD_ID, GUILD_ID } from './support/env.mjs';

// Fehlermeldungen in der Sprache des Dashboards:
// - fachliche Fehler übersetzt der Bot selbst (dafür bekommt er bei jedem Aufruf `lang`) — sie kommen unverändert an
// - technische Codes der API-Kette (rate_limited, bot_unreachable, …) übersetzt das Dashboard

const en = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../../src/i18n/en.json'), 'utf-8'));

async function useEnglish(context: BrowserContext) {
  await context.addCookies([{ name: 'nexus_lang', value: 'en', url: APP_URL }]);
}

/** POST aus dem Browser heraus — mit dessen Sprache (de-DE), anders als page.request */
async function browserPost(page: Page, url: string, data: unknown) {
  return page.evaluate(async ([u, d]) => {
    const res = await fetch(u as string, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) });
    return { status: res.status, body: await res.json() };
  }, [url, data]);
}

/** Kategorie löschen (Tickets) — die Antwort des Bots legt der Test per resetBot fest */
async function deleteCategory(page: Page) {
  await page.goto(guildPath('tickets/#categories'));
  await page.locator('[data-remove-category="1"]').click();
}

test.beforeEach(async ({ context }) => {
  await resetBot();
  await login(context);
});

test.describe('Sprache an den Bot', () => {
  test('jeder Bot-Aufruf (Seitenaufbau und Aktionen) trägt die Dashboard-Sprache', async ({ page }) => {
    collectDialogs(page);
    await deleteCategory(page);
    await waitForBotCall('tickets/delete-category');

    const calls = await botCalls();
    expect(calls.length).toBeGreaterThan(3);
    // guild/* sind im Dashboard bis zu 30 s gecacht — die übrigen Aufrufe stammen aus diesem Test
    expect(calls.filter((c) => c.body.lang !== 'de').map((c) => c.key)).toEqual([]);
  });

  test('auf Englisch geht lang = en mit', async ({ page, context }) => {
    await useEnglish(context);
    collectDialogs(page);
    await deleteCategory(page);

    await expect.poll(async () => (await botCalls('tickets/delete-category')).length).toBe(1);
    expect((await botCalls('tickets/delete-category'))[0].body.lang).toBe('en');
    expect((await botCalls('tickets/list-categories'))[0].body.lang).toBe('en');
  });
});

test.describe('Fehlermeldungen', () => {
  test('fachlicher Fehler des Bots kommt unverändert an', async ({ page }) => {
    const message = 'Die Kategorie hat noch offene Tickets — bitte zuerst schließen.';
    await resetBot({ 'tickets/delete-category': { status: 400, error: message } });
    const dialogs = collectDialogs(page);
    await deleteCategory(page);

    await expect.poll(() => dialogs).toContain(`${t('common.error_generic')}: ${message}`);
  });

  for (const [label, override, key] of [
    ['Drosselung (429)', { status: 429, error: 'rate_limited' }, 'rate_limited'],
    ['Bot-Fehler (500)', { status: 500, error: 'internal_error' }, 'bot_unreachable'],
    ['Zugriff verweigert (Bot-Middleware)', { status: 403, error: 'guild_access_denied' }, 'guild_access_denied'],
    ['ungültige Anfrage (Bot-Middleware)', { status: 400, error: 'invalid_request' }, 'invalid_request'],
  ] as const) {
    test(`technischer Code wird übersetzt: ${label}`, async ({ page }) => {
      await resetBot({ 'tickets/delete-category': override });
      const dialogs = collectDialogs(page);
      await deleteCategory(page);

      await expect.poll(() => dialogs).toContain(`${t('common.error_generic')}: ${t(`api_errors.${key}`)}`);
    });
  }

  test('unbekannter technischer Code: allgemeine Meldung mit dem Code', async ({ page }) => {
    await resetBot({ 'tickets/delete-category': { status: 400, error: 'something_new' } });
    const dialogs = collectDialogs(page);
    await deleteCategory(page);

    await expect.poll(() => dialogs).toContain(`${t('common.error_generic')}: ${t('api_errors.unknown', { code: 'something_new' })}`);
  });

  test('auf Englisch: technischer Code auf Englisch', async ({ page, context }) => {
    await useEnglish(context);
    await resetBot({ 'tickets/delete-category': { status: 429, error: 'rate_limited' } });
    const dialogs = collectDialogs(page);
    await deleteCategory(page);

    await expect.poll(() => dialogs).toContain(`${en.common.error_generic}: ${en.api_errors.rate_limited}`);
  });

  test('Middleware: fremder Server liefert eine übersetzte Meldung statt "forbidden"', async ({ page }) => {
    await page.goto(guildPath(''));
    const res = await browserPost(page, `/api/server/${FOREIGN_GUILD_ID}/module/tickets/delete-category/`, { category_id: 1 });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe(t('api_errors.forbidden'));
    expect(await botCalls('tickets/delete-category')).toHaveLength(0);
  });

  test('Settings-Proxy: technischer Code des Bots wird übersetzt', async ({ page }) => {
    await resetBot({ settings: { status: 429, error: 'rate_limited' } });
    await page.goto(guildPath(''));
    const res = await browserPost(page, `/api/server/${GUILD_ID}/settings/`, { locale: 'de' });
    expect(res.body.error).toBe(t('api_errors.rate_limited'));
  });

  test('Sprachwechsel fehlgeschlagen: Meldung in der aktuellen Sprache', async ({ page }) => {
    await page.route('**/api/set-lang/', (route) => route.fulfill({ status: 500, body: '{}' }));
    const dialogs = collectDialogs(page);
    await page.goto(guildPath(''));
    await page.locator('#lang-switcher-btn').click();
    await page.locator('[data-lang-option="en"]').click();

    await expect.poll(() => dialogs).toEqual([t('common.lang_change_failed')]);
  });
});
