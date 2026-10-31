import { test, expect, type Page } from '@playwright/test';
import { login, resetBot, waitForBotCall, botCalls, collectDialogs, guildPath, t } from './support/helpers';
import { CHANNELS, defaultBotData } from './support/fixtures.mjs';
import { GUILD_ID } from './support/env.mjs';

// AutoMod: Regeln an/aus, Keyword-Liste, Anti-Nuke-Shield und Honeypot-Channel.

const PAGE = guildPath('modules/automod/');
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
    await page.goto(PAGE);
    await expect(page.locator('#create-honeypot-btn')).toBeVisible();
    await expect(honeypotActive(page)).toBeHidden();
  });

  test('vorhandener Honeypot zeigt den Channel-Namen, unbekannter Channel die ID', async ({ page }) => {
    await resetBot(withStatus({ honeypot_channel_id: CHANNELS[0].id }));
    await page.goto(PAGE);
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
    await page.goto(PAGE);
    await page.locator('#create-honeypot-btn').click();
    await page.locator('#honeypot-name-input').fill('falle');
    await page.locator('#confirm-honeypot-btn').click();
    await expect.poll(() => dialogs).toEqual([t('automod.alert_honeypot_required')]);
    expect(await botCalls('automod/create-honeypot')).toHaveLength(0);

    await page.locator('#honeypot-warntext-input').fill('  Nicht schreiben!  ');
    await page.locator('#confirm-honeypot-btn').click();
    expect(await waitForBotCall('automod/create-honeypot')).toMatchObject({ name: 'falle', warn_text: 'Nicht schreiben!' });
    await expect(page.locator('#honeypot-channel-label')).toHaveText('#honeypot-falle');
    await expect(honeypotActive(page)).toBeVisible();
    await expect(honeypotInactive(page)).toBeHidden();
  });

  test('Fehler beim Erstellen: Meldung, Formular bleibt offen', async ({ page }) => {
    await resetBot({ 'automod/create-honeypot': { status: 400, error: 'Es existiert bereits ein Honeypot — zuerst löschen' } });
    const dialogs = collectDialogs(page);
    await page.goto(PAGE);
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
    await page.goto(PAGE);
    await page.locator('#delete-honeypot-btn').click();
    await waitForBotCall('automod/delete-honeypot');
    expect(dialogs).toEqual([t('automod.confirm_delete_honeypot')]);
    await expect(honeypotActive(page)).toBeHidden();
    await expect(page.locator('#create-honeypot-btn')).toBeVisible();
  });

  test('Löschen abgebrochen: nichts wird gesendet', async ({ page }) => {
    await resetBot(withStatus({ honeypot_channel_id: CHANNELS[0].id }));
    const dialogs = collectDialogs(page, { accept: false });
    await page.goto(PAGE);
    await page.locator('#delete-honeypot-btn').click();
    await expect.poll(() => dialogs.length).toBe(1);
    await page.waitForTimeout(300);
    expect(await botCalls('automod/delete-honeypot')).toHaveLength(0);
    await expect(honeypotActive(page)).toBeVisible();
  });
});

test.describe('Anzeige passt zum Bot', () => {
  test('Abbrechen verwirft ungespeicherte Keywords', async ({ page }) => {
    test.fail(true, 'Bekannter Bug: nach Abbrechen steht beim nächsten Öffnen noch der verworfene Text da');
    await page.goto(PAGE);
    await page.locator('#edit-keywords-btn').click();
    await keywordsTextarea(page).fill('verworfen');
    await page.locator('#cancel-keywords-btn').click();
    await page.locator('#edit-keywords-btn').click();
    await expect(keywordsTextarea(page)).toHaveValue('spoiler\nkaufen', { timeout: 2000 });
  });

  test('nach dem Speichern zeigt das Formular die gespeicherte Liste', async ({ page }) => {
    test.fail(true, 'Bekannter Bug: das Formular behält die Roheingabe statt der gespeicherten Liste');
    await page.goto(PAGE);
    await page.locator('#edit-keywords-btn').click();
    await keywordsTextarea(page).fill('  Foo \n\nBAR');
    await page.locator('#confirm-keywords-btn').click();
    await expect(keywordsForm(page)).toBeHidden();
    await page.locator('#edit-keywords-btn').click();
    await expect(keywordsTextarea(page)).toHaveValue('foo\nbar', { timeout: 2000 });
  });

  test('Keywords speichern ohne Regel: der Schalter zeigt die neu angelegte, aktive Regel', async ({ page }) => {
    test.fail(true, 'Bekannter Bug: der Bot legt die Regel aktiv an, der Schalter bleibt aber auf „aus“');
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
    test.fail(true, 'Bekannter Bug: der Schalter dreht nur die Anzeige um, statt den neuen Zustand zu übernehmen');
    // Seite zeigt „an“, die Regel wurde aber inzwischen in Discord abgeschaltet → der Bot schaltet sie wieder an
    await resetBot({ 'automod/toggle-rule': { data: { rule_key: 'spam', enabled: true } } });
    await page.goto(PAGE);
    await ruleSwitch(page, 'spam').click();
    await waitForBotCall('automod/toggle-rule');
    await expect(ruleSwitch(page, 'spam')).toBeEnabled();
    await expectOn(ruleSwitch(page, 'spam'), true);
  });

  test('Honeypot-Beschreibung nennt die Timeout-Dauer aus dem Bot', async ({ page }) => {
    test.fail(true, 'Bekannter Bug: die Seite zeigt immer 7 Tage, egal was der Bot eingestellt hat');
    await resetBot(withStatus({ honeypot_timeout_days: 14 }));
    await page.goto(PAGE);
    await expect(page.getByText(t('automod.honeypot_desc', { days: 14 }))).toBeVisible({ timeout: 2000 });
  });
});

test.describe('Navigation ohne Neuladen (ClientRouter)', () => {
  const sidebarLink = (page: Page, sub: string) => page.locator(`aside a[href="/server/${GUILD_ID}/${sub}"]`).first();

  test('mehrfach hin und zurück: Umschalten wird genau einmal gesendet', async ({ page }) => {
    collectDialogs(page);
    // Start in der Modul-Übersicht: nur dort ist das Untermenü mit dem Automod-Link aufgeklappt
    await page.goto(guildPath('modules/'));
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => ((window as any).__noReload = true));
      await sidebarLink(page, 'modules/automod/').click();
      await expect(ruleSwitch(page, 'spam')).toBeVisible();
      await sidebarLink(page, 'modules/').click();
      await expect(page).toHaveURL(new RegExp(`/server/${GUILD_ID}/modules/$`));
    }
    await sidebarLink(page, 'modules/automod/').click();
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
