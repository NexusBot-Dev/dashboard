import { test, expect, type Page } from '@playwright/test';
import { login, resetBot, waitForBotCall, collectDialogs, guildPath, t } from './support/helpers';
import { AUTOMOD_V2, defaultBotData } from './support/fixtures.mjs';

// Eskalation im AutoMod-Tab (src/components/automod/EscalationCard.astro, Bot: systems/automod_escalation.py).

const PAGE = guildPath('automod/');
const withEscalation = (values: Record<string, unknown> | null) => ({
  'automod/status': { data: { ...AUTOMOD_V2, escalation: values === null ? null : { ...AUTOMOD_V2.escalation, ...values } } },
});
const payload = ({ acting_user_id: _u, guild_id: _g, lang: _l, ...rest }: Record<string, unknown>) => rest;

const card = (page: Page) => page.locator('#escalation-card');
const steps = (page: Page) => card(page).locator('[data-escalation-step]');
const stepField = (page: Page, index: number, name: string) => steps(page).nth(index).locator(`[data-step-field="${name}"]`);
const addBtn = (page: Page) => card(page).locator('[data-escalation-add]');
const saveBtn = (page: Page) => card(page).locator('[data-escalation-save]');
const toggle = (page: Page) => page.locator('#escalation-toggle');
const count = (page: Page) => card(page).locator('[data-escalation-count]');
const countLine = (page: Page) => count(page).locator('xpath=..');

test.beforeEach(async ({ context }) => {
  await resetBot(withEscalation({}));
  await login(context);
});

test('Zeitangaben in Einzahl und Mehrzahl, ohne „Tag(e)“', async ({ page }) => {
  await page.goto(PAGE);
  const option = (field: string, minutes: number) => stepField(page, 0, field).locator(`option[value="${minutes}"]`);
  await expect(option('window_minutes', 1440)).toHaveText(t('automod.duration_day_one'));
  await expect(option('window_minutes', 10080)).toHaveText(t('automod.duration_week_one'));
  await expect(option('window_minutes', 43200)).toHaveText(t('automod.duration_days', { n: 30 }));
  await expect(option('timeout_minutes', 40320)).toHaveText(t('automod.duration_weeks', { n: 4 }));
  for (const field of ['window_minutes', 'timeout_minutes']) {
    for (const text of await stepField(page, 0, field).locator('option').allTextContents()) expect(text).not.toMatch(/\(/);
  }
});

test('nicht in der Testphase und ohne AutoMod 2.0', async ({ page }) => {
  await resetBot(withEscalation(null));
  await page.goto(PAGE);
  await expect(page.locator('[data-rule-card]').first()).toBeVisible();
  await expect(card(page)).toHaveCount(0);

  await resetBot();   // älterer Bot ohne v2
  await page.reload();
  await expect(card(page)).toHaveCount(0);

  // Testphase: v2 aus, auch wenn Eskalations-Daten dabei wären
  await resetBot({ 'automod/status': { data: { ...AUTOMOD_V2, v2: false } } });
  await page.reload();
  await expect(page.locator('[data-rule-card]').first()).toBeVisible();
  await expect(card(page)).toHaveCount(0);
});

test('zeigt die gespeicherte Stufe, Speichern erst nach Änderung', async ({ page }) => {
  await page.goto(PAGE);
  await expect(steps(page)).toHaveCount(1);
  await expect(steps(page).first()).toContainText(t('automod.escalation_step', { n: 1 }));
  await expect(stepField(page, 0, 'strikes')).toHaveValue('3');
  await expect(stepField(page, 0, 'window_minutes')).toHaveValue('60');
  await expect(stepField(page, 0, 'action')).toHaveValue('warn');
  await expect(steps(page).first().locator('[data-step-timeout]')).toBeHidden();
  await expect(saveBtn(page)).toBeDisabled();

  await stepField(page, 0, 'strikes').fill('4');
  await expect(saveBtn(page)).toBeEnabled();
  await stepField(page, 0, 'strikes').fill('3');
  await expect(saveBtn(page)).toBeDisabled();
});

test('Timeout-Stufe speichern', async ({ page }) => {
  await page.goto(PAGE);
  await stepField(page, 0, 'action').selectOption('timeout');
  await expect(steps(page).first().locator('[data-step-timeout]')).toBeVisible();
  await stepField(page, 0, 'timeout_minutes').selectOption('1440');
  await stepField(page, 0, 'window_minutes').selectOption('1440');
  await stepField(page, 0, 'strikes').fill('5');
  await saveBtn(page).click();
  expect(payload(await waitForBotCall('automod/escalation'))).toEqual({
    steps: [{ strikes: 5, window_minutes: 1440, action: 'timeout', timeout_minutes: 1440 }],
  });
  await expect(saveBtn(page)).toBeDisabled();
  // Neuer gespeicherter Stand: der alte Wert gilt jetzt als Änderung
  await stepField(page, 0, 'strikes').fill('3');
  await expect(saveBtn(page)).toBeEnabled();
  await stepField(page, 0, 'strikes').fill('5');
  await expect(saveBtn(page)).toBeDisabled();
});

test('Free: nur eine Stufe, Hinweis auf Premium', async ({ page }) => {
  await page.goto(PAGE);
  await expect(addBtn(page)).toBeDisabled();
  await expect(countLine(page)).toHaveText(`1 / 1 ${t('automod.escalation_count_label')}`);
  await expect(card(page).locator('[data-escalation-limit]')).toBeVisible();
  await expect(card(page).locator('[data-escalation-limit]')).toHaveText(t('automod.escalation_limit_free', { max: 5 }));
  await steps(page).first().locator('[data-step-remove]').click();
  await expect(countLine(page)).toHaveText(`0 / 1 ${t('automod.escalation_count_label')}`);
  await expect(card(page).locator('[data-escalation-limit]')).toBeHidden();
});

test('Premium: Stufen hinzufügen und entfernen', async ({ page }) => {
  await resetBot(withEscalation({ max_steps: 5 }));
  await page.goto(PAGE);
  await expect(card(page).locator('[data-escalation-limit]')).toBeHidden();
  await expect(countLine(page)).toHaveText(`1 / 5 ${t('automod.escalation_count_label')}`);
  await addBtn(page).click();
  await expect(steps(page)).toHaveCount(2);
  await expect(count(page)).toHaveText('2');
  await expect(steps(page).nth(1)).toContainText(t('automod.escalation_step', { n: 2 }));
  // Vorlage: 3 Verstöße in 1 Std. → Verwarnung
  await expect(stepField(page, 1, 'strikes')).toHaveValue('3');
  await expect(stepField(page, 1, 'window_minutes')).toHaveValue('60');
  await expect(stepField(page, 1, 'action')).toHaveValue('warn');
  await stepField(page, 1, 'action').selectOption('ban');
  await stepField(page, 1, 'strikes').fill('8');
  await stepField(page, 1, 'window_minutes').selectOption('10080');

  // erste Stufe entfernen: die zweite wird zu Stufe 1
  await steps(page).first().locator('[data-step-remove]').click();
  await expect(steps(page)).toHaveCount(1);
  await expect(steps(page).first()).toContainText(t('automod.escalation_step', { n: 1 }));
  await saveBtn(page).click();
  expect(payload(await waitForBotCall('automod/escalation'))).toEqual({
    steps: [{ strikes: 8, window_minutes: 10080, action: 'ban' }],
  });

  for (let i = 0; i < 4; i++) await addBtn(page).click();
  await expect(steps(page)).toHaveCount(5);
  await expect(count(page)).toHaveText('5');
  await expect(addBtn(page)).toBeDisabled();
  await expect(card(page).locator('[data-escalation-limit]')).toBeVisible();
  await expect(card(page).locator('[data-escalation-limit]')).toHaveText(t('automod.escalation_limit', { max: 5 }));
});

test('alle Stufen entfernt: leer-Hinweis', async ({ page }) => {
  await page.goto(PAGE);
  await expect(card(page).locator('[data-escalation-empty]')).toBeHidden();
  await steps(page).first().locator('[data-step-remove]').click();
  await expect(card(page).locator('[data-escalation-empty]')).toBeVisible();
  await expect(addBtn(page)).toBeEnabled();
});

test('Premium ausgelaufen: Hinweis, erst nach Entfernen speicherbar', async ({ page }) => {
  await resetBot(withEscalation({
    steps: [{ strikes: 3, window_minutes: 60, action: 'warn' }, { strikes: 5, window_minutes: 60, action: 'kick' }],
  }));
  await page.goto(PAGE);
  await expect(card(page).locator('[data-escalation-downgrade]')).toBeVisible();
  await expect(count(page)).toHaveText('2');
  await expect(count(page)).toHaveClass(/text-amber-400/);
  await expect(addBtn(page)).toBeDisabled();
  await steps(page).nth(1).locator('[data-step-remove]').click();
  await expect(card(page).locator('[data-escalation-downgrade]')).toBeHidden();
  await expect(count(page)).toHaveText('1');
  await expect(count(page)).not.toHaveClass(/text-amber-400/);
  await expect(saveBtn(page)).toBeEnabled();
});

test('Schalter zeigt, was der Bot zurückmeldet', async ({ page }) => {
  await resetBot({ ...withEscalation({}), 'automod/escalation': { data: { ...AUTOMOD_V2.escalation, enabled: false } } });
  await page.goto(PAGE);
  await toggle(page).click();
  await waitForBotCall('automod/escalation');
  await expect(toggle(page)).toBeEnabled();
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'false');
});

test('Schalter speichert sofort', async ({ page }) => {
  await page.goto(PAGE);
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'false');
  await toggle(page).click();
  expect(payload(await waitForBotCall('automod/escalation'))).toEqual({ enabled: true });
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'true');
});

test('Fehler des Bots: Meldung, Zustand bleibt', async ({ page }) => {
  await resetBot({ ...withEscalation({ steps: [] }), 'automod/escalation': { status: 400, error: 'Lege zuerst mindestens eine Stufe an.' } });
  const dialogs = collectDialogs(page);
  await page.goto(PAGE);
  await toggle(page).click();
  await expect.poll(() => dialogs.join('\n')).toContain('Lege zuerst mindestens eine Stufe an.');
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'false');
  await expect(toggle(page)).toBeEnabled();

  await addBtn(page).click();
  await saveBtn(page).click();
  await expect.poll(() => dialogs.length).toBe(2);
  await expect(saveBtn(page)).toBeEnabled();   // noch nicht gespeichert
});

test('Status ohne Eskalation (Standard-Fixture) ändert nichts an der Seite', async ({ page }) => {
  await resetBot({ 'automod/status': { data: { ...defaultBotData['automod/status'] } } });
  await page.goto(PAGE);
  await expect(card(page)).toHaveCount(0);
});
