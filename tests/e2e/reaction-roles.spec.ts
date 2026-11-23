import { test, expect, type Locator, type Page } from '@playwright/test';
import { login, resetBot, waitForBotCall, botCalls, collectDialogs, guildPath, t } from './support/helpers';
import { CHANNELS, ROLES, defaultBotData } from './support/fixtures.mjs';
import { GUILD_ID } from './support/env.mjs';

// Wie bei den Tickets: nur sichtbare Oberfläche und die Aufrufe beim Bot prüfen,
// damit die Tests den Umbau des Seiten-Skripts unverändert überstehen.

const PAGE = guildPath('reaction-roles/');
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

const pickerToggle = (page: Page) => page.locator('[data-emoji-picker-toggle]');
const pickerPopover = (page: Page) => page.locator('[data-emoji-picker-popover]');
const pickerPreview = (page: Page) => page.locator('[data-emoji-picker-preview]');
const pickerSearch = (page: Page) => page.getByRole('combobox', { name: 'Suchen' });
// Name eines Emoji-Buttons im Picker: „😀, grinsendes Gesicht, grinsendes_gesicht“
const pickerEmoji = (page: Page, label: string) =>
  page.getByRole('option', { name: new RegExp(`(^|, )${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(,|$)`) });

/** Text steht vollständig da: nicht auf null gedrückt und nicht mit „…“ abgeschnitten */
const isFullyShown = (locator: Locator) =>
  locator.evaluate((el) => el.clientWidth > 0 && el.scrollWidth <= el.clientWidth + 1);

async function openPicker(page: Page) {
  await pickerToggle(page).click();
  await expect(pickerPopover(page)).toBeVisible();
  await expect(pickerSearch(page)).toBeVisible();
}

async function expectNoXss(page: Page) {
  expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();
}

test.beforeEach(async ({ context }) => {
  await context.route('https://cdn.discordapp.com/**', (route) =>
    route.fulfill({ contentType: 'image/gif', body: Buffer.from('R0lGODlhAQABAAAAACw=', 'base64') }));
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

  test('ohne Premium sind Dropdown und Unique gesperrt, die Emoji-Auswahl nicht', async ({ page }) => {
    await page.goto(PAGE);
    await expect(page.locator('#new-msg-display-mode option[value="dropdown"]')).toBeDisabled();
    await expect(page.locator('#entry-mode-select option[value="unique"]')).toBeDisabled();
    await openEntryForm(page, MSG_REACTION);
    await expect(pickerToggle(page)).toBeEnabled();
  });

  test('Server-Emojis erscheinen als Bild, Standard-Emojis als Twemoji', async ({ page }) => {
    await page.goto(PAGE);
    const block = messageBlock(page, MSG_REACTION);
    const custom = block.locator('[data-entry-row="12"] [data-entry-emoji] img');
    await expect(custom).toHaveAttribute('src', 'https://cdn.discordapp.com/emojis/400000000000000001.png');
    await expect(custom).toHaveAttribute('alt', 'blau');
    const unicode = block.locator('[data-entry-row="11"] [data-entry-emoji] .emoji-twemoji');
    await expect(unicode).toHaveText('🔴');
    await expect(unicode).toHaveCSS('font-family', /^Twemoji/);
  });
});

// Auf dem Handy darf sich die Seite nicht seitlich verschieben lassen (früher: Kopfzeile jeder Nachricht
// mit drei Buttons ragte bis zu 210 px heraus) — auch nicht bei einer neu angelegten Nachricht
for (const width of [320, 360, 390]) {
  test(`Seite passt bei ${width} px in die Breite, auch mit neuer Nachricht`, async ({ page }) => {
    collectDialogs(page);
    await page.setViewportSize({ width, height: 800 });
    await page.goto(PAGE);
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(await overflow()).toBe(0);
    // Langes Abzeichen („Unique - Farben“) darf den Rollennamen nicht wegdrücken
    for (const row of await page.locator('[data-entry-row]').all()) {
      const name = row.locator('span.truncate').first();
      expect(await isFullyShown(name), await name.textContent() ?? '').toBe(true);
    }

    await page.locator('#new-message-btn').click();
    await page.locator('#new-msg-channel').selectOption(CHANNELS[1].id);
    await page.locator('#new-msg-title').fill('Neu');
    await page.locator('#new-msg-desc').fill('Text');
    await page.locator('#confirm-new-message-btn').click();
    await expect(messageBlock(page, '700000000000000009')).toBeVisible();
    expect(await overflow()).toBe(0);
  });
}

test.describe('Emoji-Auswahl', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PAGE);
    await openEntryForm(page, MSG_REACTION);
  });

  test('Standard-Emoji über die Suche wählen: Feld, Vorschau, Auswahl schließt', async ({ page }) => {
    await expect(pickerPreview(page)).toHaveClass(/opacity-40/);
    await openPicker(page);
    await pickerSearch(page).fill('grinsendes');
    await pickerEmoji(page, 'grinsendes Gesicht').click();
    await expect(page.locator('#entry-emoji-input')).toHaveValue('😀');
    await expect(pickerPopover(page)).toBeHidden();
    await expect(pickerToggle(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(pickerPreview(page)).toHaveText('😀');
    await expect(pickerPreview(page)).not.toHaveClass(/opacity-40/);
    await expect(page.locator('#entry-emoji-input')).toBeFocused();
  });

  test('alle Server-Emojis sind auswählbar und ergeben ihren Code', async ({ page }) => {
    await openPicker(page);
    await pickerSearch(page).fill('emoji_40');
    await pickerEmoji(page, 'emoji_40').click();
    await expect(page.locator('#entry-emoji-input')).toHaveValue('<:emoji_40:400000000000000040>');

    await openPicker(page);
    await pickerSearch(page).fill('party');
    await pickerEmoji(page, 'party').click();
    await expect(page.locator('#entry-emoji-input')).toHaveValue('<a:party:400000000000000002>');
    await expect(pickerPreview(page).locator('img')).toHaveAttribute('src', 'https://cdn.discordapp.com/emojis/400000000000000002.gif');
  });

  test('Server-Emojis haben eine eigene Kategorie mit allen 40', async ({ page }) => {
    await openPicker(page);
    await page.getByRole('tab', { name: t('emoji_picker.server_emojis') }).click();
    await expect(page.getByRole('menu', { name: t('emoji_picker.server_emojis') }).getByRole('menuitem')).toHaveCount(40);
  });

  test('Emojis neuer als Version 15 werden nicht angeboten', async ({ page }) => {
    await openPicker(page);
    await pickerSearch(page).fill('zitterndes Doppelgesicht'); // Version 15
    await expect(pickerEmoji(page, 'zitterndes Doppelgesicht')).toBeVisible();
    await pickerSearch(page).fill('Augenringen'); // 🫩 Gesicht mit Augenringen, Version 16
    await expect(page.getByRole('option', { name: /Augenringen/ })).toHaveCount(0);
    // Die Grenze muss fest gesetzt sein: ohne sie richtet sich der Picker nach den Emojis des Browsers,
    // und ein aktueller Browser würde Emojis zeigen, die Twemoji (und oft Discord) nicht kennt
    expect(await page.locator('emoji-picker').evaluate((el) => (el as any).emojiVersion)).toBe(15);
  });

  // Popover liegt ganz im Bild und wird von nichts verdeckt (früher: abgeschnitten von der Karte,
  // auf dem Handy links aus dem Bildschirm)
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }, { width: 360, height: 640 }]) {
    test(`Auswahl liegt sichtbar im Bild bei ${viewport.width} px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await openPicker(page);
      await expect(page.getByRole('menuitem').first()).toBeVisible();
      const check = () => page.locator('[data-emoji-picker-popover]').evaluate((el) => {
        const r = el.getBoundingClientRect();
        const points = [[r.left + 4, r.top + 4], [r.right - 4, r.top + 4], [r.left + 4, r.bottom - 4], [r.right - 4, r.bottom - 4]];
        return {
          inView: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
          onTop: points.every(([x, y]) => el.contains(document.elementFromPoint(x, y))),
        };
      });
      await expect.poll(check).toEqual({ inView: true, onTop: true });

      // Alle Kategorie-Tabs passen in die Zeile, auch der letzte (Flaggen)
      const popoverBox = (await pickerPopover(page).boundingBox())!;
      const tabs = page.getByRole('tab');
      await expect(tabs).toHaveCount(10);
      const last = (await tabs.last().boundingBox())!;
      expect(last.x + last.width).toBeLessThanOrEqual(popoverBox.x + popoverBox.width);
    });
  }

  test('Escape und Klick daneben schließen die Auswahl', async ({ page }) => {
    await openPicker(page);
    await page.keyboard.press('Escape');
    await expect(pickerPopover(page)).toBeHidden();
    await expect(pickerToggle(page)).toBeFocused();

    await openPicker(page);
    // Das Textfeld liegt neben dem Button und wird von der Auswahl nie verdeckt
    await page.locator('#entry-emoji-input').click();
    await expect(pickerPopover(page)).toBeHidden();
  });

  test('Emoji-Daten und Schrift kommen vom Dashboard selbst', async ({ page }) => {
    const external: string[] = [];
    page.on('request', (req) => {
      const host = new URL(req.url()).host;
      if (host !== new URL(page.url()).host && host !== 'cdn.discordapp.com') external.push(req.url());
    });
    const data = page.waitForResponse((res) => /data[^/]*\.json/.test(res.url()));
    await openPicker(page);
    expect((await data).ok()).toBe(true);
    await pickerSearch(page).fill('grinsendes');
    await expect(pickerEmoji(page, 'grinsendes Gesicht')).toBeVisible();
    expect(external).toEqual([]);
  });

  test('eingefügtes Emoji aktualisiert die Vorschau, neues Formular setzt sie zurück', async ({ page }) => {
    await page.locator('#entry-emoji-input').fill('<:blau:400000000000000001>');
    await expect(pickerPreview(page).locator('img')).toHaveAttribute('alt', 'blau');
    await page.locator('#cancel-entry-btn').click();
    await openEntryForm(page, MSG_REACTION);
    await expect(page.locator('#entry-emoji-input')).toHaveValue('');
    await expect(pickerPreview(page)).toHaveClass(/opacity-40/);
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

test.describe('Nachricht bearbeiten', () => {
  const form = (page: Page) => page.locator('#new-message-form');

  test('Formular ist vorbefüllt, Channel und Anzeige-Modus sind ausgeblendet', async ({ page }) => {
    await page.goto(PAGE);
    await messageBlock(page, MSG_REACTION).locator('[data-edit-message]').click();

    await expect(form(page)).toBeVisible();
    await expect(page.locator('#message-form-title')).toHaveText(t('reaction_roles.edit_message_form_title'));
    await expect(page.locator('#confirm-new-message-btn')).toHaveText(t('common.save'));
    await expect(page.locator('#new-msg-title')).toHaveValue('Rollen-Auswahl');
    await expect(page.locator('#new-msg-desc')).toHaveValue('**Wähle** deine Farbe'); // Rohtext, nicht gerendert
    await expect(page.locator('#new-msg-desc-preview strong')).toHaveText('Wähle');
    await expect(page.locator('#new-msg-channel-wrap')).toBeHidden();
    await expect(page.locator('#new-msg-display-wrap')).toBeHidden();
  });

  test('Speichern schickt Titel und Text und aktualisiert die Anzeige', async ({ page }) => {
    const dialogs = collectDialogs(page);
    await page.goto(PAGE);
    await messageBlock(page, MSG_REACTION).locator('[data-edit-message]').click();
    await page.locator('#new-msg-title').fill(`Neu ${XSS}`);
    await page.locator('#new-msg-desc').fill(`**Neu** ${XSS}`);
    await page.locator('#confirm-new-message-btn').click();

    expect(await waitForBotCall('reaction_roles/update-message')).toMatchObject({
      message_id: MSG_REACTION, title: `Neu ${XSS}`, description: `**Neu** ${XSS}`,
    });
    const block = messageBlock(page, MSG_REACTION);
    await expect(block.locator('[data-msg-title]')).toHaveText(`Neu ${XSS}`);
    await expect(block.locator('[data-msg-desc] strong')).toHaveText('Neu');
    await expect(block.locator('[data-msg-desc] img')).toHaveCount(0);
    await expect(form(page)).toBeHidden();
    expect(await botCalls('reaction_roles/create-message')).toHaveLength(0);

    // Erneut öffnen: das Formular zeigt den gespeicherten Stand, nicht den vom Seitenaufruf
    await block.locator('[data-edit-message]').click();
    await expect(page.locator('#new-msg-title')).toHaveValue(`Neu ${XSS}`);
    expect(dialogs).toHaveLength(0); // status "updated" → kein Hinweis
    await expectNoXss(page);
  });

  for (const [status, key] of [['saved_only', 'edit_status_saved_only'], ['not_own', 'edit_status_not_own'], ['failed', 'edit_status_failed']]) {
    test(`Status „${status}“ des Bots wird als Hinweis angezeigt`, async ({ page }) => {
      await resetBot({ 'reaction_roles/update-message': { data: { message_id: MSG_REACTION, status } } });
      const dialogs = collectDialogs(page);
      await page.goto(PAGE);
      await messageBlock(page, MSG_REACTION).locator('[data-edit-message]').click();
      await page.locator('#new-msg-title').fill('Anders');
      await page.locator('#confirm-new-message-btn').click();

      await expect.poll(() => dialogs).toContain(t(`reaction_roles.${key}`));
      await expect(messageBlock(page, MSG_REACTION).locator('[data-msg-title]')).toHaveText('Anders');
    });
  }

  test('Fehler des Bots: Hinweis, Formular bleibt offen, Anzeige unverändert', async ({ page }) => {
    await resetBot({ 'reaction_roles/update-message': { status: 400, error: 'Titel zu lang (max. 256 Zeichen)' } });
    const dialogs = collectDialogs(page);
    await page.goto(PAGE);
    await messageBlock(page, MSG_REACTION).locator('[data-edit-message]').click();
    await page.locator('#new-msg-title').fill('Anders');
    await page.locator('#confirm-new-message-btn').click();

    await expect.poll(() => dialogs.join('\n')).toContain('Titel zu lang');
    await expect(form(page)).toBeVisible();
    await expect(messageBlock(page, MSG_REACTION).locator('[data-msg-title]')).toHaveText('Rollen-Auswahl');
  });

  test('nach dem Bearbeiten legt „Neue Nachricht“ wieder eine neue an', async ({ page }) => {
    await page.goto(PAGE);
    await messageBlock(page, MSG_REACTION).locator('[data-edit-message]').click();
    await page.locator('#cancel-new-message-btn').click();

    await page.locator('#new-message-btn').click();
    await expect(page.locator('#message-form-title')).toHaveText(t('reaction_roles.new_message_form_title'));
    await expect(page.locator('#new-msg-title')).toHaveValue('');
    await expect(page.locator('#new-msg-channel-wrap')).toBeVisible();
    await page.locator('#new-msg-title').fill('Frisch');
    await page.locator('#new-msg-desc').fill('Text');
    await page.locator('#confirm-new-message-btn').click();

    await waitForBotCall('reaction_roles/create-message');
    expect(await botCalls('reaction_roles/update-message')).toHaveLength(0);
  });

  test('neu angelegte Nachricht lässt sich direkt bearbeiten', async ({ page }) => {
    await page.goto(PAGE);
    await page.locator('#new-message-btn').click();
    await page.locator('#new-msg-title').fill('Erst');
    await page.locator('#new-msg-desc').fill('Text');
    await page.locator('#confirm-new-message-btn').click();
    await waitForBotCall('reaction_roles/create-message');

    const block = messageBlock(page, '700000000000000009');
    await block.locator('[data-edit-message]').click();
    await expect(page.locator('#new-msg-title')).toHaveValue('Erst');
    await page.locator('#new-msg-title').fill('Dann');
    await page.locator('#confirm-new-message-btn').click();
    expect(await waitForBotCall('reaction_roles/update-message')).toMatchObject({ message_id: '700000000000000009', title: 'Dann' });
    await expect(block.locator('[data-msg-title]')).toHaveText('Dann');
  });
});

test.describe('Zuordnungen', () => {
  test('neue Zuordnung zeigt ihr Emoji wie die Seite: Server-Emoji als Bild, sonst Twemoji', async ({ page }) => {
    await page.goto(PAGE);
    await openEntryForm(page, MSG_DROPDOWN);
    await openPicker(page);
    await pickerSearch(page).fill('party');
    await pickerEmoji(page, 'party').click();
    await page.locator('#confirm-entry-btn').click();
    expect(await waitForBotCall('reaction_roles/add-entry')).toMatchObject({ emoji: '<a:party:400000000000000002>' });
    const img = messageBlock(page, MSG_DROPDOWN).locator('[data-entry-row="99"] [data-entry-emoji] img');
    await expect(img).toHaveAttribute('src', 'https://cdn.discordapp.com/emojis/400000000000000002.gif');
    await expect(img).toHaveAttribute('alt', 'party');
  });

  test('neue Zuordnung mit Standard-Emoji nutzt Twemoji', async ({ page }) => {
    await page.goto(PAGE);
    await openEntryForm(page, MSG_DROPDOWN);
    await page.locator('#entry-emoji-input').fill('👍🏽');
    await page.locator('#confirm-entry-btn').click();
    await waitForBotCall('reaction_roles/add-entry');
    const emoji = messageBlock(page, MSG_DROPDOWN).locator('[data-entry-row="99"] [data-entry-emoji] .emoji-twemoji');
    await expect(emoji).toHaveText('👍🏽');
  });

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

  test('mit Premium auf dem Handy: neue Unique-Zuordnung zeigt den Rollennamen', async ({ page }) => {
    await resetBot(withPremium);
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(PAGE);
    await openEntryForm(page, MSG_DROPDOWN);
    await page.locator('#entry-role-select').selectOption(ROLES[1].id);
    await page.locator('#entry-mode-select').selectOption('unique');
    await page.locator('#entry-group-select').selectOption('5');
    await page.locator('#entry-emoji-input').fill('🔵');
    await page.locator('#confirm-entry-btn').click();
    const name = messageBlock(page, MSG_DROPDOWN).locator('[data-entry-row="99"] [data-role-name]');
    await expect(name).toBeVisible();
    expect(await isFullyShown(name)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  });

  for (const emoji of ['1️⃣', '🏴󠁧󠁢󠁥󠁮󠁧󠁿', '👍🏽', '🇩🇪']) {
    test(`${emoji} wird als Emoji akzeptiert`, async ({ page }) => {
      await page.goto(PAGE);
      await openEntryForm(page, MSG_REACTION);
      await page.locator('#entry-emoji-input').fill(emoji);
      await page.locator('#confirm-entry-btn').click();
      expect(await waitForBotCall('reaction_roles/add-entry')).toMatchObject({ emoji });
    });
  }

  test('ungültiges oder fehlendes Emoji wird abgelehnt, ohne den Bot zu fragen', async ({ page }) => {
    const dialogs = collectDialogs(page);
    await page.goto(PAGE);
    await openEntryForm(page, MSG_REACTION);
    await page.locator('#confirm-entry-btn').click();
    await expect.poll(() => dialogs).toContain(t('reaction_roles.alert_emoji_required'));

    // Ziffern und # allein sind kein Emoji, erst mit Keycap (1️⃣)
    for (const value of [`abc${XSS}`, '1', '#']) {
      dialogs.length = 0;
      await page.locator('#entry-emoji-input').fill(value);
      await page.locator('#confirm-entry-btn').click();
      await expect.poll(() => dialogs, value).toContain(t('reaction_roles.alert_invalid_emoji'));
    }
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
  const sidebarLink = (page: Page, sub: string) => page.locator(`aside a[href="/server/${GUILD_ID}/${sub}"]`).first();

  async function navigateToReactionRoles(page: Page) {
    await page.evaluate(() => ((window as any).__noReload = true));
    await sidebarLink(page, 'reaction-roles/').click();
    await expect(page).toHaveURL(new RegExp(`/server/${GUILD_ID}/reaction-roles/$`));
    await expect(page.locator('#messages-list')).toBeVisible();
    expect(await page.evaluate(() => (window as any).__noReload)).toBe(true);
  }

  test('über die Sidebar geöffnet funktionieren Formulare und Vorschau', async ({ page }) => {
    await page.goto(guildPath('settings/'));
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
    await page.goto(guildPath('settings/'));
    for (let i = 0; i < 3; i++) {
      await navigateToReactionRoles(page);
      await sidebarLink(page, 'settings/').click();
      await expect(page).toHaveURL(new RegExp(`/server/${GUILD_ID}/settings/$`));
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
