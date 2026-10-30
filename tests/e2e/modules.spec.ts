import { test, expect, type Page } from '@playwright/test';
import { login, resetBot, waitForBotCall, botCalls, collectDialogs, guildPath, t, dbQuery } from './support/helpers';
import { FOREIGN_GUILD_ID, GUILD_ID } from './support/env.mjs';

// Die Modul-Übersicht liest den Schalter-Stand direkt aus guild_settings.modules; gespeichert wird über den Bot.

const PAGE = guildPath('modules/');

// Entspricht dem DB-Standardwert der Spalte modules
const DEFAULT_MODULES = {
  moderation: true, levels: false, welcome: false, reaction_roles: false, boosts: false,
  embeds: false, automod: false, stream_alerts: true, tickets: true,
};

async function setModules(values: Partial<typeof DEFAULT_MODULES> = {}) {
  await dbQuery('UPDATE guild_settings SET modules = ? WHERE guild_id = ?', [
    JSON.stringify({ ...DEFAULT_MODULES, ...values }), GUILD_ID,
  ]);
}

const card = (page: Page, key: string) => page.locator(`[data-module-card="${key}"]`);
const toggle = (page: Page, key: string) => card(page, key).locator('[data-module-toggle]');
// Sichtbarer Badge-Text (innerText, CSS schreibt ihn in Großbuchstaben)
const expectBadge = (page: Page, key: string, enabled: boolean) =>
  expect(card(page, key).locator('[data-module-badge]')).toHaveText(
    new RegExp(`^${t(enabled ? 'settings.active_badge' : 'settings.inactive_badge')}$`, 'i'), { useInnerText: true },
  );
const saveBar = (page: Page) => page.locator('#save-bar');

test.beforeEach(async ({ context }) => {
  await resetBot();
  await setModules();
  await login(context);
});

test.afterAll(async () => {
  await setModules();
});

test.describe('Anzeige', () => {
  test('zeigt jedes Modul mit Stand aus der DB', async ({ page }) => {
    await setModules({ levels: true, tickets: false });
    await page.goto(PAGE);

    await expect(toggle(page, 'levels')).toHaveAttribute('aria-checked', 'true');
    await expectBadge(page, 'levels', true);
    await expect(toggle(page, 'tickets')).toHaveAttribute('aria-checked', 'false');
    await expectBadge(page, 'tickets', false);
    await expect(toggle(page, 'stream_alerts')).toHaveAttribute('aria-checked', 'true');
    await expect(saveBar(page)).toBeHidden();
  });

  test('Links führen zur jeweiligen Seite, Tickets auf die eigene Top-Level-Seite', async ({ page }) => {
    await page.goto(PAGE);
    await expect(card(page, 'reaction_roles').locator('a').first())
      .toHaveAttribute('href', `/server/${GUILD_ID}/modules/reaction-roles/`);
    await expect(card(page, 'stream_alerts').locator('a').first())
      .toHaveAttribute('href', `/server/${GUILD_ID}/modules/stream-alerts/`);
    await expect(card(page, 'tickets').locator('a').first()).toHaveAttribute('href', `/server/${GUILD_ID}/tickets/`);
  });
});

test.describe('Schalten', () => {
  test('Speicherleiste zählt die Änderungen, Zurückschalten nimmt sie wieder raus', async ({ page }) => {
    await page.goto(PAGE);
    await toggle(page, 'levels').click();
    await expect(saveBar(page)).toBeVisible();
    await expect(page.locator('#save-status')).toHaveText(t('modules.changes_count_singular', { count: 1 }));

    await toggle(page, 'tickets').click();
    await expect(page.locator('#save-status')).toHaveText(t('modules.changes_count_plural', { count: 2 }));

    await toggle(page, 'levels').click();
    await toggle(page, 'tickets').click();
    await expect(saveBar(page)).toBeHidden();
  });

  test('Verwerfen stellt alle Schalter zurück, ohne etwas zu senden', async ({ page }) => {
    await page.goto(PAGE);
    await toggle(page, 'levels').click();
    await toggle(page, 'tickets').click();
    await page.locator('#discard-btn').click();

    await expect(toggle(page, 'levels')).toHaveAttribute('aria-checked', 'false');
    await expect(toggle(page, 'tickets')).toHaveAttribute('aria-checked', 'true');
    await expect(saveBar(page)).toBeHidden();
    expect(await botCalls('modules/toggle')).toHaveLength(0);
  });

  test('Speichern schickt nur die geänderten Module als Boolean', async ({ page }) => {
    await page.goto(PAGE);
    await toggle(page, 'levels').click();
    await toggle(page, 'tickets').click();
    await page.locator('#save-btn').click();

    expect((await waitForBotCall('modules/toggle')).changes).toEqual({ levels: true, tickets: false });
    await expect(page.locator('#save-status')).toHaveText(t('settings.saved'));
    await expect(saveBar(page)).toBeHidden();

    // Gespeicherter Stand ist der neue Ausgangswert
    await toggle(page, 'welcome').click();
    await page.locator('#save-btn').click();
    expect((await waitForBotCall('modules/toggle', 1)).changes).toEqual({ welcome: true });
  });

  test('nach dem Speichern zeigt das Badge den neuen Stand', async ({ page }) => {
    await page.goto(PAGE);
    await toggle(page, 'levels').click();
    await toggle(page, 'tickets').click();
    await expectBadge(page, 'levels', false); // erst nach dem Speichern
    await page.locator('#save-btn').click();
    await waitForBotCall('modules/toggle');
    await expect(saveBar(page)).toBeHidden();
    await expectBadge(page, 'levels', true);
    await expectBadge(page, 'tickets', false);
  });

  test('Fehler des Bots wird angezeigt, Änderungen bleiben offen', async ({ page }) => {
    await resetBot({ 'modules/toggle': { status: 400, error: 'Unbekanntes Modul: levels' } });
    const dialogs = collectDialogs(page);
    await page.goto(PAGE);
    await toggle(page, 'levels').click();
    await page.locator('#save-btn').click();

    await expect.poll(() => dialogs).toContain(t('welcome.server_error_prefix') + 'Unbekanntes Modul: levels');
    await expect(saveBar(page)).toBeVisible();
    await expect(toggle(page, 'levels')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#save-btn')).toBeEnabled();
    await expect(page.locator('#save-btn')).toHaveText(t('modules.save_changes_btn'));
  });
});

test.describe('API-Proxy', () => {
  test('fremder Server: Schalten wird abgewiesen und erreicht den Bot nicht', async ({ page }) => {
    await page.goto(PAGE);
    const res = await page.request.post(`/api/server/${FOREIGN_GUILD_ID}/module/modules/toggle/`, {
      data: { changes: { levels: true } },
    });
    expect(res.status()).toBe(403);
    expect(await botCalls('modules/toggle')).toHaveLength(0);
  });
});

test.describe('Navigation ohne Neuladen (ClientRouter)', () => {
  const sidebarLink = (page: Page, sub: string) => page.locator(`aside a[href="/server/${GUILD_ID}/${sub}"]`).first();

  async function navigateToModules(page: Page) {
    await page.evaluate(() => ((window as any).__noReload = true));
    await sidebarLink(page, 'modules/').click();
    await expect(page).toHaveURL(new RegExp(`/server/${GUILD_ID}/modules/$`));
    await expect(page.locator('#modules-grid')).toBeVisible();
    expect(await page.evaluate(() => (window as any).__noReload)).toBe(true);
  }

  test('mehrfach hin und zurück: Speichern wird genau einmal gesendet', async ({ page }) => {
    await page.goto(guildPath(''));
    for (let i = 0; i < 3; i++) {
      await navigateToModules(page);
      await sidebarLink(page, '').click();
      await expect(page).toHaveURL(new RegExp(`/server/${GUILD_ID}/$`));
    }
    await navigateToModules(page);

    await toggle(page, 'levels').click();
    await expect(page.locator('#save-status')).toHaveText(t('modules.changes_count_singular', { count: 1 }));
    await page.locator('#save-btn').click();
    expect((await waitForBotCall('modules/toggle')).changes).toEqual({ levels: true });
    await page.waitForTimeout(500); // etwaige doppelte Aufrufe abwarten
    expect(await botCalls('modules/toggle')).toHaveLength(1);
  });
});
