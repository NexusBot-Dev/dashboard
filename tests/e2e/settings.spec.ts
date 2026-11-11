import { test, expect, type Page } from '@playwright/test';
import { login, browserPost, resetBot, waitForBotCall, botCalls, collectDialogs, guildPath, t, dbQuery, delayPageWiring, expectNotWiredYet } from './support/helpers';
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

test.describe('Danger Zone', () => {
  const CONFIRM_WORD = t('settings.danger_confirm_word');
  const zone = (page: Page) => page.locator('#danger-zone');
  const dialog = (page: Page) => page.locator('#danger-dialog');
  const wordInput = (page: Page) => page.locator('#danger-confirm-input');
  const confirmBtn = (page: Page) => page.locator('#danger-confirm-btn');
  const leaveBtn = (page: Page) => zone(page).getByRole('button', { name: t('settings.danger_leave_label'), exact: true });
  const deleteBtn = (page: Page) => zone(page).getByRole('button', { name: t('settings.danger_delete_label'), exact: true });

  test.afterEach(async () => {
    await dbQuery('UPDATE guild_settings SET left_at = NULL WHERE guild_id = ?', [GUILD_ID]);
  });

  test('Owner sieht beide Aktionen aktiv, ohne Hinweis', async ({ page }) => {
    await page.goto(PAGE);
    await expect(leaveBtn(page)).toBeEnabled();
    await expect(deleteBtn(page)).toBeEnabled();
    await expect(page.locator('#danger-disabled-hint')).toHaveCount(0);
    await expect(dialog(page)).toBeHidden();
  });

  test('Bestätigen erst mit dem Bestätigungswort; Abbrechen sendet nichts', async ({ page }) => {
    await page.goto(PAGE);
    await leaveBtn(page).click();

    await expect(dialog(page)).toBeVisible();
    await expect(page.locator('#danger-dialog-title')).toHaveText(t('settings.danger_dialog_leave_title', { server: 'Testserver' }));
    await expect(page.locator('#danger-dialog-text')).toHaveText(t('settings.danger_dialog_leave_text'));
    await expect(wordInput(page)).toBeFocused();
    await expect(confirmBtn(page)).toBeDisabled();

    // Das Wort steht im Dialog — nicht der Servername
    await expect(page.locator('label[for="danger-confirm-input"] strong')).toHaveText(CONFIRM_WORD);
    await wordInput(page).fill('Testserver');
    await expect(confirmBtn(page)).toBeDisabled();
    await wordInput(page).press('Enter'); // Enter mit falschem Wort löst nichts aus
    await wordInput(page).fill(`  ${CONFIRM_WORD.toLowerCase()} `); // Groß-/Kleinschreibung und Leerzeichen egal
    await expect(confirmBtn(page)).toBeEnabled();

    await page.locator('#danger-cancel-btn').click();
    await expect(dialog(page)).toBeHidden();
    await page.waitForTimeout(300);
    expect(await botCalls('guild/leave')).toHaveLength(0);

    // Erneutes Öffnen startet leer
    await deleteBtn(page).click();
    await expect(wordInput(page)).toHaveValue('');
    await expect(confirmBtn(page)).toBeDisabled();
    await expect(page.locator('#danger-dialog-title')).toHaveText(t('settings.danger_dialog_delete_title', { server: 'Testserver' }));
  });

  for (const [name, viewport] of [['Desktop', { width: 1280, height: 800 }], ['Handy', { width: 375, height: 700 }]] as const) {
    test(`Dialog liegt mittig über der Seite (${name})`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto(PAGE);
      await leaveBtn(page).click();
      const box = (await dialog(page).boundingBox())!;
      expect(Math.abs(box.x + box.width / 2 - viewport.width / 2)).toBeLessThan(2);
      expect(Math.abs(box.y + box.height / 2 - viewport.height / 2)).toBeLessThan(2);
      expect(box.x).toBeGreaterThanOrEqual(15);   // auf dem Handy Abstand zum Rand
    });
  }

  test('Nexus entfernen: delete_now = false, danach Serverliste', async ({ page }) => {
    await page.goto(PAGE);
    await leaveBtn(page).click();
    await wordInput(page).fill(CONFIRM_WORD);
    await confirmBtn(page).click();

    expect((await waitForBotCall('guild/leave')).delete_now).toBe(false);
    await expect(page).toHaveURL(/\/server\/$/);
  });

  test('Entfernen und löschen: delete_now = true, Enter bestätigt', async ({ page }) => {
    const dialogs = collectDialogs(page);
    await page.goto(PAGE);
    await deleteBtn(page).click();
    await expect(confirmBtn(page)).toHaveText(t('settings.danger_delete_label'));
    await wordInput(page).fill(CONFIRM_WORD);
    await wordInput(page).press('Enter');

    expect((await waitForBotCall('guild/leave')).delete_now).toBe(true);
    await expect(page).toHaveURL(/\/server\/$/);
    expect(dialogs).toEqual([]);
  });

  test('Löschen fehlgeschlagen: Hinweis auf die 7 Tage, trotzdem Serverliste', async ({ page }) => {
    await resetBot({ 'guild/leave': { data: { left: true, deleted: false } } });
    const dialogs = collectDialogs(page);
    await page.goto(PAGE);
    await deleteBtn(page).click();
    await wordInput(page).fill(CONFIRM_WORD);
    await confirmBtn(page).click();

    await expect.poll(() => dialogs).toEqual([t('settings.danger_delete_failed')]);
    await expect(page).toHaveURL(/\/server\/$/);
  });

  test('Fehler des Bots: Meldung im Dialog, erneut versuchbar', async ({ page }) => {
    await resetBot({ 'guild/leave': { status: 400, error: 'Nur der Server-Owner kann Nexus entfernen' } });
    await page.goto(PAGE);
    await leaveBtn(page).click();
    await wordInput(page).fill(CONFIRM_WORD);
    await confirmBtn(page).click();

    await expect(page.locator('#danger-dialog-error')).toHaveText(`${t('common.error_generic')}: Nur der Server-Owner kann Nexus entfernen`);
    await expect(dialog(page)).toBeVisible();
    await expect(confirmBtn(page)).toBeEnabled();
    await expect(confirmBtn(page)).toHaveText(t('settings.danger_leave_label'));
    await expect(wordInput(page)).toBeEnabled();
    await expect(page).toHaveURL(new RegExp(`/server/${GUILD_ID}/settings/$`));

    await confirmBtn(page).click();
    await waitForBotCall('guild/leave', 1);
  });

  test('Serverliste: entfernter Server (left_at gesetzt) erscheint mit Einladungs-Link', async ({ page }) => {
    await page.goto('/server/');
    await expect(page.locator(`a[href="/server/${GUILD_ID}/"]`)).toBeVisible();

    await dbQuery('UPDATE guild_settings SET left_at = NOW() WHERE guild_id = ?', [GUILD_ID]);
    await page.goto('/server/');
    await expect(page.locator(`a[href="/server/${GUILD_ID}/"]`)).toHaveCount(0);
    await expect(page.locator(`a[href*="guild_id=${GUILD_ID}"]`)).toBeVisible();
  });
});

test.describe('API-Proxy', () => {
  test('fremder Server: Speichern wird abgewiesen und erreicht den Bot nicht', async ({ page }) => {
    await page.goto(PAGE);
    const res = await browserPost(page, `/api/server/${FOREIGN_GUILD_ID}/settings/`, { locale: 'en' });
    expect(res.status).toBe(403);
    expect(res.json.error).toBe(t('api_errors.forbidden'));
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

test.describe('Eingaben vor dem Verdrahten der Seite', () => {
  // Auf langsamen Rechnern (z. B. im CI) kann man Felder ändern, bevor astro:page-load die Seite verdrahtet hat.
  // Das Ereignis der Änderung geht dann ins Leere — Speichern muss trotzdem möglich sein.
  test.beforeEach(async ({ page }) => { await delayPageWiring(page); });

  test('Sprache vor dem Verdrahten geändert: Speicherleiste erscheint und schickt die Änderung', async ({ page }) => {
    await page.goto(PAGE);
    await field(page, 'locale').selectOption('en');
    await expectNotWiredYet(page);
    await page.locator('#save-btn').click();
    expect((await waitForBotCall('settings')).fields).toEqual({ locale: 'en' });
  });
});
