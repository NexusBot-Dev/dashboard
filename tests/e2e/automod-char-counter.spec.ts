import { test, expect, type Page } from '@playwright/test';
import { login, resetBot, waitForBotCall, guildPath } from './support/helpers';
import { AUTOMOD_V2, CHANNELS, defaultBotData } from './support/fixtures.mjs';

// Zeichenzähler unter Textfeldern mit Limit (src/components/CharCounter.astro, src/scripts/char-counter.ts).

const PAGE = guildPath('automod/');
const withV2 = (rules: Record<string, unknown> = {}) => ({
  'automod/status': { data: { ...AUTOMOD_V2, rules: { ...AUTOMOD_V2.rules, ...rules } } },
});
const counter = (page: Page, id: string) => page.locator(`[data-char-counter="${id}"]`);
const level = (page: Page, id: string) => counter(page, id).getAttribute('data-level');

test.beforeEach(async ({ context }) => {
  await resetBot(withV2());
  await login(context);
});

test('Hinweis-Text: zählt beim Tippen, gelb ab 90 %, rot am Limit', async ({ page }) => {
  await page.goto(PAGE);
  await page.locator('[data-rule-card="spam"] [data-rule-expand]').click();
  const input = page.locator('#custom-message-spam');
  await expect(counter(page, 'custom-message-spam')).toHaveText('0 / 150');
  expect(await level(page, 'custom-message-spam')).toBeNull();

  await input.fill('Hallo');
  await expect(counter(page, 'custom-message-spam')).toHaveText('5 / 150');
  await input.fill('x'.repeat(134));
  await expect(counter(page, 'custom-message-spam')).toHaveText('134 / 150');
  expect(await level(page, 'custom-message-spam')).toBeNull();
  await input.fill('x'.repeat(135));
  await expect(counter(page, 'custom-message-spam')).toHaveAttribute('data-level', 'warn');
  await input.fill('x'.repeat(200));   // maxlength schneidet ab
  await expect(counter(page, 'custom-message-spam')).toHaveText('150 / 150');
  await expect(counter(page, 'custom-message-spam')).toHaveAttribute('data-level', 'full');
  await input.fill('');
  await expect(counter(page, 'custom-message-spam')).toHaveText('0 / 150');
  expect(await level(page, 'custom-message-spam')).toBeNull();
});

test('gespeicherter Hinweis: richtiger Startwert, nach Speichern Stand des Bots', async ({ page }) => {
  const spam = { ...AUTOMOD_V2.rules.spam, custom_message: 'Bitte nicht spammen.' };
  await resetBot({ ...withV2({ spam }), 'automod/rule-settings': { data: { rule_key: 'spam', ...spam, custom_message: 'Kurz' } } });
  await page.goto(PAGE);
  await page.locator('[data-rule-card="spam"] [data-rule-expand]').click();
  await expect(counter(page, 'custom-message-spam')).toHaveText('20 / 150');
  await page.locator('#custom-message-spam').fill('Etwas anderes');
  await page.locator('[data-rule-card="spam"] [data-rule-form="settings"] [data-rule-save]').click();
  await waitForBotCall('automod/rule-settings');
  // Bot meldet „Kurz“ zurück: Feld und Zähler übernehmen das
  await expect(page.locator('#custom-message-spam')).toHaveValue('Kurz');
  await expect(counter(page, 'custom-message-spam')).toHaveText('4 / 150');
});

test.describe('ohne Skript', () => {
  test.use({ javaScriptEnabled: false });
  test('Startwert kommt vom Server', async ({ page }) => {
    const spam = { ...AUTOMOD_V2.rules.spam, custom_message: 'Bitte nicht spammen.' };
    await resetBot(withV2({ spam }));
    await page.goto(PAGE);
    await expect(counter(page, 'custom-message-spam')).toHaveText('20 / 150');
  });
});

test('Wortfilter ohne AutoMod 2.0: Abbrechen setzt den Zähler zurück', async ({ page }) => {
  await resetBot();
  await page.goto(PAGE);
  await page.locator('#edit-keywords-btn').click();
  await expect(counter(page, 'keywords-textarea')).toHaveText('14 / 1000');   // "spoiler\nkaufen"
  await page.locator('#keywords-textarea').fill('a');
  await expect(counter(page, 'keywords-textarea')).toHaveText('1 / 1000');
  await page.locator('#cancel-keywords-btn').click();
  await page.locator('#edit-keywords-btn').click();
  await expect(counter(page, 'keywords-textarea')).toHaveText('14 / 1000');
});

test('Honeypot: Titel und Warntext, auch über die Markdown-Leiste', async ({ page }) => {
  await resetBot({ 'automod/status': { data: { ...defaultBotData['automod/status'], honeypot_channel_id: CHANNELS[0].id } } });
  await page.goto(guildPath('automod/#honeypot'));
  await expect(counter(page, 'honeypot-title-input')).toHaveText('10 / 256');   // "⚠️ Achtung"
  await expect(counter(page, 'honeypot-text-input')).toHaveText('16 / 1000');
  await page.locator('#honeypot-text-input').selectText();
  await page.locator('[data-md-toolbar="honeypot-text-input"] [data-md="bold"]').click();
  await expect(counter(page, 'honeypot-text-input')).toHaveText('20 / 1000');

  // Leerer Titel: der Bot setzt den Standardtitel, der Zähler übernimmt ihn
  await page.locator('#honeypot-title-input').fill('');
  await expect(counter(page, 'honeypot-title-input')).toHaveText('0 / 256');
  await page.locator('#save-honeypot-text-btn').click();
  await waitForBotCall('automod/set-honeypot-text');
  await expect(page.locator('#honeypot-title-input')).toHaveValue('⚠️ Achtung');
  await expect(counter(page, 'honeypot-title-input')).toHaveText('10 / 256');
});

test('Honeypot anlegen: Zähler im Formular', async ({ page }) => {
  await page.goto(guildPath('automod/#honeypot'));
  await page.locator('#create-honeypot-btn').click();
  await expect(counter(page, 'honeypot-name-input')).toHaveText('0 / 90');
  await page.locator('#honeypot-name-input').fill('honeypot');
  await expect(counter(page, 'honeypot-name-input')).toHaveText('8 / 90');
  await page.locator('#honeypot-new-title-input').fill('Achtung');
  await expect(counter(page, 'honeypot-new-title-input')).toHaveText('7 / 256');
  await page.locator('#honeypot-warntext-input').fill('Hier nicht schreiben');
  await expect(counter(page, 'honeypot-warntext-input')).toHaveText('20 / 1000');
});
