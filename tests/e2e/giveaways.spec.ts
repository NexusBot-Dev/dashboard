import { test, expect, type Page } from '@playwright/test';
import { login, resetBot, waitForBotCall, botCalls, collectDialogs, guildPath, t, dbQuery } from './support/helpers';
import { CHANNELS, defaultBotData } from './support/fixtures.mjs';
import { GUILD_ID } from './support/env.mjs';

// Giveaways: neues Giveaway starten, laufende abbrechen, Verlauf ansehen.
// Die Zeitzone liest die Seite direkt aus der DB.

const PAGE = guildPath('giveaways/');
const XSS = '<img src=x onerror="window.__xss=1">';
const list = defaultBotData['giveaways/list'];
const [ACTIVE] = list.active;

const section = (page: Page, titleKey: string) => page.locator('section').filter({ has: page.getByRole('heading', { name: t(titleKey) }) });
const activeSection = (page: Page) => section(page, 'giveaways.active_title');
const historySection = (page: Page) => section(page, 'giveaways.history_title');
const form = (page: Page) => page.locator('[data-giveaway-form]');
const submitBtn = (page: Page) => form(page).locator('[type="submit"]');
const formError = (page: Page) => form(page).locator('[data-form-error]');
const preview = (page: Page) => page.locator('#gw-description-preview');
const expectNoXss = async (page: Page) => expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();

const setTimezone = (tz: string) => dbQuery('UPDATE guild_settings SET timezone = ? WHERE guild_id = ?', [tz, GUILD_ID]);

/** Merker im window — verschwindet, sobald die Seite neu lädt */
const markPage = (page: Page) => page.evaluate(() => ((window as any).__marker = true));
// Mitten im Neuladen wirft evaluate („Execution context was destroyed“) — dann einfach weiter abfragen
const expectReloaded = (page: Page) =>
  expect.poll(() => page.evaluate(() => (window as any).__marker).catch(() => 'lädt neu')).toBeUndefined();

async function fillForm(page: Page, values: { prize?: string; description?: string; channel?: string; winners?: string; date?: string; time?: string }) {
  if (values.prize !== undefined) await page.locator('#gw-prize').fill(values.prize);
  if (values.description !== undefined) await page.locator('#gw-description').fill(values.description);
  if (values.channel !== undefined) await page.locator('#gw-channel').selectOption(values.channel);
  if (values.winners !== undefined) await page.locator('#gw-winners').fill(values.winners);
  if (values.date !== undefined) await page.locator('#gw-date').fill(values.date);
  if (values.time !== undefined) await page.locator('#gw-time').fill(values.time);
}

const VALID = { prize: 'Nitro', channel: CHANNELS[1].id, winners: '3', date: '2030-01-02', time: '18:30' };

test.beforeEach(async ({ context }) => {
  await resetBot();
  await setTimezone('Europe/Berlin');
  await login(context);
});

test.afterAll(async () => {
  await setTimezone('UTC');
});

test.describe('Übersicht', () => {
  test('laufendes Giveaway: Preis, Channel, Endzeit in Server-Zeitzone, Zahlen, Link', async ({ page }) => {
    await page.goto(PAGE);
    const row = activeSection(page).locator('[data-giveaway]');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('🎉 Nitro');
    await expect(row).toContainText(`#${CHANNELS[0].name}`);
    // 12:45 UTC = 13:45 in Berlin (Winterzeit)
    await expect(row).toContainText(`${t('giveaways.ends')} 02.01.2030, 13:45`);
    await expect(row).toContainText(`${t('giveaways.participants')}: 17`);
    await expect(row).toContainText(`${t('giveaways.winners')}: 2`);
    const link = row.getByRole('link', { name: t('giveaways.open_in_discord') });
    await expect(link).toHaveAttribute('href', ACTIVE.message_url);
    await expect(link).toHaveAttribute('target', '_blank');
  });

  test('Verlauf: Status als Badge, Anzahl im Kopf', async ({ page }) => {
    await page.goto(PAGE);
    await expect(historySection(page)).toContainText('Steam-Key');
    await expect(historySection(page)).toContainText(t('giveaways.status_ended'));
    await expect(historySection(page)).toContainText('Merch');
    await expect(historySection(page)).toContainText(t('giveaways.status_cancelled'));
    await expect(historySection(page).locator('h2 + span')).toHaveText('2');
    await expect(activeSection(page).locator('h2 + span')).toHaveText('1');
  });

  test('Channel ohne Namen (gelöscht) zeigt einen Strich', async ({ page }) => {
    await resetBot({ 'giveaways/list': { data: { ...list, active: [{ ...ACTIVE, channel_name: null }] } } });
    await page.goto(PAGE);
    await expect(activeSection(page).locator('[data-giveaway]')).toContainText(`– · ${t('giveaways.ends')}`);
  });

  test('leere Listen zeigen Hinweise', async ({ page }) => {
    await resetBot({ 'giveaways/list': { data: { ...list, active: [], history: [] } } });
    await page.goto(PAGE);
    await expect(page.getByText(t('giveaways.no_active'))).toBeVisible();
    await expect(page.getByText(t('giveaways.no_history'))).toBeVisible();
  });

  test('Preise bleiben Text', async ({ page }) => {
    await resetBot({
      'giveaways/list': {
        data: { ...list, active: [{ ...ACTIVE, prize: `Aktiv ${XSS}` }], history: [{ ...list.history[0], prize: `Alt ${XSS}` }] },
      },
    });
    await page.goto(PAGE);
    await expect(activeSection(page)).toContainText(`Aktiv ${XSS}`);
    await expect(historySection(page)).toContainText(`Alt ${XSS}`);
    await expect(page.locator('main img, section img')).toHaveCount(0);
    await expectNoXss(page);
  });

  test('ohne Bot-Daten erscheint der Hinweis und Starten ist gesperrt', async ({ page }) => {
    await resetBot({ 'giveaways/list': { status: 500, error: 'internal_error' } });
    await page.goto(PAGE);
    await expect(page.getByText(t('giveaways.data_unavailable'))).toBeVisible();
    await expect(submitBtn(page)).toBeDisabled();
  });

  test('Formular nutzt die Grenzen des Bots und die Zeitzone des Servers', async ({ page }) => {
    await resetBot({ 'giveaways/list': { data: { ...list, limits: { max_prize: 50, max_description: 500, max_winners: 7 } } } });
    await page.goto(PAGE);
    await expect(page.locator('#gw-prize')).toHaveAttribute('maxlength', '50');
    await expect(page.locator('#gw-description')).toHaveAttribute('maxlength', '500');
    await expect(page.locator('#gw-winners')).toHaveAttribute('max', '7');
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
    await expect(page.locator('#gw-date')).toHaveAttribute('min', today);
    await expect(page.getByText(t('giveaways.end_time_hint', { timezone: 'Europe/Berlin' }))).toBeVisible();
  });
});

test.describe('Neues Giveaway', () => {
  test('Starten: Payload, danach lädt die Seite neu', async ({ page }) => {
    await page.goto(PAGE);
    await markPage(page);
    await fillForm(page, { ...VALID, description: '**Gewinne** etwas' });
    await submitBtn(page).click();
    expect(await waitForBotCall('giveaways/create')).toMatchObject({
      prize: 'Nitro', description: '**Gewinne** etwas', channel_id: CHANNELS[1].id,
      end_time: '2030-01-02T18:30', winners_count: '3',
    });
    await expectReloaded(page);
  });

  test('Pflichtfelder fehlen: nichts wird gesendet', async ({ page }) => {
    await page.goto(PAGE);
    await fillForm(page, { ...VALID, prize: '' });
    await submitBtn(page).click();
    await fillForm(page, { prize: 'Nitro', time: '' });
    await submitBtn(page).click();
    await page.waitForTimeout(300);
    expect(await botCalls('giveaways/create')).toHaveLength(0);
  });

  test('Fehler des Bots erscheint unter dem Formular, kein Neuladen', async ({ page }) => {
    await resetBot({ 'giveaways/create': { status: 400, error: 'Die Endzeit liegt in der Vergangenheit' } });
    await page.goto(PAGE);
    await markPage(page);
    await fillForm(page, VALID);
    await submitBtn(page).click();
    await expect(formError(page)).toHaveText(`${t('common.error_generic')}: Die Endzeit liegt in der Vergangenheit`);
    await expect(submitBtn(page)).toBeEnabled();
    expect(await page.evaluate(() => (window as any).__marker)).toBe(true);

    // Beim nächsten Versuch verschwindet die alte Meldung
    await resetBot();
    await submitBtn(page).click();
    await waitForBotCall('giveaways/create');
    await expectReloaded(page);
  });

  test('Vorschau rendert Markdown, HTML bleibt Text, leer zeigt einen Strich', async ({ page }) => {
    await page.goto(PAGE);
    await expect(preview(page)).toHaveText('—');
    await page.locator('#gw-description').fill(`**fett** ${XSS}`);
    await expect(preview(page).locator('strong')).toHaveText('fett');
    await expect(preview(page)).toContainText(XSS);
    await expect(preview(page).locator('img')).toHaveCount(0);
    await page.locator('#gw-description').fill('   ');
    await expect(preview(page)).toHaveText('—');
    await expectNoXss(page);
  });

  test('Toolbar formatiert die Auswahl', async ({ page }) => {
    await page.goto(PAGE);
    const textarea = page.locator('#gw-description');
    await textarea.fill('Hallo Welt');
    await textarea.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(6, 10));
    await page.locator('[data-md-toolbar="gw-description"] [data-md="bold"]').click();
    await expect(textarea).toHaveValue('Hallo **Welt**');
    await expect(preview(page).locator('strong')).toHaveText('Welt');
  });
});

test.describe('Abbrechen', () => {
  test('Rückfrage, Payload, danach lädt die Seite neu', async ({ page }) => {
    const dialogs = collectDialogs(page);
    await page.goto(PAGE);
    await markPage(page);
    await page.locator('[data-cancel-giveaway]').click();
    expect(await waitForBotCall('giveaways/cancel')).toMatchObject({ id: 1 });
    expect(dialogs).toEqual([t('giveaways.confirm_cancel')]);
    await expectReloaded(page);
  });

  test('Rückfrage verneint: nichts wird gesendet', async ({ page }) => {
    const dialogs = collectDialogs(page, { accept: false });
    await page.goto(PAGE);
    await page.locator('[data-cancel-giveaway]').click();
    await expect.poll(() => dialogs.length).toBe(1);
    await page.waitForTimeout(300);
    expect(await botCalls('giveaways/cancel')).toHaveLength(0);
  });

  test('Fehler des Bots: Meldung, Button wieder bedienbar', async ({ page }) => {
    await resetBot({ 'giveaways/cancel': { status: 400, error: 'Giveaway nicht gefunden oder bereits beendet' } });
    const dialogs = collectDialogs(page);
    await page.goto(PAGE);
    await page.locator('[data-cancel-giveaway]').click();
    await expect.poll(() => dialogs.join('\n')).toContain('Giveaway nicht gefunden oder bereits beendet');
    await expect(page.locator('[data-cancel-giveaway]')).toBeEnabled();
  });
});

test.describe('Verlauf', () => {
  test('langer Verlauf zeigt unten einen Schatten, solange weiter gescrollt werden kann', async ({ page }) => {
    const history = Array.from({ length: 15 }, (_, i) => ({ ...list.history[0], id: 100 + i, prize: `Preis ${i}` }));
    await resetBot({ 'giveaways/list': { data: { ...list, history } } });
    await page.goto(PAGE);
    const historyList = page.locator('[data-list="history"]');
    await expect(historyList).toHaveClass(/scroll-fade/, { timeout: 2000 });
    await historyList.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await expect(historyList).not.toHaveClass(/scroll-fade/);
  });
});

test.describe('Navigation ohne Neuladen (ClientRouter)', () => {
  const sidebarLink = (page: Page, sub: string) => page.locator(`aside a[href="/server/${GUILD_ID}/${sub}"]`).first();

  test('mehrfach hin und zurück: Toolbar und Abbrechen wirken genau einmal', async ({ page }) => {
    collectDialogs(page);
    await page.goto(guildPath(''));
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => ((window as any).__noReload = true));
      await sidebarLink(page, 'giveaways/').click();
      await expect(form(page)).toBeVisible();
      await sidebarLink(page, '').click();
      await expect(page).toHaveURL(new RegExp(`/server/${GUILD_ID}/$`));
    }
    await sidebarLink(page, 'giveaways/').click();
    await expect(form(page)).toBeVisible();
    expect(await page.evaluate(() => (window as any).__noReload)).toBe(true);

    const textarea = page.locator('#gw-description');
    await textarea.fill('x');
    await textarea.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(0, 1));
    await page.locator('[data-md-toolbar="gw-description"] [data-md="bold"]').click();
    await expect(textarea).toHaveValue('**x**');
    await expect(preview(page).locator('strong')).toHaveText('x');

    await page.locator('[data-cancel-giveaway]').click();
    await waitForBotCall('giveaways/cancel');
    await page.waitForTimeout(500); // etwaige doppelte Aufrufe abwarten
    expect(await botCalls('giveaways/cancel')).toHaveLength(1);
  });
});
