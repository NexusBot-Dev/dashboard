import { test, expect, type Page } from '@playwright/test';
import { login, resetBot, waitForBotCall, botCalls, collectDialogs, guildPath, t } from './support/helpers';
import { CHANNELS, ROLES, defaultBotData } from './support/fixtures.mjs';
import { GUILD_ID } from './support/env.mjs';

// Wie bei den Tickets: nur sichtbare Oberfläche und die Aufrufe beim Bot prüfen,
// damit die Tests den Umbau des Seiten-Skripts unverändert überstehen.

const PAGE = guildPath('modules/reaction-roles/');
const MSG_REACTION = '700000000000000001';
const MSG_DROPDOWN = '700000000000000002';
const XSS = '<img src=x onerror="window.__xss=1">';

const listMessages = defaultBotData['reaction_roles/list-messages'];
const withPremium = { 'reaction_roles/list-messages': { data: { ...listMessages, premium_active: true } } };

const messageBlock = (page: Page, id: string) => page.locator(`[data-message-block="${id}"]`);
const entryForm = (page: Page) => page.locator('#entry-form');

async function openEntryForm(page: Page, messageId: string) {
  await messageBlock(page, messageId).locator('[data-add-entry-to]').click();
  await expect(entryForm(page)).toBeVisible();
}

async function expectNoXss(page: Page) {
  expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();
}

test.beforeEach(async ({ context }) => {
  await resetBot();
  await login(context);
});

test.describe('Übersicht', () => {
  test('zeigt Gruppen, Nachrichten und Zuordnungen', async ({ page }) => {
    await page.goto(PAGE);
    await expect(page.locator('[data-group-row="5"]')).toContainText('Farben');

    const first = messageBlock(page, MSG_REACTION);
    await expect(first).toContainText(`#${CHANNELS[0].name}`);
    await expect(first).toContainText('Rollen-Auswahl');
    await expect(first.locator('[data-msg-desc] strong')).toHaveText('Wähle');
    await expect(first).toContainText(t('reaction_roles.display_mode_reaction_option'));
    await expect(first.locator('[data-entry-row="11"]')).toContainText('Mods');
    await expect(first.locator('[data-entry-row="11"]')).toContainText(t('reaction_roles.toggle_option'));
    await expect(first.locator('[data-entry-row="12"]')).toContainText(t('reaction_roles.unique_group_badge', { group: 'Farben' }));

    const second = messageBlock(page, MSG_DROPDOWN);
    await expect(second).toContainText(`#${t('reaction_roles.channel_deleted')}`);
    await expect(second).toContainText(t('reaction_roles.display_mode_dropdown_option'));
    await expect(second).toContainText(t('reaction_roles.no_entries'));
  });

  test('ohne Bot-Daten erscheint der Offline-Hinweis und Aktionen sind gesperrt', async ({ page }) => {
    await resetBot({ 'reaction_roles/list-messages': { status: 500, error: 'internal_error' } });
    await page.goto(PAGE);
    await expect(page.getByText(t('common.bot_offline'))).toBeVisible();
    await expect(page.locator('#add-group-btn')).toBeDisabled();
    await expect(page.locator('#new-message-btn')).toBeDisabled();
  });

  test('ohne Premium sind Dropdown, Unique und Server-Emojis gesperrt', async ({ page }) => {
    await page.goto(PAGE);
    await expect(page.locator('#new-msg-display-mode option[value="dropdown"]')).toBeDisabled();
    await expect(page.locator('#entry-mode-select option[value="unique"]')).toBeDisabled();
    await expect(page.locator('[data-custom-emoji]')).toBeDisabled();
  });

  test('mit Premium übernimmt ein Klick auf ein Server-Emoji dessen Code', async ({ page }) => {
    await resetBot(withPremium);
    await page.goto(PAGE);
    await openEntryForm(page, MSG_REACTION);
    await page.locator('[data-custom-emoji]').click();
    await expect(page.locator('#entry-emoji-input')).toHaveValue('<:blau:400000000000000001>');
  });
});

test.describe('Gruppen', () => {
  test('neue Gruppe anlegen: Name wird als Text angezeigt und ist danach auswählbar', async ({ page }) => {
    await page.goto(PAGE);
    await page.locator('#add-group-btn').click();
    await page.locator('#new-group-name-input').fill(`Team ${XSS}`);
    await page.locator('#confirm-group-btn').click();

    expect(await waitForBotCall('reaction_roles/create-group')).toMatchObject({ name: `Team ${XSS}` });
    await expect(page.locator('[data-group-row="6"]')).toContainText(`Team ${XSS}`);
    await expect(page.locator('#group-form')).toBeHidden();
    await expect(page.locator('#entry-group-select option[value="6"]')).toHaveText(`Team ${XSS}`);
    await expectNoXss(page);
  });

  test('leerer Name wird abgelehnt, ohne den Bot zu fragen', async ({ page }) => {
    const dialogs = collectDialogs(page);
    await page.goto(PAGE);
    await page.locator('#add-group-btn').click();
    await page.locator('#confirm-group-btn').click();

    await expect.poll(() => dialogs).toContain(t('reaction_roles.alert_group_name_required'));
    expect(await botCalls('reaction_roles/create-group')).toHaveLength(0);
  });
});

test.describe('Nachrichten', () => {
  test('Vorschau rendert Markdown und escaped HTML, Toolbar formatiert die Auswahl', async ({ page }) => {
    await page.goto(PAGE);
    await page.locator('#new-message-btn').click();
    const desc = page.locator('#new-msg-desc');
    const preview = page.locator('#new-msg-desc-preview');

    await desc.fill(`**fett** ${XSS}`);
    await expect(preview.locator('strong')).toHaveText('fett');
    await expect(preview.locator('img')).toHaveCount(0);
    await expect(preview).toContainText('<img src=x');

    await desc.fill('kursiv');
    await desc.selectText();
    await page.locator('[data-md-toolbar="new-msg-desc"] [data-md="italic"]').click();
    await expect(desc).toHaveValue('*kursiv*');
    await expect(preview.locator('em')).toHaveText('kursiv');
    await expectNoXss(page);
  });

  test('neue Nachricht erstellen und direkt eine Zuordnung anhängen', async ({ page }) => {
    collectDialogs(page);
    await page.goto(PAGE);
    await page.locator('#new-message-btn').click();
    await page.locator('#new-msg-channel').selectOption(CHANNELS[1].id);
    await page.locator('#new-msg-title').fill(`Neu ${XSS}`);
    await page.locator('#new-msg-desc').fill(`**Hallo** ${XSS}`);
    await page.locator('#confirm-new-message-btn').click();

    expect(await waitForBotCall('reaction_roles/create-message')).toMatchObject({
      channel_id: CHANNELS[1].id, title: `Neu ${XSS}`, description: `**Hallo** ${XSS}`, display_mode: 'reaction',
    });
    const block = messageBlock(page, '700000000000000009');
    await expect(block).toContainText(`#${CHANNELS[1].name}`);
    await expect(block.locator('[data-msg-title]')).toHaveText(`Neu ${XSS}`);
    await expect(block.locator('[data-msg-desc] strong')).toHaveText('Hallo');
    await expect(block.locator('[data-msg-desc] img')).toHaveCount(0);
    await expect(page.locator('#new-message-form')).toBeHidden();

    // Neue Nachricht muss genauso bedienbar sein wie die vom Server gerenderten
    await openEntryForm(page, '700000000000000009');
    await page.locator('#entry-emoji-input').fill('🟢');
    await page.locator('#confirm-entry-btn').click();
    expect(await waitForBotCall('reaction_roles/add-entry')).toMatchObject({
      message_id: '700000000000000009', channel_id: CHANNELS[1].id, emoji: '🟢',
    });

    await block.locator('[data-delete-message]').click();
    expect(await waitForBotCall('reaction_roles/delete-message')).toMatchObject({
      message_id: '700000000000000009', channel_id: CHANNELS[1].id,
    });
    await expect(block).toHaveCount(0);
    await expectNoXss(page);
  });

  test('Channel-Name aus Discord wird als Text angezeigt', async ({ page }) => {
    await page.goto(PAGE);
    await page.locator('#new-message-btn').click();
    await page.locator('#new-msg-channel').selectOption(CHANNELS[2].id);
    await page.locator('#new-msg-title').fill('Titel');
    await page.locator('#new-msg-desc').fill('Text');
    await page.locator('#confirm-new-message-btn').click();

    await waitForBotCall('reaction_roles/create-message');
    await expect(messageBlock(page, '700000000000000009')).toContainText(`#${CHANNELS[2].name}`);
    await expectNoXss(page);
  });

  test('ohne Titel oder Beschreibung wird nichts gesendet', async ({ page }) => {
    const dialogs = collectDialogs(page);
    await page.goto(PAGE);
    await page.locator('#new-message-btn').click();
    await page.locator('#new-msg-title').fill('Nur Titel');
    await page.locator('#confirm-new-message-btn').click();

    await expect.poll(() => dialogs).toContain(t('reaction_roles.alert_title_desc_required'));
    expect(await botCalls('reaction_roles/create-message')).toHaveLength(0);
  });

  test('mit Premium kann der Dropdown-Modus gewählt werden', async ({ page }) => {
    await resetBot(withPremium);
    await page.goto(PAGE);
    await page.locator('#new-message-btn').click();
    await page.locator('#new-msg-title').fill('Menü');
    await page.locator('#new-msg-desc').fill('Bitte wählen');
    await page.locator('#new-msg-display-mode').selectOption('dropdown');
    await page.locator('#confirm-new-message-btn').click();

    expect(await waitForBotCall('reaction_roles/create-message')).toMatchObject({ display_mode: 'dropdown' });
    await expect(messageBlock(page, '700000000000000009')).toContainText(t('reaction_roles.display_mode_dropdown_option'));
  });

  test('Nachricht löschen: abgelehnt passiert nichts, bestätigt wird sie entfernt', async ({ page }) => {
    const dialogs = collectDialogs(page, { accept: false });
    await page.goto(PAGE);
    await messageBlock(page, MSG_REACTION).locator('[data-delete-message]').click();
    await expect.poll(() => dialogs).toContain(t('reaction_roles.confirm_delete_message'));
    expect(await botCalls('reaction_roles/delete-message')).toHaveLength(0);

    page.removeAllListeners('dialog');
    collectDialogs(page);
    await messageBlock(page, MSG_REACTION).locator('[data-delete-message]').click();
    expect(await waitForBotCall('reaction_roles/delete-message')).toMatchObject({
      message_id: MSG_REACTION, channel_id: CHANNELS[0].id,
    });
    await expect(messageBlock(page, MSG_REACTION)).toHaveCount(0);
  });
});

test.describe('Zuordnungen', () => {
  test('Toggle-Zuordnung hinzufügen und wieder entfernen', async ({ page }) => {
    collectDialogs(page);
    await page.goto(PAGE);
    await openEntryForm(page, MSG_DROPDOWN);
    await page.locator('#entry-role-select').selectOption(ROLES[1].id);
    await page.locator('#entry-emoji-input').fill('🟢');
    await page.locator('#confirm-entry-btn').click();

    const body = await waitForBotCall('reaction_roles/add-entry');
    expect(body).toMatchObject({
      channel_id: CHANNELS[1].id, message_id: MSG_DROPDOWN, role_id: ROLES[1].id, emoji: '🟢', mode: 'toggle',
    });
    expect(body.group_id ?? null).toBeNull();

    const block = messageBlock(page, MSG_DROPDOWN);
    const row = block.locator('[data-entry-row="99"]');
    await expect(row).toContainText(ROLES[1].name);
    await expect(row).toContainText(t('reaction_roles.toggle_option'));
    await expect(block).not.toContainText(t('reaction_roles.no_entries'));
    await expect(entryForm(page)).toBeHidden();

    await row.locator('[data-remove-entry]').click();
    const del = await waitForBotCall('reaction_roles/delete-entry');
    expect(del).toMatchObject({ message_id: MSG_DROPDOWN, channel_id: CHANNELS[1].id, emoji: '🟢' });
    expect(String(del.entry_id)).toBe('99');
    await expect(row).toHaveCount(0);
  });

  test('mit Premium: Unique-Zuordnung mit Gruppe', async ({ page }) => {
    await resetBot(withPremium);
    await page.goto(PAGE);
    await openEntryForm(page, MSG_DROPDOWN);
    await expect(page.locator('#entry-group-wrap')).toBeHidden();
    await page.locator('#entry-mode-select').selectOption('unique');
    await expect(page.locator('#entry-group-wrap')).toBeVisible();
    await page.locator('#entry-group-select').selectOption('5');
    await page.locator('#entry-emoji-input').fill('🔵');
    await page.locator('#confirm-entry-btn').click();

    const body = await waitForBotCall('reaction_roles/add-entry');
    expect(body).toMatchObject({ mode: 'unique', emoji: '🔵' });
    expect(String(body.group_id)).toBe('5');
    await expect(messageBlock(page, MSG_DROPDOWN).locator('[data-entry-row="99"]'))
      .toContainText(t('reaction_roles.unique_group_badge', { group: 'Farben' }));
  });

  test('ungültiges oder fehlendes Emoji wird abgelehnt, ohne den Bot zu fragen', async ({ page }) => {
    const dialogs = collectDialogs(page);
    await page.goto(PAGE);
    await openEntryForm(page, MSG_REACTION);
    await page.locator('#confirm-entry-btn').click();
    await expect.poll(() => dialogs).toContain(t('reaction_roles.alert_emoji_required'));

    await page.locator('#entry-emoji-input').fill(`abc${XSS}`);
    await page.locator('#confirm-entry-btn').click();
    await expect.poll(() => dialogs).toContain(t('reaction_roles.alert_invalid_emoji'));
    expect(await botCalls('reaction_roles/add-entry')).toHaveLength(0);
  });

  test('bestehende Zuordnung entfernen schickt ID und Emoji', async ({ page }) => {
    collectDialogs(page);
    await page.goto(PAGE);
    await messageBlock(page, MSG_REACTION).locator('[data-entry-row="12"] [data-remove-entry]').click();

    const body = await waitForBotCall('reaction_roles/delete-entry');
    expect(body).toMatchObject({ message_id: MSG_REACTION, channel_id: CHANNELS[0].id, emoji: '<:blau:400000000000000001>' });
    expect(String(body.entry_id)).toBe('12');
    await expect(page.locator('[data-entry-row="12"]')).toHaveCount(0);
    await expect(page.locator('[data-entry-row="11"]')).toBeVisible();
  });

  test('Fehlermeldung des Bots wird angezeigt, Formular bleibt offen', async ({ page }) => {
    await resetBot({ 'reaction_roles/add-entry': { status: 400, error: 'Dieses Emoji ist auf dieser Nachricht bereits vergeben' } });
    const dialogs = collectDialogs(page);
    await page.goto(PAGE);
    await openEntryForm(page, MSG_REACTION);
    await page.locator('#entry-emoji-input').fill('🔴');
    await page.locator('#confirm-entry-btn').click();

    await expect.poll(() => dialogs.join('\n')).toContain('Dieses Emoji ist auf dieser Nachricht bereits vergeben');
    await expect(entryForm(page)).toBeVisible();
    await expect(page.locator('#confirm-entry-btn')).toBeEnabled();
  });
});

test.describe('Navigation ohne Neuladen (ClientRouter)', () => {
  // Die Modul-Unterpunkte stehen nur in der Sidebar, solange man im Modul-Bereich ist
  const sidebarLink = (page: Page, sub: string) => page.locator(`aside a[href="/server/${GUILD_ID}/${sub}"]`).first();

  async function navigateToReactionRoles(page: Page) {
    await page.evaluate(() => ((window as any).__noReload = true));
    await sidebarLink(page, 'modules/reaction-roles/').click();
    await expect(page).toHaveURL(new RegExp(`/modules/reaction-roles/$`));
    await expect(page.locator('#messages-list')).toBeVisible();
    expect(await page.evaluate(() => (window as any).__noReload)).toBe(true);
  }

  test('über die Sidebar geöffnet funktionieren Formulare und Vorschau', async ({ page }) => {
    await page.goto(guildPath('modules/'));
    await navigateToReactionRoles(page);

    await page.locator('#new-message-btn').click();
    await page.locator('#new-msg-desc').fill('**fett**');
    await expect(page.locator('#new-msg-desc-preview strong')).toHaveText('fett');

    await openEntryForm(page, MSG_REACTION);
    await page.locator('#entry-emoji-input').fill('🟢');
    await page.locator('#confirm-entry-btn').click();
    expect(await waitForBotCall('reaction_roles/add-entry')).toMatchObject({ message_id: MSG_REACTION, emoji: '🟢' });
  });

  test('mehrfach hin und zurück: jede Aktion wird genau einmal gesendet', async ({ page }) => {
    collectDialogs(page);
    await page.goto(guildPath('modules/'));
    for (let i = 0; i < 3; i++) {
      await navigateToReactionRoles(page);
      await sidebarLink(page, 'modules/').click();
      await expect(page).toHaveURL(new RegExp(`/server/${GUILD_ID}/modules/$`));
    }
    await navigateToReactionRoles(page);

    await page.locator('#add-group-btn').click();
    await page.locator('#new-group-name-input').fill('Einmal');
    await page.locator('#confirm-group-btn').click();
    await page.locator('[data-entry-row="11"] [data-remove-entry]').click();
    await messageBlock(page, MSG_DROPDOWN).locator('[data-delete-message]').click();

    await waitForBotCall('reaction_roles/create-group');
    await waitForBotCall('reaction_roles/delete-entry');
    await waitForBotCall('reaction_roles/delete-message');
    await page.waitForTimeout(500); // etwaige doppelte Aufrufe abwarten
    for (const key of ['create-group', 'delete-entry', 'delete-message']) {
      expect(await botCalls(`reaction_roles/${key}`)).toHaveLength(1);
    }
    await expect(page.locator('[data-group-row="6"]')).toHaveCount(1);
  });
});
