import { test, expect, type Page } from '@playwright/test';
import { login, resetBot, waitForBotCall, botCalls, collectDialogs, guildPath, t } from './support/helpers';
import { defaultBotData } from './support/fixtures.mjs';
import { GUILD_ID } from './support/env.mjs';

// Moderation: Übersicht der Bans und Timeouts mit Suche, Entbannen und Timeout aufheben.

const PAGE = guildPath('moderation/');
const XSS = '<img src=x onerror="window.__xss=1">';
const [MAX, ERIKA] = defaultBotData['moderation/list-bans'].bans;
const TIM = '600000000000000001';

const section = (page: Page, key: 'bans' | 'timeouts') =>
  page.locator('section').filter({ has: page.locator(`[data-search="${key}"]`) });
const row = (page: Page, userId: string) => page.locator('[data-search-value]').filter({ hasText: userId });
const search = (page: Page, key: 'bans' | 'timeouts') => page.locator(`[data-search="${key}"]`);
const emptySearch = (page: Page, key: 'bans' | 'timeouts') => page.locator(`[data-empty-search="${key}"]`);
const count = (n: number) => `${n} ${n === 1 ? t('moderation.entry_singular') : t('moderation.entry_plural')}`;
const expectNoXss = async (page: Page) => expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();

test.beforeEach(async ({ context }) => {
  await resetBot();
  await login(context);
});

test.describe('Übersicht', () => {
  test('zeigt gebannte Mitglieder mit Grund und Zähler', async ({ page }) => {
    await page.goto(PAGE);
    await expect(section(page, 'bans')).toContainText(count(2));
    await expect(row(page, MAX.user_id)).toContainText('max_mustermann');
    await expect(row(page, MAX.user_id)).toContainText('Spam in #support');
    await expect(row(page, ERIKA.user_id)).toContainText(t('moderation.no_reason'));
  });

  test('zeigt Timeouts mit Restzeit in Minuten, Stunden und Tagen', async ({ page }) => {
    await page.goto(PAGE);
    await expect(section(page, 'timeouts')).toContainText(count(3));
    await expect(row(page, TIM)).toContainText(t('moderation.remaining_minutes', { mins: 30 }));
    await expect(row(page, '600000000000000002')).toContainText(t('moderation.remaining_hours', { hours: 2 }));
    await expect(row(page, '600000000000000003')).toContainText(t('moderation.remaining_days', { days: 3 }));
  });

  test('ohne Avatar wird der Standard-Avatar von Discord genutzt', async ({ page }) => {
    await page.goto(PAGE);
    const idx = Number(BigInt(ERIKA.user_id) % 6n);
    await expect(row(page, ERIKA.user_id).locator('img')).toHaveAttribute('src', `https://cdn.discordapp.com/embed/avatars/${idx}.png`);
    await expect(row(page, MAX.user_id).locator('img')).toHaveAttribute('src', MAX.avatar_url!);
  });

  test('Namen und Gründe bleiben Text', async ({ page }) => {
    await resetBot({
      'moderation/list-bans': { data: { bans: [{ ...MAX, username: `Name ${XSS}`, reason: `Grund ${XSS}` }] } },
    });
    await page.goto(PAGE);
    await expect(row(page, MAX.user_id)).toContainText(`Name ${XSS}`);
    await expect(row(page, MAX.user_id)).toContainText(`Grund ${XSS}`);
    await expect(row(page, MAX.user_id).locator('img')).toHaveCount(1); // nur der Avatar
    await expectNoXss(page);
  });

  test('leere Listen zeigen einen Hinweis', async ({ page }) => {
    await resetBot({ 'moderation/list-bans': { data: { bans: [] } }, 'moderation/list-timeouts': { data: { timeouts: [] } } });
    await page.goto(PAGE);
    await expect(page.getByText(t('moderation.no_bans'))).toBeVisible();
    await expect(page.getByText(t('moderation.no_timeouts'))).toBeVisible();
    await expect(section(page, 'bans')).toContainText(count(0));
    await expect(page.getByText(t('moderation.data_unavailable'))).toHaveCount(0);
  });

  test('ohne Bot-Daten erscheint der Hinweis', async ({ page }) => {
    await resetBot({
      'moderation/list-bans': { status: 500, error: 'internal_error' },
      'moderation/list-timeouts': { status: 500, error: 'internal_error' },
    });
    await page.goto(PAGE);
    await expect(page.getByText(t('moderation.data_unavailable'))).toBeVisible();
    await expect(page.locator('[data-search-value]')).toHaveCount(0);
  });
});

test.describe('Suche', () => {
  test('filtert nach Username und ID, ohne Groß-/Kleinschreibung', async ({ page }) => {
    await page.goto(PAGE);
    await search(page, 'bans').fill('MAX');
    await expect(row(page, MAX.user_id)).toBeVisible();
    await expect(row(page, ERIKA.user_id)).toBeHidden();

    await search(page, 'bans').fill(ERIKA.user_id);
    await expect(row(page, ERIKA.user_id)).toBeVisible();
    await expect(row(page, MAX.user_id)).toBeHidden();

    // Die Suche wirkt nur auf ihre eigene Liste
    await expect(row(page, TIM)).toBeVisible();
  });

  test('ohne Treffer erscheint ein Hinweis, Leeren zeigt wieder alles', async ({ page }) => {
    await page.goto(PAGE);
    await search(page, 'timeouts').fill('niemand');
    await expect(emptySearch(page, 'timeouts')).toBeVisible();
    await expect(page.locator('[data-list="timeouts"] [data-search-value]:visible')).toHaveCount(0);

    await search(page, 'timeouts').fill('');
    await expect(emptySearch(page, 'timeouts')).toBeHidden();
    await expect(page.locator('[data-list="timeouts"] [data-search-value]:visible')).toHaveCount(3);
    await expect(emptySearch(page, 'bans')).toBeHidden();
  });
});

test.describe('Aktionen', () => {
  test('Entbannen: Rückfrage, Payload, Zeile verschwindet', async ({ page }) => {
    const dialogs = collectDialogs(page);
    await page.goto(PAGE);
    await row(page, MAX.user_id).locator('[data-unban]').click();
    expect(await waitForBotCall('moderation/unban')).toMatchObject({ user_id: MAX.user_id });
    expect(dialogs).toEqual([t('moderation.confirm_unban')]);
    await expect(row(page, MAX.user_id)).toHaveCount(0);
    await expect(row(page, ERIKA.user_id)).toBeVisible();
  });

  test('Entbannen abgebrochen: nichts wird gesendet', async ({ page }) => {
    const dialogs = collectDialogs(page, { accept: false });
    await page.goto(PAGE);
    await row(page, MAX.user_id).locator('[data-unban]').click();
    await expect.poll(() => dialogs.length).toBe(1);
    await page.waitForTimeout(300);
    expect(await botCalls('moderation/unban')).toHaveLength(0);
    await expect(row(page, MAX.user_id)).toBeVisible();
  });

  test('Fehler des Bots wird angezeigt, Zeile bleibt und der Button ist wieder bedienbar', async ({ page }) => {
    await resetBot({ 'moderation/unban': { status: 400, error: 'User ist nicht gebannt' } });
    const dialogs = collectDialogs(page);
    await page.goto(PAGE);
    const btn = row(page, MAX.user_id).locator('[data-unban]');
    await btn.click();
    await expect.poll(() => dialogs.join('\n')).toContain('User ist nicht gebannt');
    await expect(row(page, MAX.user_id)).toBeVisible();
    await expect(btn).toBeEnabled();
  });

  test('Timeout aufheben: Rückfrage, Payload, Zeile verschwindet', async ({ page }) => {
    const dialogs = collectDialogs(page);
    await page.goto(PAGE);
    await row(page, TIM).locator('[data-remove-timeout]').click();
    expect(await waitForBotCall('moderation/remove-timeout')).toMatchObject({ user_id: TIM });
    expect(dialogs).toEqual([t('moderation.confirm_remove_timeout')]);
    await expect(row(page, TIM)).toHaveCount(0);
  });
});

test.describe('Anzeige nach Änderungen', () => {
  test('Zähler passt sich nach dem Entbannen an', async ({ page }) => {
    collectDialogs(page);
    await page.goto(PAGE);
    await row(page, MAX.user_id).locator('[data-unban]').click();
    await expect(row(page, MAX.user_id)).toHaveCount(0);
    await expect(section(page, 'bans')).toContainText(count(1), { timeout: 2000 });
  });

  test('nach dem letzten Timeout erscheint der Leer-Hinweis', async ({ page }) => {
    await resetBot({ 'moderation/list-timeouts': { data: { timeouts: [{ user_id: TIM, username: 'Tim', avatar_url: null, until: '2099-01-01T00:00:00Z' }] } } });
    collectDialogs(page);
    await page.goto(PAGE);
    await row(page, TIM).locator('[data-remove-timeout]').click();
    await expect(row(page, TIM)).toHaveCount(0);
    await expect(page.getByText(t('moderation.no_timeouts'))).toBeVisible({ timeout: 2000 });
  });

  test('Suche nach einem gerade Entbannten zeigt „Keine Treffer“', async ({ page }) => {
    collectDialogs(page);
    await page.goto(PAGE);
    await row(page, MAX.user_id).locator('[data-unban]').click();
    await expect(row(page, MAX.user_id)).toHaveCount(0);
    await search(page, 'bans').fill('max');
    await expect(emptySearch(page, 'bans')).toBeVisible({ timeout: 2000 });
  });

  test('fällt eine Liste aus, wird die andere trotzdem angezeigt', async ({ page }) => {
    await resetBot({ 'moderation/list-bans': { status: 500, error: 'internal_error' } });
    await page.goto(PAGE);
    await expect(row(page, TIM)).toBeVisible({ timeout: 2000 });
    // Die ausgefallene Liste darf nicht behaupten, es gäbe keine Bans
    await expect(page.getByText(t('moderation.no_bans'))).toBeHidden();
    await expect(section(page, 'bans')).toContainText(t('moderation.list_unavailable'));
  });
});

test.describe('Navigation ohne Neuladen (ClientRouter)', () => {
  const sidebarLink = (page: Page, sub: string) => page.locator(`aside a[href="/server/${GUILD_ID}/${sub}"]`).first();

  test('mehrfach hin und zurück: Suche geht, Entbannen wird genau einmal gesendet', async ({ page }) => {
    const dialogs = collectDialogs(page);
    await page.goto(guildPath(''));
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => ((window as any).__noReload = true));
      await sidebarLink(page, 'moderation/').click();
      await expect(search(page, 'bans')).toBeVisible();
      await sidebarLink(page, '').click();
      await expect(page).toHaveURL(new RegExp(`/server/${GUILD_ID}/$`));
    }
    await sidebarLink(page, 'moderation/').click();
    await expect(search(page, 'bans')).toBeVisible();
    expect(await page.evaluate(() => (window as any).__noReload)).toBe(true);

    await search(page, 'bans').fill('erika');
    await expect(row(page, MAX.user_id)).toBeHidden();
    await search(page, 'bans').fill('');

    await row(page, MAX.user_id).locator('[data-unban]').click();
    await waitForBotCall('moderation/unban');
    await page.waitForTimeout(500); // etwaige doppelte Aufrufe abwarten
    expect(await botCalls('moderation/unban')).toHaveLength(1);
    expect(dialogs).toHaveLength(1);
  });
});
