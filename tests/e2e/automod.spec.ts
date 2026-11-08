import { test, expect, type Page } from '@playwright/test';
import { login, resetBot, waitForBotCall, botCalls, collectDialogs, guildPath, t } from './support/helpers';
import { CHANNELS, defaultBotData } from './support/fixtures.mjs';
import { GUILD_ID } from './support/env.mjs';

// AutoMod: Regeln an/aus, Keyword-Liste, Anti-Nuke-Shield und Honeypot-Channel.

const PAGE = guildPath('automod/');
const HONEYPOT_PAGE = guildPath('automod/#honeypot');
const XSS = '<img src=x onerror="window.__xss=1">';
const status = defaultBotData['automod/status'];
const withStatus = (values: Record<string, unknown>) => ({ 'automod/status': { data: { ...status, ...values } } });

const ruleSwitch = (page: Page, key: 'spam' | 'mentions' | 'keywords') => page.locator(`[data-automod-toggle="${key}"]`);
const shieldSwitch = (page: Page) => page.locator('#shield-toggle');
const keywords = (page: Page) => page.locator('#keywords-display');
const keywordsForm = (page: Page) => page.locator('#keywords-form');
const keywordsTextarea = (page: Page) => page.locator('#keywords-textarea');
const honeypotActive = (page: Page) => page.locator('#honeypot-active');
const honeypotInactive = (page: Page) => page.locator('#honeypot-inactive');
const titleInput = (page: Page) => page.locator('#honeypot-title-input');
const textInput = (page: Page) => page.locator('#honeypot-text-input');
const saveTextBtn = (page: Page) => page.locator('#save-honeypot-text-btn');
const savePunishBtn = (page: Page) => page.locator('#save-honeypot-punish-btn');
const expectOn = (sw: ReturnType<typeof shieldSwitch>, on: boolean) => expect(sw).toHaveAttribute('aria-checked', String(on));
const expectNoXss = async (page: Page) => expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();

test.beforeEach(async ({ context }) => {
  await resetBot();
  await login(context);
});

test.describe('Übersicht', () => {
  test('Schalter zeigen den Zustand des Bots', async ({ page }) => {
    await page.goto(PAGE);
    await expectOn(ruleSwitch(page, 'spam'), true);
    await expectOn(ruleSwitch(page, 'mentions'), false);
    await expectOn(ruleSwitch(page, 'keywords'), true);
    await expectOn(shieldSwitch(page), false);
  });

  test('Keywords werden als Text angezeigt', async ({ page }) => {
    await resetBot(withStatus({ keywords: ['spoiler', XSS] }));
    await page.goto(PAGE);
    await expect(keywords(page)).toContainText('spoiler');
    await expect(keywords(page)).toContainText(XSS);
    await expect(keywords(page).locator('img')).toHaveCount(0);
    await expectNoXss(page);
  });

  test('ohne Keywords erscheint ein Hinweis', async ({ page }) => {
    await resetBot(withStatus({ keywords: [] }));
    await page.goto(PAGE);
    await expect(keywords(page)).toHaveText(t('automod.no_keywords'));
  });

  test('ohne Honeypot gibt es den Erstellen-Button', async ({ page }) => {
    await page.goto(HONEYPOT_PAGE);
    await expect(page.locator('#create-honeypot-btn')).toBeVisible();
    await expect(honeypotActive(page)).toBeHidden();
  });

  test('vorhandener Honeypot zeigt den Channel-Namen, unbekannter Channel die ID', async ({ page }) => {
    await resetBot(withStatus({ honeypot_channel_id: CHANNELS[0].id }));
    await page.goto(HONEYPOT_PAGE);
    await expect(page.locator('#honeypot-channel-label')).toHaveText(`#${CHANNELS[0].name}`);
    await expect(honeypotInactive(page)).toBeHidden();

    await resetBot(withStatus({ honeypot_channel_id: '299999999999999999' }));
    await page.reload();
    await expect(page.locator('#honeypot-channel-label')).toHaveText('#299999999999999999');
  });

  test('ohne Bot-Daten erscheint der Offline-Hinweis und keine Schalter', async ({ page }) => {
    await resetBot({ 'automod/status': { status: 500, error: 'internal_error' } });
    await page.goto(PAGE);
    await expect(page.getByText(t('common.bot_offline'))).toBeVisible();
    await expect(page.locator('[data-automod-toggle]')).toHaveCount(0);
  });
});

test.describe('Regeln und Shield', () => {
  test('Regel umschalten: Payload und Schalter, zweimal hintereinander', async ({ page }) => {
    await page.goto(PAGE);
    await ruleSwitch(page, 'spam').click();
    expect(await waitForBotCall('automod/toggle-rule')).toMatchObject({ rule_key: 'spam' });
    await expectOn(ruleSwitch(page, 'spam'), false);
    await expect(ruleSwitch(page, 'spam')).toBeEnabled();

    await ruleSwitch(page, 'spam').click();
    await waitForBotCall('automod/toggle-rule', 1);
    await expectOn(ruleSwitch(page, 'spam'), true);

    await ruleSwitch(page, 'mentions').click();
    expect(await waitForBotCall('automod/toggle-rule', 2)).toMatchObject({ rule_key: 'mentions' });
    await expectOn(ruleSwitch(page, 'mentions'), true);
  });

  test('Fehler beim Umschalten: Meldung, Schalter bleibt wie er war', async ({ page }) => {
    await resetBot({ 'automod/toggle-rule': { status: 400, error: 'Eine fremde AutoMod-Regel dieses Typs existiert bereits' } });
    const dialogs = collectDialogs(page);
    await page.goto(PAGE);
    await ruleSwitch(page, 'mentions').click();
    await expect.poll(() => dialogs.join('\n')).toContain('Eine fremde AutoMod-Regel');
    await expectOn(ruleSwitch(page, 'mentions'), false);
    await expect(ruleSwitch(page, 'mentions')).toBeEnabled();
  });

  test('Shield: der Schalter zeigt, was der Bot zurückmeldet', async ({ page }) => {
    await page.goto(PAGE);
    await shieldSwitch(page).click();
    await waitForBotCall('automod/toggle-shield');
    await expectOn(shieldSwitch(page), true);

    // Meldet der Bot „aus“, bleibt der Schalter aus — auch wenn er vorher „aus“ war
    await resetBot({ 'automod/toggle-shield': { data: { shield_enabled: false } } });
    await shieldSwitch(page).click();
    await waitForBotCall('automod/toggle-shield');
    await expectOn(shieldSwitch(page), false);
  });
});

test.describe('Keywords', () => {
  test('Bearbeiten: Formular mit aktueller Liste, Speichern normalisiert die Eingabe', async ({ page }) => {
    await page.goto(PAGE);
    await page.locator('#edit-keywords-btn').click();
    await expect(keywordsForm(page)).toBeVisible();
    await expect(keywordsTextarea(page)).toHaveValue('spoiler\nkaufen');

    await keywordsTextarea(page).fill(`  Foo \n\nBAR\n${XSS}\n`);
    await page.locator('#confirm-keywords-btn').click();
    expect((await waitForBotCall('automod/set-keywords')).keywords).toEqual(['foo', 'bar', XSS]);

    await expect(keywordsForm(page)).toBeHidden();
    await expect(keywords(page).locator('span')).toHaveText(['foo', 'bar', XSS]);
    await expectNoXss(page);
  });

  test('leere Liste speichern zeigt den Hinweis', async ({ page }) => {
    await page.goto(PAGE);
    await page.locator('#edit-keywords-btn').click();
    await keywordsTextarea(page).fill('');
    await page.locator('#confirm-keywords-btn').click();
    expect((await waitForBotCall('automod/set-keywords')).keywords).toEqual([]);
    await expect(keywords(page)).toHaveText(t('automod.no_keywords'));
  });

  test('Fehler beim Speichern: Meldung, Formular bleibt offen, Anzeige unverändert', async ({ page }) => {
    await resetBot({ 'automod/set-keywords': { status: 400, error: 'keywords muss eine Liste sein' } });
    const dialogs = collectDialogs(page);
    await page.goto(PAGE);
    await page.locator('#edit-keywords-btn').click();
    await keywordsTextarea(page).fill('neu');
    await page.locator('#confirm-keywords-btn').click();
    await expect.poll(() => dialogs.join('\n')).toContain('keywords muss eine Liste sein');
    await expect(keywordsForm(page)).toBeVisible();
    await expect(keywords(page).locator('span')).toHaveText(['spoiler', 'kaufen']);
    await expect(page.locator('#confirm-keywords-btn')).toBeEnabled();
  });
});

test.describe('Honeypot', () => {
  test('Erstellen: Pflichtfelder, Payload, danach aktiver Honeypot', async ({ page }) => {
    const dialogs = collectDialogs(page);
    await page.goto(HONEYPOT_PAGE);
    await page.locator('#create-honeypot-btn').click();
    await page.locator('#honeypot-name-input').fill('falle');
    await page.locator('#confirm-honeypot-btn').click();
    await expect.poll(() => dialogs).toEqual([t('automod.alert_honeypot_required')]);
    expect(await botCalls('automod/create-honeypot')).toHaveLength(0);

    await page.locator('#honeypot-warntext-input').fill('  Nicht schreiben!  ');
    await page.locator('#confirm-honeypot-btn').click();
    expect(await waitForBotCall('automod/create-honeypot')).toMatchObject({ name: 'falle', title: '', warn_text: 'Nicht schreiben!' });
    await expect(page.locator('#honeypot-channel-label')).toHaveText('#honeypot-falle');
    await expect(honeypotActive(page)).toBeVisible();
    await expect(honeypotInactive(page)).toBeHidden();
    await expect(page.locator('#honeypot-message-section')).toBeVisible();
    await expect(page.locator('#honeypot-punish-section')).toBeVisible();
    // Bearbeiten-Felder zeigen den gespeicherten Stand (leerer Titel → Standardtitel vom Bot)
    await expect(titleInput(page)).toHaveValue('⚠️ Achtung');
    await expect(textInput(page)).toHaveValue('Nicht schreiben!');
    await expect(saveTextBtn(page)).toBeDisabled();
  });

  test('Erstellen mit eigenem Titel', async ({ page }) => {
    await page.goto(HONEYPOT_PAGE);
    await page.locator('#create-honeypot-btn').click();
    await page.locator('#honeypot-name-input').fill('falle');
    await page.locator('#honeypot-new-title-input').fill('  🚫 Finger weg  ');
    await page.locator('#honeypot-warntext-input').fill('Text');
    await page.locator('#confirm-honeypot-btn').click();
    expect(await waitForBotCall('automod/create-honeypot')).toMatchObject({ title: '🚫 Finger weg' });
    await expect(titleInput(page)).toHaveValue('🚫 Finger weg');
  });

  test('Fehler beim Erstellen: Meldung, Formular bleibt offen', async ({ page }) => {
    await resetBot({ 'automod/create-honeypot': { status: 400, error: 'Es existiert bereits ein Honeypot — zuerst löschen' } });
    const dialogs = collectDialogs(page);
    await page.goto(HONEYPOT_PAGE);
    await page.locator('#create-honeypot-btn').click();
    await page.locator('#honeypot-name-input').fill('falle');
    await page.locator('#honeypot-warntext-input').fill('Text');
    await page.locator('#confirm-honeypot-btn').click();
    await expect.poll(() => dialogs.join('\n')).toContain('Es existiert bereits ein Honeypot');
    await expect(page.locator('#honeypot-form')).toBeVisible();
    await expect(honeypotActive(page)).toBeHidden();
  });

  test('Löschen: Rückfrage, danach wieder der Erstellen-Button', async ({ page }) => {
    await resetBot(withStatus({ honeypot_channel_id: CHANNELS[0].id }));
    const dialogs = collectDialogs(page);
    await page.goto(HONEYPOT_PAGE);
    await page.locator('#delete-honeypot-btn').click();
    await waitForBotCall('automod/delete-honeypot');
    expect(dialogs).toEqual([t('automod.confirm_delete_honeypot')]);
    await expect(honeypotActive(page)).toBeHidden();
    await expect(page.locator('#create-honeypot-btn')).toBeVisible();
    await expect(page.locator('#honeypot-message-section')).toBeHidden();
    await expect(page.locator('#honeypot-punish-section')).toBeHidden();
  });

  test('Löschen abgebrochen: nichts wird gesendet', async ({ page }) => {
    await resetBot(withStatus({ honeypot_channel_id: CHANNELS[0].id }));
    const dialogs = collectDialogs(page, { accept: false });
    await page.goto(HONEYPOT_PAGE);
    await page.locator('#delete-honeypot-btn').click();
    await expect.poll(() => dialogs.length).toBe(1);
    await page.waitForTimeout(300);
    expect(await botCalls('automod/delete-honeypot')).toHaveLength(0);
    await expect(honeypotActive(page)).toBeVisible();
  });
});

test.describe('Honeypot bearbeiten', () => {
  const ACTIVE = { honeypot_channel_id: CHANNELS[0].id, honeypot_catches: 1234 };

  test('zeigt Fänge, Texte und Bestrafung aus dem Bot', async ({ page }) => {
    await resetBot(withStatus({ ...ACTIVE, honeypot_title: XSS, honeypot_text: 'Zeile 1\nZeile 2', honeypot_punish_members: 'ban', honeypot_punish_bots: 'timeout', honeypot_timeout_days: 14 }));
    await page.goto(HONEYPOT_PAGE);
    await expect(page.locator('#honeypot-catches')).toHaveText(t('automod.honeypot_catches', { count: (1234).toLocaleString('de-DE') }));
    await expect(titleInput(page)).toHaveValue(XSS);
    await expect(textInput(page)).toHaveValue('Zeile 1\nZeile 2');
    await expect(page.locator('#honeypot-punish-members')).toHaveValue('ban');
    await expect(page.locator('#honeypot-punish-bots')).toHaveValue('timeout');
    await expect(page.locator('#honeypot-days')).toHaveValue('14');
    await expect(saveTextBtn(page)).toBeDisabled();
    await expect(savePunishBtn(page)).toBeDisabled();
    await expectNoXss(page);
  });

  test('ältere Dauer (5 Tage) bleibt in der Auswahl', async ({ page }) => {
    await resetBot(withStatus({ ...ACTIVE, honeypot_timeout_days: 5 }));
    await page.goto(HONEYPOT_PAGE);
    await expect(page.locator('#honeypot-days')).toHaveValue('5');
    await expect(page.locator('#honeypot-days option')).toHaveText(['1 Tag', '3 Tage', '5 Tage', '7 Tage', '14 Tage', '28 Tage'].map((x) => x));
  });

  test('ältere Bot-Version ohne neue Felder: bisheriges Verhalten als Standard', async ({ page }) => {
    const { honeypot_title, honeypot_text, honeypot_punish_members, honeypot_punish_bots, honeypot_day_options, ...old } = status as any;
    await resetBot({ 'automod/status': { data: { ...old, ...ACTIVE } } });
    await page.goto(HONEYPOT_PAGE);
    await expect(page.locator('#honeypot-punish-members')).toHaveValue('timeout');
    await expect(page.locator('#honeypot-punish-bots')).toHaveValue('kick');
    await expect(titleInput(page)).toHaveValue('');
  });

  test('Text speichern: erst nach Änderung möglich, schickt Titel und Text, übernimmt den Stand des Bots', async ({ page }) => {
    await resetBot(withStatus(ACTIVE));
    await page.goto(HONEYPOT_PAGE);
    await textInput(page).fill('Neuer Text');
    await expect(saveTextBtn(page)).toBeEnabled();
    await textInput(page).fill('Nicht schreiben!');   // zurück auf den gespeicherten Stand
    await expect(saveTextBtn(page)).toBeDisabled();

    await titleInput(page).fill('');
    await textInput(page).fill('  Neuer Text  ');
    await saveTextBtn(page).click();
    expect(await waitForBotCall('automod/set-honeypot-text')).toEqual(expect.objectContaining({ title: '', warn_text: 'Neuer Text' }));
    await expect(titleInput(page)).toHaveValue('⚠️ Achtung');   // Standardtitel vom Bot
    await expect(textInput(page)).toHaveValue('Neuer Text');
    await expect(saveTextBtn(page)).toBeDisabled();
    await expect(saveTextBtn(page)).toHaveText(t('common.save'));
  });

  test('Text speichern: leerer Warntext wird nicht gesendet', async ({ page }) => {
    await resetBot(withStatus(ACTIVE));
    const dialogs = collectDialogs(page);
    await page.goto(HONEYPOT_PAGE);
    await textInput(page).fill('   ');
    await saveTextBtn(page).click();
    await expect.poll(() => dialogs).toEqual([t('automod.alert_warn_text_required')]);
    expect(await botCalls('automod/set-honeypot-text')).toHaveLength(0);
    await expect(saveTextBtn(page)).toBeEnabled();
  });

  for (const [botStatus, key] of [['reposted', 'alert_text_reposted'], ['saved_only', 'alert_text_saved_only']] as const) {
    test(`Text speichern: Hinweis bei Status „${botStatus}“`, async ({ page }) => {
      await resetBot({ ...withStatus(ACTIVE), 'automod/set-honeypot-text': { data: { title: 'T', text: 'X', status: botStatus } } });
      const dialogs = collectDialogs(page);
      await page.goto(HONEYPOT_PAGE);
      await textInput(page).fill('X');
      await saveTextBtn(page).click();
      await expect.poll(() => dialogs).toEqual([t(`automod.${key}`)]);
      await expect(textInput(page)).toHaveValue('X');
    });
  }

  test('Text speichern: Fehler des Bots, Änderung bleibt', async ({ page }) => {
    await resetBot({ ...withStatus(ACTIVE), 'automod/set-honeypot-text': { status: 400, error: 'Es gibt keinen Honeypot.' } });
    const dialogs = collectDialogs(page);
    await page.goto(HONEYPOT_PAGE);
    await textInput(page).fill('X');
    await saveTextBtn(page).click();
    await expect.poll(() => dialogs.join('\n')).toContain('Es gibt keinen Honeypot.');
    await expect(textInput(page)).toHaveValue('X');
    await expect(saveTextBtn(page)).toBeEnabled();
  });

  test('Bestrafung speichern: nur Geändertes, Dauer als Zahl', async ({ page }) => {
    await resetBot(withStatus(ACTIVE));
    await page.goto(HONEYPOT_PAGE);
    await page.locator('#honeypot-punish-bots').selectOption('ban');
    await page.locator('#honeypot-days').selectOption('14');
    await savePunishBtn(page).click();
    expect(await waitForBotCall('automod/set-honeypot-punishment')).toEqual(expect.objectContaining({ bots: 'ban', days: 14 }));
    expect((await botCalls('automod/set-honeypot-punishment'))[0].body).not.toHaveProperty('members');
    // Erst weiter, wenn die Seite mit dem Speichern fertig ist — während des Speicherns ist der Button ohnehin
    // gesperrt, und die Antwort des Bots würde eine schon gemachte Auswahl wieder überschreiben
    await expect(savePunishBtn(page)).toHaveText(t('common.save'));
    await expect(savePunishBtn(page)).toBeDisabled();

    // Neuer Ausgangsstand: erneut ändern schickt nur das Neue
    await page.locator('#honeypot-punish-members').selectOption('kick');
    await savePunishBtn(page).click();
    const second = await waitForBotCall('automod/set-honeypot-punishment', 1);
    expect(second.members).toBe('kick');
    expect(second).not.toHaveProperty('bots');
    expect(second).not.toHaveProperty('days');
  });
});

test.describe('Honeypot: Markdown und Vorschau', () => {
  test('Bearbeiten: Vorschau zeigt den gespeicherten Text formatiert und ohne HTML', async ({ page }) => {
    await resetBot(withStatus({ honeypot_channel_id: CHANNELS[0].id, honeypot_text: `**fett** ${XSS}` }));
    await page.goto(HONEYPOT_PAGE);
    const preview = page.locator('#honeypot-text-preview');
    await expect(preview.locator('strong')).toHaveText('fett');
    await expect(preview.locator('img')).toHaveCount(0);
    await expect(preview).toContainText('<img src=x');
    await expectNoXss(page);
  });

  test('Bearbeiten: Toolbar formatiert die Auswahl, Vorschau und Speichern folgen', async ({ page }) => {
    await resetBot(withStatus({ honeypot_channel_id: CHANNELS[0].id, honeypot_text: 'Achtung' }));
    await page.goto(HONEYPOT_PAGE);
    await expect(saveTextBtn(page)).toBeDisabled();
    await textInput(page).selectText();
    await page.locator('[data-md-toolbar="honeypot-text-input"] [data-md="bold"]').click();
    await expect(textInput(page)).toHaveValue('**Achtung**');
    await expect(page.locator('#honeypot-text-preview strong')).toHaveText('Achtung');
    await expect(saveTextBtn(page)).toBeEnabled();
  });

  test('Erstellen: Toolbar und Vorschau am Warntext', async ({ page }) => {
    await page.goto(HONEYPOT_PAGE);
    await page.locator('#create-honeypot-btn').click();
    const preview = page.locator('#honeypot-warntext-preview');
    await expect(preview).toHaveText('—');
    await page.locator('#honeypot-warntext-input').fill('Nicht schreiben');
    await page.locator('#honeypot-warntext-input').selectText();
    await page.locator('[data-md-toolbar="honeypot-warntext-input"] [data-md="italic"]').click();
    await expect(page.locator('#honeypot-warntext-input')).toHaveValue('*Nicht schreiben*');
    await expect(preview.locator('em')).toHaveText('Nicht schreiben');
  });

  test('Fänge und Hinweis sind durch „ · “ getrennt', async ({ page }) => {
    await resetBot(withStatus({ honeypot_channel_id: CHANNELS[0].id }));
    await page.goto(HONEYPOT_PAGE);
    await expect(page.locator('#honeypot-catches').locator('xpath=..')).toContainText(' · ');
  });
});

test.describe('Tabs', () => {
  test('Start im AutoMod-Tab, der Honeypot liegt im eigenen Tab', async ({ page }) => {
    await page.goto(PAGE);
    await expect(ruleSwitch(page, 'spam')).toBeVisible();
    await expect(page.locator('#create-honeypot-btn')).toBeHidden();

    await page.getByRole('tab', { name: t('automod.tab_honeypot') }).click();
    await expect(page.locator('#create-honeypot-btn')).toBeVisible();
    await expect(ruleSwitch(page, 'spam')).toBeHidden();
    await expect(page).toHaveURL(/#honeypot$/);

    await page.getByRole('tab', { name: t('automod.tab_automod') }).click();
    await expect(ruleSwitch(page, 'spam')).toBeVisible();
  });

  test('#honeypot öffnet direkt den Honeypot-Tab, auch nach dem Neuladen', async ({ page }) => {
    await page.goto(HONEYPOT_PAGE);
    await expect(page.locator('#create-honeypot-btn')).toBeVisible();
    await page.reload();
    await expect(page.locator('#create-honeypot-btn')).toBeVisible();
    await expect(ruleSwitch(page, 'spam')).toBeHidden();
  });

  test('ohne Honeypot gibt es nur den Erstellen-Bereich, mit Honeypot alle drei Bereiche', async ({ page }) => {
    await page.goto(HONEYPOT_PAGE);
    await expect(page.locator('#honeypot-message-section')).toBeHidden();
    await expect(page.locator('#honeypot-punish-section')).toBeHidden();

    await resetBot(withStatus({ honeypot_channel_id: CHANNELS[0].id }));
    await page.reload();
    await expect(page.locator('#honeypot-message-section')).toBeVisible();
    await expect(page.locator('#honeypot-punish-section')).toBeVisible();
    await expect(page.locator('#create-honeypot-btn')).toBeHidden();
  });
});

test.describe('Anzeige passt zum Bot', () => {
  test('Abbrechen verwirft ungespeicherte Keywords', async ({ page }) => {
    await page.goto(PAGE);
    await page.locator('#edit-keywords-btn').click();
    await keywordsTextarea(page).fill('verworfen');
    await page.locator('#cancel-keywords-btn').click();
    await page.locator('#edit-keywords-btn').click();
    await expect(keywordsTextarea(page)).toHaveValue('spoiler\nkaufen', { timeout: 2000 });
  });

  test('nach dem Speichern zeigt das Formular die gespeicherte Liste', async ({ page }) => {
    await page.goto(PAGE);
    await page.locator('#edit-keywords-btn').click();
    await keywordsTextarea(page).fill('  Foo \n\nBAR');
    await page.locator('#confirm-keywords-btn').click();
    await expect(keywordsForm(page)).toBeHidden();
    await page.locator('#edit-keywords-btn').click();
    await expect(keywordsTextarea(page)).toHaveValue('foo\nbar', { timeout: 2000 });
  });

  test('Keywords speichern ohne Regel: der Schalter zeigt die neu angelegte, aktive Regel', async ({ page }) => {
    // Gibt es noch keine Keyword-Regel, legt der Bot sie beim Speichern aktiv an und meldet das zurück
    await resetBot({
      ...withStatus({ keywords_enabled: false, keywords: [] }),
      'automod/set-keywords': { data: { keywords: ['foo'], enabled: true } },
    });
    await page.goto(PAGE);
    await page.locator('#edit-keywords-btn').click();
    await keywordsTextarea(page).fill('foo');
    await page.locator('#confirm-keywords-btn').click();
    await waitForBotCall('automod/set-keywords');
    await expect(keywordsForm(page)).toBeHidden();
    await expectOn(ruleSwitch(page, 'keywords'), true);
  });

  test('Regel umschalten: der Schalter folgt dem Zustand, den der Bot meldet', async ({ page }) => {
    // Seite zeigt „an“, die Regel wurde aber inzwischen in Discord abgeschaltet → der Bot schaltet sie wieder an
    await resetBot({ 'automod/toggle-rule': { data: { rule_key: 'spam', enabled: true } } });
    await page.goto(PAGE);
    await ruleSwitch(page, 'spam').click();
    await waitForBotCall('automod/toggle-rule');
    await expect(ruleSwitch(page, 'spam')).toBeEnabled();
    await expectOn(ruleSwitch(page, 'spam'), true);
  });

  test('Honeypot-Beschreibung verweist auf /honeypot', async ({ page }) => {
    await page.goto(HONEYPOT_PAGE);
    await expect(page.getByText(t('automod.honeypot_desc'))).toBeVisible({ timeout: 2000 });
  });
});

test.describe('Navigation ohne Neuladen (ClientRouter)', () => {
  const sidebarLink = (page: Page, sub: string) => page.locator(`aside a[href="/server/${GUILD_ID}/${sub}"]`).first();

  test('mehrfach hin und zurück: Umschalten wird genau einmal gesendet', async ({ page }) => {
    collectDialogs(page);
    await page.goto(guildPath('settings/'));
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => ((window as any).__noReload = true));
      await sidebarLink(page, 'automod/').click();
      await expect(ruleSwitch(page, 'spam')).toBeVisible();
      await sidebarLink(page, 'settings/').click();
      await expect(page).toHaveURL(new RegExp(`/server/${GUILD_ID}/settings/$`));
    }
    await sidebarLink(page, 'automod/').click();
    await expect(ruleSwitch(page, 'spam')).toBeVisible();
    expect(await page.evaluate(() => (window as any).__noReload)).toBe(true);

    await ruleSwitch(page, 'spam').click();
    await waitForBotCall('automod/toggle-rule');
    await page.waitForTimeout(500); // etwaige doppelte Aufrufe abwarten
    expect(await botCalls('automod/toggle-rule')).toHaveLength(1);
    await expectOn(ruleSwitch(page, 'spam'), false);

    await page.locator('#edit-keywords-btn').click();
    await expect(keywordsForm(page)).toBeVisible();
  });
});
