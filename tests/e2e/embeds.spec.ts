import { test, expect, type Page } from '@playwright/test';
import { login, resetBot, waitForBotCall, botCalls, collectDialogs, guildPath, t, dbQuery } from './support/helpers';
import { CHANNELS, defaultBotData } from './support/fixtures.mjs';
import { GUILD_ID } from './support/env.mjs';

// Embeds: speichern, bearbeiten, löschen, sofort posten und (Premium) zeitgesteuert posten.
// Regel-Channel und Zeitzone liest die Seite direkt aus der DB.

const PAGE = guildPath('embeds/');
const XSS = '<img src=x onerror="window.__xss=1">';
const list = defaultBotData['embeds/list'];
const withPremium = { 'embeds/list': { data: { ...list, premium_active: true } } };

const row = (page: Page, id: number) => page.locator(`[data-embed-row="${id}"]`);
const form = (page: Page) => page.locator('#embed-form');
const expectNoXss = async (page: Page) => expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();

async function setGuild(values: Record<string, unknown> = {}) {
  const fields = { rules_channel_id: CHANNELS[0].id, timezone: 'Europe/Berlin', ...values };
  await dbQuery(
    `UPDATE guild_settings SET ${Object.keys(fields).map((c) => `${c} = ?`).join(', ')} WHERE guild_id = ?`,
    [...Object.values(fields), GUILD_ID]
  );
}

async function fillForm(page: Page, { name, channel, title, description }: { name?: string; channel?: string; title?: string; description?: string }) {
  if (name !== undefined) await page.locator('#embed-name-input').fill(name);
  if (channel !== undefined) await page.locator('#embed-channel-select').selectOption(channel);
  if (title !== undefined) await page.locator('#embed-title-input').fill(title);
  if (description !== undefined) await page.locator('#embed-description-input').fill(description);
}

test.beforeEach(async ({ context }) => {
  await resetBot();
  await setGuild();
  await login(context);
});

test.afterAll(async () => {
  await setGuild({ rules_channel_id: null, timezone: 'UTC' });
});

test.describe('Übersicht', () => {
  test('zeigt Regel-Channel und gespeicherte Embeds', async ({ page }) => {
    await page.goto(PAGE);
    await expect(page.getByText(`#${CHANNELS[0].name}`, { exact: true }).first()).toBeVisible();
    await expect(page.getByText(t('embeds.embeds_count', { count: 2, limit: 3 }))).toBeVisible();

    await expect(row(page, 1)).toContainText('Regeln');
    await expect(row(page, 1)).toContainText(`#${CHANNELS[0].name}`);
    await expect(row(page, 1)).toContainText('**Sei nett** zu {user}'); // Liste zeigt den Rohtext
    await expect(row(page, 2)).toContainText(`#${CHANNELS[1].name}`);
  });

  test('geplante Embeds zeigen den Zeitpunkt in der Zeitzone des Servers', async ({ page }) => {
    await page.goto(PAGE);
    // 12:45 UTC = 13:45 in Berlin (Winterzeit)
    await expect(row(page, 2)).toContainText(t('embeds.scheduled_for', { date: '02.01.2030, 13:45' }));
    await expect(row(page, 1).locator('[data-unschedule]')).toHaveCount(0);
  });

  test('ohne Regel-Channel erscheint ein Hinweis', async ({ page }) => {
    await setGuild({ rules_channel_id: null });
    await page.goto(PAGE);
    await expect(page.getByText(t('embeds.no_channel_set'))).toBeVisible();
  });

  test('ohne Bot-Daten erscheint der Offline-Hinweis und Erstellen ist gesperrt', async ({ page }) => {
    await resetBot({ 'embeds/list': { status: 500, error: 'internal_error' } });
    await page.goto(PAGE);
    await expect(page.getByText(t('common.bot_offline'))).toBeVisible();
    await expect(page.locator('#add-embed-btn')).toBeDisabled();
  });
});

test.describe('Erstellen', () => {
  test('neues Embed: Payload, neue Zeile, Texte bleiben Text', async ({ page }) => {
    await page.goto(PAGE);
    await page.locator('#add-embed-btn').click();
    await expect(form(page)).toBeVisible();
    await fillForm(page, { name: `Name ${XSS}`, channel: CHANNELS[1].id, title: `Titel ${XSS}`, description: `**Inhalt** ${XSS}` });
    await page.locator('#confirm-embed-btn').click();

    expect(await waitForBotCall('embeds/add')).toMatchObject({
      name: `Name ${XSS}`, title: `Titel ${XSS}`, description: `**Inhalt** ${XSS}`, channel_id: CHANNELS[1].id,
    });
    await expect(row(page, 9)).toContainText(`Name ${XSS}`);
    await expect(row(page, 9)).toContainText(`Titel ${XSS}`);
    await expect(row(page, 9)).toContainText(`#${CHANNELS[1].name}`);
    await expect(row(page, 9).locator('img')).toHaveCount(0);
    await expect(form(page)).toBeHidden();
    await expectNoXss(page);
  });

  test('neu angelegtes Embed ist sofort bedienbar und sieht aus wie die anderen', async ({ page }) => {
    collectDialogs(page);
    await page.goto(PAGE);
    await page.locator('#add-embed-btn').click();
    await fillForm(page, { name: 'Neu', channel: CHANNELS[0].id, description: 'Text' });
    await page.locator('#confirm-embed-btn').click();
    await waitForBotCall('embeds/add');

    await expect(row(page, 9).locator('[data-schedule-btn]')).toContainText('🔒'); // ohne Premium wie bei den übrigen
    await row(page, 9).locator('[data-edit-embed]').click();
    await expect(page.locator('#embed-name-input')).toHaveValue('Neu');
    await page.locator('#cancel-embed-btn').click();
    await row(page, 9).locator('[data-remove-embed]').click();
    expect(String((await waitForBotCall('embeds/delete')).embed_id)).toBe('9');
    await expect(row(page, 9)).toHaveCount(0);
  });

  test('Vorschau rendert Markdown und escaped HTML', async ({ page }) => {
    await page.goto(PAGE);
    await page.locator('#add-embed-btn').click();
    await fillForm(page, { description: `**fett** ${XSS}` });
    const preview = page.locator('#embed-preview');
    await expect(preview.locator('strong')).toHaveText('fett');
    await expect(preview.locator('img')).toHaveCount(0);
    await expectNoXss(page);
  });

  test('Vorschau zeigt Platzhalter so, wie der Bot sie postet', async ({ page }) => {
    await page.goto(PAGE);
    await page.locator('#add-embed-btn').click();
    await fillForm(page, { description: 'Hallo {user} auf {server}' });
    await expect(page.locator('#embed-preview')).toHaveText('Hallo {user} auf {server}');
  });

  test('ohne Name/Inhalt oder ohne Channel wird nichts gesendet', async ({ page }) => {
    const dialogs = collectDialogs(page);
    await page.goto(PAGE);
    await page.locator('#add-embed-btn').click();
    await fillForm(page, { name: 'Nur Name' });
    await page.locator('#confirm-embed-btn').click();
    await expect.poll(() => dialogs).toContain(t('embeds.alert_name_content_required'));

    await fillForm(page, { description: 'Inhalt' });
    await page.locator('#confirm-embed-btn').click();
    await expect.poll(() => dialogs).toContain(t('embeds.alert_channel_required'));
    expect(await botCalls('embeds/add')).toHaveLength(0);
  });

  test('Löschen gibt das Limit frei, ohne Embeds erscheint der Leer-Hinweis', async ({ page }) => {
    const full = { ...list, embeds: [...list.embeds, { ...list.embeds[0], id: 3, name: 'Drei' }] };
    await resetBot({ 'embeds/list': { data: full } });
    collectDialogs(page);
    await page.goto(PAGE);
    await expect(page.locator('#add-embed-btn')).toBeDisabled();
    for (const id of [3, 2, 1]) {
      await row(page, id).locator('[data-remove-embed]').click();
      await expect(row(page, id)).toHaveCount(0);
    }
    await expect(page.locator('#add-embed-btn')).toBeEnabled();
    await expect(page.getByText(t('embeds.embeds_count', { count: 0, limit: 3 }))).toBeVisible();
    await expect(page.getByText(t('embeds.no_embeds'))).toBeVisible();
  });

  test('Fehler des Bots wird angezeigt, Formular bleibt offen', async ({ page }) => {
    await resetBot({ 'embeds/add': { status: 400, error: 'Limit erreicht (3 Embeds)' } });
    const dialogs = collectDialogs(page);
    await page.goto(PAGE);
    await page.locator('#add-embed-btn').click();
    await fillForm(page, { name: 'X', channel: CHANNELS[0].id, description: 'Y' });
    await page.locator('#confirm-embed-btn').click();
    await expect.poll(() => dialogs.join('\n')).toContain('Limit erreicht (3 Embeds)');
    await expect(form(page)).toBeVisible();
  });

  test('Limit: nach Erreichen ist Erstellen gesperrt und der Zähler stimmt', async ({ page }) => {
    await page.goto(PAGE);
    await page.locator('#add-embed-btn').click();
    await fillForm(page, { name: 'Drittes', channel: CHANNELS[0].id, description: 'Text' });
    await page.locator('#confirm-embed-btn').click();
    await waitForBotCall('embeds/add');
    await expect(page.getByText(t('embeds.embeds_count', { count: 3, limit: 3 }))).toBeVisible();
    await expect(page.locator('#add-embed-btn')).toBeDisabled();
  });
});

test.describe('Bearbeiten', () => {
  test('Formular ist vorbefüllt, Speichern schickt Titel, Inhalt und Channel', async ({ page }) => {
    await page.goto(PAGE);
    await row(page, 1).locator('[data-edit-embed]').click();
    await expect(page.locator('#embed-form-title')).toHaveText(t('embeds.embed_form_edit_title'));
    await expect(page.locator('#embed-name-input')).toHaveValue('Regeln');
    await expect(page.locator('#embed-title-input')).toHaveValue('📋 Regeln');
    await expect(page.locator('#embed-description-input')).toHaveValue('**Sei nett** zu {user}');
    await expect(page.locator('#embed-channel-select')).toHaveValue(CHANNELS[0].id);

    await fillForm(page, { channel: CHANNELS[1].id, title: 'Neue Regeln', description: 'Neu' });
    await page.locator('#confirm-embed-btn').click();

    const body = await waitForBotCall('embeds/edit');
    expect(String(body.embed_id)).toBe('1');
    expect(body).toMatchObject({ title: 'Neue Regeln', description: 'Neu', channel_id: CHANNELS[1].id });
    await expect(row(page, 1)).toContainText('Neue Regeln');
    await expect(row(page, 1)).toContainText(`#${CHANNELS[1].name}`);
    expect(await botCalls('embeds/add')).toHaveLength(0);
  });

  test('der interne Name lässt sich beim Bearbeiten nicht scheinbar ändern', async ({ page }) => {
    await page.goto(PAGE);
    await row(page, 1).locator('[data-edit-embed]').click();
    await expect(page.locator('#embed-name-input')).not.toBeEditable();
  });

  test('ohne Channel wird beim Bearbeiten nichts gesendet', async ({ page }) => {
    const dialogs = collectDialogs(page);
    await page.goto(PAGE);
    await row(page, 1).locator('[data-edit-embed]').click();
    await fillForm(page, { channel: '' });
    await page.locator('#confirm-embed-btn').click();
    await expect.poll(() => dialogs).toContain(t('embeds.alert_channel_required'));
    expect(await botCalls('embeds/edit')).toHaveLength(0);
  });
});

test.describe('Löschen, Posten, Zeitplan', () => {
  test('Löschen: abgelehnt passiert nichts, bestätigt wird die Zeile entfernt', async ({ page }) => {
    const dialogs = collectDialogs(page, { accept: false });
    await page.goto(PAGE);
    await row(page, 1).locator('[data-remove-embed]').click();
    await expect.poll(() => dialogs).toContain(t('embeds.confirm_delete_embed'));
    expect(await botCalls('embeds/delete')).toHaveLength(0);

    page.removeAllListeners('dialog');
    collectDialogs(page);
    await row(page, 1).locator('[data-remove-embed]').click();
    expect(String((await waitForBotCall('embeds/delete')).embed_id)).toBe('1');
    await expect(row(page, 1)).toHaveCount(0);
  });

  test('Jetzt posten: nach Bestätigung gepostet, Erfolg wird gemeldet', async ({ page }) => {
    const dialogs = collectDialogs(page);
    await page.goto(PAGE);
    await row(page, 2).locator('[data-post-now]').click();
    expect(String((await waitForBotCall('embeds/post-now')).embed_id)).toBe('2');
    await expect.poll(() => dialogs).toEqual([t('embeds.confirm_post_now'), t('embeds.alert_posted')]);
  });

  test('Jetzt posten: Fehler des Bots wird angezeigt', async ({ page }) => {
    await resetBot({ 'embeds/post-now': { status: 400, error: 'Fehlende Berechtigung zum Posten in diesem Channel' } });
    const dialogs = collectDialogs(page);
    await page.goto(PAGE);
    await row(page, 1).locator('[data-post-now]').click();
    await expect.poll(() => dialogs.join('\n')).toContain('Fehlende Berechtigung zum Posten');
    expect(dialogs).not.toContain(t('embeds.alert_posted'));
  });

  test('ohne Premium: Zeitplan zeigt nur den Premium-Hinweis', async ({ page }) => {
    await page.goto(PAGE);
    await row(page, 1).locator('[data-schedule-btn]').click();
    await expect(page.locator('#schedule-form')).toBeVisible();
    await expect(page.locator('#schedule-form')).toContainText(t('embeds.premium_scheduling_desc'));
    await expect(page.locator('#schedule-date-input')).toHaveCount(0);
  });

  test('mit Premium: Zeitplan schickt Datum und Uhrzeit (Ortszeit des Servers) und lädt neu', async ({ page }) => {
    await resetBot(withPremium);
    await page.goto(PAGE);
    await row(page, 1).locator('[data-schedule-btn]').click();
    await expect(page.locator('#schedule-form')).toContainText(t('embeds.timezone_label', { tz: 'Europe/Berlin' }));
    await page.locator('#schedule-date-input').fill('2030-03-04');
    await page.locator('#schedule-time-input').fill('10:30');
    await page.locator('#confirm-schedule-btn').click();

    const body = await waitForBotCall('embeds/schedule');
    expect(String(body.embed_id)).toBe('1');
    expect(body.scheduled_at).toBe('2030-03-04T10:30');
    await expect.poll(async () => (await botCalls('embeds/list')).length).toBeGreaterThan(1); // Liste neu geladen
  });

  test('mit Premium: ohne Datum/Uhrzeit wird nichts gesendet', async ({ page }) => {
    await resetBot(withPremium);
    const dialogs = collectDialogs(page);
    await page.goto(PAGE);
    await row(page, 1).locator('[data-schedule-btn]').click();
    await page.locator('#confirm-schedule-btn').click();
    await expect.poll(() => dialogs).toContain(t('embeds.alert_date_time_required'));
    expect(await botCalls('embeds/schedule')).toHaveLength(0);
  });

  test('Zeitplan entfernen', async ({ page }) => {
    await page.goto(PAGE);
    await row(page, 2).locator('[data-unschedule]').click();
    expect(String((await waitForBotCall('embeds/unschedule')).embed_id)).toBe('2');
  });
});

test.describe('Navigation ohne Neuladen (ClientRouter)', () => {
  const sidebarLink = (page: Page, sub: string) => page.locator(`aside a[href="/server/${GUILD_ID}/${sub}"]`).first();

  test('mehrfach hin und zurück: Löschen wird genau einmal gesendet', async ({ page }) => {
    collectDialogs(page);
    await page.goto(guildPath(''));
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => ((window as any).__noReload = true));
      await sidebarLink(page, 'embeds/').click();
      await expect(page.locator('#embeds-list')).toBeVisible();
      await sidebarLink(page, '').click();
      await expect(page).toHaveURL(new RegExp(`/server/${GUILD_ID}/$`));
    }
    await sidebarLink(page, 'embeds/').click();
    await expect(page.locator('#embeds-list')).toBeVisible();
    expect(await page.evaluate(() => (window as any).__noReload)).toBe(true);

    await page.locator('#add-embed-btn').click();
    await fillForm(page, { description: '**fett**' });
    await expect(page.locator('#embed-preview strong')).toHaveText('fett');

    await row(page, 1).locator('[data-remove-embed]').click();
    await waitForBotCall('embeds/delete');
    await page.waitForTimeout(500); // etwaige doppelte Aufrufe abwarten
    expect(await botCalls('embeds/delete')).toHaveLength(1);
  });
});
