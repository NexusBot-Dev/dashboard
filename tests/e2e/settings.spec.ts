import { test, expect, type Page } from '@playwright/test';
import { login, resetBot, waitForBotCall, botCalls, collectDialogs, guildPath, t, dbQuery } from './support/helpers';
import { CHANNELS } from './support/fixtures.mjs';
import { FOREIGN_GUILD_ID, GUILD_ID } from './support/env.mjs';

// Die Settings-Seite liest Werte und Premium-Status direkt aus der DB; gespeichert wird über den Bot.
// Jeder Test startet daher mit einem festen DB-Stand (setSettings) und ohne Premium.

const PAGE = guildPath('settings/');

const BASE = {
  locale: 'de',
  timezone: 'Europe/Berlin',
  color: 62932,
  log_channel_id: CHANNELS[0].id,
  rules_channel_id: null,
  welcome_channel_id: null,
  boost_channel_id: null,
  ticket_log_channel_id: CHANNELS[1].id,
  announcements_enabled: 0,
  announcement_channel_id: null,
};

async function setSettings(values: Partial<Record<keyof typeof BASE, unknown>> = {}) {
  const row = { ...BASE, ...values };
  const cols = Object.keys(row);
  await dbQuery(
    `UPDATE guild_settings SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE guild_id = ?`,
    [...Object.values(row), GUILD_ID]
  );
}

async function setPremium(row: { expires_at: Date | null; source: string } | null) {
  await dbQuery('DELETE FROM premium WHERE guild_id = ?', [GUILD_ID]);
  if (row) await dbQuery('INSERT INTO premium (guild_id, expires_at, source) VALUES (?, ?, ?)', [GUILD_ID, row.expires_at, row.source]);
}

const field = (page: Page, name: string) => page.locator(`#settings-form [name="${name}"]`);
const saveBar = (page: Page) => page.locator('#save-bar');

test.beforeEach(async ({ context }) => {
  await resetBot();
  await setSettings();
  await setPremium(null);
  await login(context);
});

test.afterAll(async () => {
  // Andere Specs sollen den Server im Ausgangszustand vorfinden
  await setSettings({ timezone: 'UTC', log_channel_id: null, ticket_log_channel_id: null });
  await setPremium(null);
});

test.describe('Anzeige', () => {
  test('zeigt die gespeicherten Werte, ohne „ungespeicherte Änderungen“', async ({ page }) => {
    await setSettings({ locale: 'en', welcome_channel_id: CHANNELS[2].id, announcements_enabled: 1 });
    await page.goto(PAGE);

    await expect(field(page, 'locale')).toHaveValue('en');
    await expect(field(page, 'timezone')).toHaveValue('Europe/Berlin');
    await expect(field(page, 'log_channel_id')).toHaveValue(CHANNELS[0].id);
    await expect(field(page, 'rules_channel_id')).toHaveValue('');
    await expect(field(page, 'welcome_channel_id')).toHaveValue(CHANNELS[2].id);
    await expect(field(page, 'ticket_log_channel_id')).toHaveValue(CHANNELS[1].id);
    await expect(page.locator('#announcements-toggle')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('section', { hasText: t('settings.nickname_label') })).toContainText('Nexus'); // Bot-Nickname

    await page.waitForTimeout(300);
    await expect(saveBar(page)).toBeHidden();
  });

  test('Standardwerte eines neuen Servers werden beim Speichern nicht überschrieben', async ({ page }) => {
    // Früher fehlten „UTC“ in der Zeitzonenliste und „Kein Channel“ beim Ticket-Log — beide Selects
    // sprangen still auf ihren ersten Eintrag, und jedes Speichern schickte das ungewollt mit.
    await setSettings({ timezone: 'UTC', ticket_log_channel_id: null });
    await page.goto(PAGE);
    await expect(field(page, 'timezone')).toHaveValue('UTC');
    await expect(field(page, 'ticket_log_channel_id')).toHaveValue('');

    await field(page, 'locale').selectOption('en');
    await page.locator('#save-btn').click();
    expect((await waitForBotCall('settings')).fields).toEqual({ locale: 'en' });
  });

  test('Ticket-Log-Channel lässt sich abwählen', async ({ page }) => {
    await page.goto(PAGE);
    await expect(field(page, 'ticket_log_channel_id').locator('option[value=""]')).toHaveCount(1);
    await field(page, 'ticket_log_channel_id').selectOption('');
    await page.locator('#save-btn').click();
    expect((await waitForBotCall('settings')).fields).toEqual({ ticket_log_channel_id: '' });
  });

  test('ohne Premium: Status inaktiv, Akzentfarbe gesperrt und auf Standard', async ({ page }) => {
    await setSettings({ color: 0xff0000 });
    await page.goto(PAGE);
    await expect(page.getByText(t('settings.no_active_premium'))).toBeVisible();
    await expect(page.locator('#accent-color-input')).toBeDisabled();
    await expect(page.locator('#accent-color-hex')).toHaveText('#00F5D4');
  });

  test('mit Premium: Quelle, Ablaufdatum und eigene Akzentfarbe', async ({ page }) => {
    await setSettings({ color: 0xff0000 });
    await setPremium({ expires_at: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000), source: 'gift' });
    await page.goto(PAGE);
    await expect(page.getByText(t('settings.source_gift'))).toBeVisible();
    await expect(page.getByText(/noch 10 Tage/)).toBeVisible();
    await expect(page.locator('#accent-color-input')).toBeEnabled();
    await expect(page.locator('#accent-color-hex')).toHaveText('#FF0000');
  });
});

test.describe('Bearbeiten', () => {
  test('Änderung zeigt die Speicherleiste, Zurückstellen blendet sie wieder aus', async ({ page }) => {
    await page.goto(PAGE);
    await field(page, 'log_channel_id').selectOption(CHANNELS[1].id);
    await expect(saveBar(page)).toBeVisible();
    await field(page, 'log_channel_id').selectOption(CHANNELS[0].id);
    await expect(saveBar(page)).toBeHidden();
  });

  test('Verwerfen stellt alle Felder zurück, ohne etwas zu senden', async ({ page }) => {
    await page.goto(PAGE);
    await field(page, 'locale').selectOption('pt');
    await field(page, 'rules_channel_id').selectOption(CHANNELS[1].id);
    await page.locator('#announcements-toggle').click();
    await expect(page.locator('#announcements-toggle')).toHaveAttribute('aria-checked', 'true');

    await page.locator('#discard-btn').click();
    await expect(field(page, 'locale')).toHaveValue('de');
    await expect(field(page, 'rules_channel_id')).toHaveValue('');
    await expect(page.locator('#announcements-toggle')).toHaveAttribute('aria-checked', 'false');
    await expect(saveBar(page)).toBeHidden();
    expect(await botCalls('settings')).toHaveLength(0);
  });

  test('Speichern schickt nur geänderte Felder, Schalter als Boolean', async ({ page }) => {
    await page.goto(PAGE);
    await field(page, 'rules_channel_id').selectOption(CHANNELS[1].id);
    await field(page, 'log_channel_id').selectOption('');
    await page.locator('#announcements-toggle').click();
    await page.locator('#save-btn').click();

    expect((await waitForBotCall('settings')).fields).toEqual({
      rules_channel_id: CHANNELS[1].id,
      log_channel_id: '',
      announcements_enabled: true,
    });
    await expect(page.locator('#save-status')).toHaveText(t('settings.saved'));
    await expect(saveBar(page)).toBeHidden();

    // Gespeicherter Stand ist der neue Ausgangswert: erneute Änderung schickt nur das Neue
    await field(page, 'locale').selectOption('es');
    await page.locator('#save-btn').click();
    expect((await waitForBotCall('settings', 1)).fields).toEqual({ locale: 'es' });
  });

  test('mit Premium: Akzentfarbe ändern aktualisiert die Anzeige und wird gespeichert', async ({ page }) => {
    await setPremium({ expires_at: null, source: 'manual' });
    await page.goto(PAGE);
    await page.locator('#accent-color-input').fill('#123abc');
    await expect(page.locator('#accent-color-hex')).toHaveText('#123ABC');
    await page.locator('#save-btn').click();
    expect((await waitForBotCall('settings')).fields).toEqual({ color: '#123abc' });
  });

  test('Warnungen des Bots werden angezeigt, gespeichert ist trotzdem', async ({ page }) => {
    await resetBot({ settings: { data: { updated_fields: ['log_channel_id'], warnings: ['Bot darf dort nicht schreiben'] } } });
    const dialogs = collectDialogs(page);
    await page.goto(PAGE);
    await field(page, 'log_channel_id').selectOption(CHANNELS[1].id);
    await page.locator('#save-btn').click();

    await expect.poll(() => dialogs).toContain('Bot darf dort nicht schreiben');
    await expect(saveBar(page)).toBeHidden();
  });

  test('Fehler des Bots wird angezeigt, Änderung bleibt ungespeichert', async ({ page }) => {
    await resetBot({ settings: { status: 400, error: 'Ungültiger Channel' } });
    const dialogs = collectDialogs(page);
    await page.goto(PAGE);
    await field(page, 'log_channel_id').selectOption(CHANNELS[1].id);
    await page.locator('#save-btn').click();

    await expect.poll(() => dialogs).toContain(t('settings.save_error_prefix') + 'Ungültiger Channel');
    await expect(saveBar(page)).toBeVisible();
    await expect(page.locator('#save-btn')).toBeEnabled();
    await expect(page.locator('#save-btn')).toHaveText(t('common.save'));
  });
});

test.describe('API-Proxy', () => {
  test('fremder Server: Speichern wird abgewiesen und erreicht den Bot nicht', async ({ page }) => {
    await page.goto(PAGE);
    const res = await page.request.post(`/api/server/${FOREIGN_GUILD_ID}/settings/`, { data: { locale: 'en' } });
    expect(res.status()).toBe(403);
    expect(await botCalls('settings')).toHaveLength(0);
  });
});

test.describe('Navigation ohne Neuladen (ClientRouter)', () => {
  const sidebarLink = (page: Page, sub: string) => page.locator(`aside a[href="/server/${GUILD_ID}/${sub}"]`).first();

  async function navigateToSettings(page: Page) {
    await page.evaluate(() => ((window as any).__noReload = true));
    await sidebarLink(page, 'settings/').click();
    await expect(page).toHaveURL(new RegExp(`/server/${GUILD_ID}/settings/$`));
    await expect(page.locator('#settings-form')).toBeVisible();
    expect(await page.evaluate(() => (window as any).__noReload)).toBe(true);
  }

  test('mehrfach hin und zurück: Speichern wird genau einmal gesendet', async ({ page }) => {
    await page.goto(guildPath(''));
    for (let i = 0; i < 3; i++) {
      await navigateToSettings(page);
      await sidebarLink(page, '').click();
      await expect(page).toHaveURL(new RegExp(`/server/${GUILD_ID}/$`));
    }
    await navigateToSettings(page);

    await field(page, 'locale').selectOption('en');
    await expect(saveBar(page)).toBeVisible();
    await page.locator('#save-btn').click();
    expect((await waitForBotCall('settings')).fields).toEqual({ locale: 'en' });
    await page.waitForTimeout(500); // etwaige doppelte Aufrufe abwarten
    expect(await botCalls('settings')).toHaveLength(1);
  });
});
