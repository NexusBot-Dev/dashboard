import { test, expect, type Page } from '@playwright/test';
import { login, resetBot, waitForBotCall, botCalls, collectDialogs, guildPath, t } from './support/helpers';

// Glocke im Header (src/components/TopHeader.astro, Bot: dashboard/health.py): Hinweise „Gelesen“ ausblenden.
// Ausgeblendete zählen nicht mehr, stehen eingeklappt unter „Ausgeblendet (n)“ und lassen sich zurückholen.

const PAGE = guildPath('');
const KEY_WARN = 'a'.repeat(32);
const KEY_ERROR = 'b'.repeat(32);
const KEY_INFO = 'c'.repeat(32);

const issue = (key: string, severity: string, text: string, dismissed = false) => ({ key, section: 'perms', severity, text, dismissed });
const WARN = issue(KEY_WARN, 'warn', 'Fehlende Rechte: `Attach Files`');
const ERROR = issue(KEY_ERROR, 'error', 'Log-Channel: Kanal existiert nicht mehr', true);
const INFO = issue(KEY_INFO, 'info', 'Rollen mit Mod-Rechten stehen über Nexus: @Admin');
const health = (...issues: unknown[]) => ({ data: { issues } });

const bell = (page: Page) => page.locator('#notifications-btn');
const badge = (page: Page) => page.locator('#notifications-badge');
const row = (page: Page, key: string) => page.locator(`#notifications-list [data-issue-key="${key}"]`);
const hidden = (page: Page) => page.locator('#notifications-hidden');
const payload = ({ acting_user_id: _u, guild_id: _g, lang: _l, ...rest }: Record<string, unknown>) => rest;

test.beforeEach(async ({ context }) => {
  await login(context);
});

test('Zähler ohne Ausgeblendete und ohne Info; Ausgeblendetes eingeklappt unten', async ({ page }) => {
  await resetBot({ 'guild/health-issues': health(WARN, ERROR, INFO) });
  await page.goto(PAGE);

  await expect(badge(page)).toHaveText('1');   // nur die Warnung: Fehler ist ausgeblendet, Info zählt nie
  await bell(page).click();
  await expect(row(page, KEY_WARN)).toContainText('Fehlende Rechte');
  await expect(row(page, KEY_WARN).getByRole('button')).toHaveText(t('notifications.dismiss'));
  await expect(row(page, KEY_WARN).getByRole('button')).toHaveAttribute('title', t('notifications.dismiss_title'));
  await expect(row(page, KEY_INFO).getByRole('button')).toHaveText(t('notifications.dismiss'));

  await expect(hidden(page).locator('summary')).toHaveText(t('notifications.hidden', { count: 1 }));
  await expect(row(page, KEY_ERROR)).toBeHidden();   // eingeklappt
  await hidden(page).locator('summary').click();
  await expect(row(page, KEY_ERROR)).toBeVisible();
  await expect(row(page, KEY_ERROR).getByRole('button')).toHaveText(t('notifications.restore'));
});

test('„Gelesen“ blendet aus und speichert beim Bot', async ({ page }) => {
  await resetBot({
    'guild/health-issues': health(WARN, INFO),
    'guild/health-dismiss': health({ ...WARN, dismissed: true }, INFO),
  });
  await page.goto(PAGE);
  await expect(badge(page)).toHaveText('1');
  await bell(page).click();

  await row(page, KEY_WARN).getByRole('button').click();
  expect(payload(await waitForBotCall('guild/health-dismiss'))).toEqual({ key: KEY_WARN });

  await expect(badge(page)).toBeHidden();
  await expect(page.locator('#notifications-dropdown')).toBeVisible();   // bleibt offen
  await expect(hidden(page).locator('summary')).toHaveText(t('notifications.hidden', { count: 1 }));
  await expect(page.locator('#notifications-list')).not.toContainText(t('notifications.empty'));   // Info steht noch da

  // Nach dem Neuladen gilt der neue Stand (Zwischenspeicher wurde aktualisiert, kein veralteter Zähler)
  await page.reload();
  await expect(badge(page)).toBeHidden();
});

test('„Wieder anzeigen“ holt den Hinweis zurück; aufgeklappt bleibt aufgeklappt', async ({ page }) => {
  await resetBot({
    'guild/health-issues': health(WARN, ERROR),
    'guild/health-restore': health(WARN, { ...ERROR, dismissed: false }, { ...INFO, dismissed: true }),
  });
  await page.goto(PAGE);
  await bell(page).click();
  await hidden(page).locator('summary').click();

  await row(page, KEY_ERROR).getByRole('button').click();
  expect(payload(await waitForBotCall('guild/health-restore'))).toEqual({ key: KEY_ERROR });

  await expect(badge(page)).toHaveText('2');
  await expect(row(page, KEY_ERROR).getByRole('button')).toHaveText(t('notifications.dismiss'));
  await expect(hidden(page)).toHaveAttribute('open', '');
  await expect(row(page, KEY_INFO)).toBeVisible();
});

test('Alles ausgeblendet: „Alles in Ordnung“, Ausgeblendetes bleibt erreichbar', async ({ page }) => {
  await resetBot({ 'guild/health-issues': health({ ...WARN, dismissed: true }) });
  await page.goto(PAGE);
  await expect(badge(page)).toBeHidden();
  await bell(page).click();
  await expect(page.locator('#notifications-list')).toContainText(t('notifications.empty'));
  await expect(hidden(page).locator('summary')).toHaveText(t('notifications.hidden', { count: 1 }));
});

test('Fehler beim Speichern: Meldung, Hinweis bleibt, Button wieder bedienbar', async ({ page }) => {
  await resetBot({
    'guild/health-issues': health(WARN),
    'guild/health-dismiss': { status: 400, error: 'invalid_request' },
  });
  const dialogs = collectDialogs(page);
  await page.goto(PAGE);
  await bell(page).click();

  const button = row(page, KEY_WARN).getByRole('button');
  await button.click();
  await expect.poll(() => dialogs).toEqual([t('notifications.action_error')]);
  await expect(button).toBeEnabled();
  await expect(badge(page)).toHaveText('1');
  expect(await botCalls('guild/health-dismiss')).toHaveLength(1);
});

test('Hinweistext bleibt Text (kein HTML)', async ({ page }) => {
  await resetBot({ 'guild/health-issues': health(issue(KEY_WARN, 'warn', '<img src=x onerror="window.__xss=1">')) });
  await page.goto(PAGE);
  await bell(page).click();
  await expect(row(page, KEY_WARN)).toContainText('<img src=x');
  expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();
});
