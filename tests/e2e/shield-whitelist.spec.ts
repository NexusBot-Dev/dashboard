import { test, expect, type Page } from '@playwright/test';
import { login, resetBot, waitForBotCall, botCalls, collectDialogs, guildPath, t } from './support/helpers';
import { SHIELD_WHITELIST, defaultBotData } from './support/fixtures.mjs';

// Shield-Whitelist im Shield-Tab (src/components/automod/ShieldWhitelist.astro, Bot: systems/shield_whitelist.py).
// Rechte wie im Bot: Bots nur Owner/Admins, Rollen nur der Owner, Shield ausschalten nur der Owner.

const PAGE = guildPath('automod/#shield');
const status = defaultBotData['automod/status'];
const whitelist = (values: Record<string, unknown>) => ({ 'automod/shield-whitelist': { data: { ...SHIELD_WHITELIST, ...values } } });

const XSS = '<img src=x onerror="window.__xss=1">';
const MOD_BOT = '400000000000000001';
const HELPER_BOT = '400000000000000002';
const HELFER = '300000000000000002';
const MODS = '300000000000000001';

const botSwitch = (page: Page, id: string) => page.locator(`[data-shield-bot="${id}"]`);
const rows = (page: Page) => page.locator('[data-shield-bot-row]');
const roleBox = (page: Page, id: string) => page.locator(`[data-shield-roles] input[value="${id}"]`);
const saveRoles = (page: Page) => page.locator('#shield-roles-save');
const expectOn = (locator: ReturnType<typeof botSwitch>, on: boolean) => expect(locator).toHaveAttribute('aria-checked', String(on));
const payload = ({ acting_user_id: _u, guild_id: _g, lang: _l, ...rest }: Record<string, unknown>) => rest;

test.beforeEach(async ({ context }) => {
  await resetBot();
  await login(context);
});

test('Bot-Liste: Mod-Rechte markiert, Zähler, Schalter speichert sofort', async ({ page }) => {
  await page.goto(PAGE);
  await expect(rows(page)).toHaveCount(3);
  await expect(rows(page).nth(0)).toContainText('Mod-Bot');
  await expect(rows(page).nth(0)).toContainText(t('automod.shield_bot_mod_badge'));
  await expect(rows(page).nth(2)).not.toContainText(t('automod.shield_bot_mod_badge'));
  await expect(page.locator('[data-shield-bot-count]')).toHaveText('1 / 25');
  await expectOn(botSwitch(page, MOD_BOT), true);
  await expectOn(botSwitch(page, HELPER_BOT), false);

  await botSwitch(page, HELPER_BOT).click();
  expect(payload(await waitForBotCall('automod/shield-bot'))).toEqual({ bot_id: HELPER_BOT, whitelisted: true });
  await expectOn(botSwitch(page, HELPER_BOT), true);
  await expect(page.locator('[data-shield-bot-count]')).toHaveText('2 / 25');

  await botSwitch(page, MOD_BOT).click();
  expect(payload(await waitForBotCall('automod/shield-bot', 1))).toEqual({ bot_id: MOD_BOT, whitelisted: false });
  await expectOn(botSwitch(page, MOD_BOT), false);
});

test('Fehler beim Eintragen: Meldung, Schalter bleibt', async ({ page }) => {
  await resetBot({ 'automod/shield-bot': { status: 400, error: 'Höchstens 25 Bots auf der Whitelist.' } });
  const dialogs = collectDialogs(page);
  await page.goto(PAGE);
  await botSwitch(page, HELPER_BOT).click();
  await expect.poll(() => dialogs.join('\n')).toContain('Höchstens 25 Bots auf der Whitelist.');
  await expectOn(botSwitch(page, HELPER_BOT), false);
  await expect(botSwitch(page, HELPER_BOT)).toBeEnabled();
});

test('Suche nach Name und ID', async ({ page }) => {
  await page.goto(PAGE);
  const search = page.locator('#shield-bot-search');
  await search.fill('helf');
  await expect(rows(page).filter({ visible: true })).toHaveCount(1);
  await expect(rows(page).filter({ visible: true })).toContainText('Helfer-Bot');

  await search.fill('400000000000000003');
  await expect(rows(page).filter({ visible: true })).toContainText('Musikbot');

  await search.fill('gibtsnicht');
  await expect(rows(page).filter({ visible: true })).toHaveCount(0);
  await expect(page.locator('[data-shield-no-results]')).toBeVisible();

  await search.fill('');
  await expect(rows(page).filter({ visible: true })).toHaveCount(3);
  await expect(page.locator('[data-shield-no-results]')).toBeHidden();
});

test('Bot nicht mehr auf dem Server: mit ID und austragbar', async ({ page }) => {
  await resetBot(whitelist({ bots: [{ id: '400000000000000009', name: null, avatar: null, mod_permissions: false, whitelisted: true }] }));
  await page.goto(PAGE);
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page)).toContainText(t('automod.shield_bot_unknown'));
  await expect(rows(page)).toContainText('400000000000000009');
  await expect(botSwitch(page, '400000000000000009')).toBeEnabled();
});

test('keine anderen Bots', async ({ page }) => {
  await resetBot(whitelist({ bots: [] }));
  await page.goto(PAGE);
  await expect(page.locator('#shield-bots')).toContainText(t('automod.shield_bots_empty'));
  await expect(page.locator('#shield-bot-search')).toHaveCount(0);
});

test('Namen werden nicht als HTML ausgeführt', async ({ page }) => {
  await resetBot(whitelist({ bots: [{ id: MOD_BOT, name: XSS, avatar: null, mod_permissions: false, whitelisted: false }] }));
  await page.goto(PAGE);
  await expect(rows(page)).toContainText(XSS);
  expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();
});

test('Rollen: Owner wählt aus und speichert', async ({ page }) => {
  await page.goto(PAGE);
  await expect(roleBox(page, HELFER)).toBeChecked();
  await expect(roleBox(page, MODS)).not.toBeChecked();
  await expect(page.locator('[data-shield-role-count]')).toHaveText('1 / 10');
  await expect(saveRoles(page)).toBeDisabled();

  await roleBox(page, MODS).check();
  await expect(saveRoles(page)).toBeEnabled();
  await roleBox(page, MODS).uncheck();
  await expect(saveRoles(page)).toBeDisabled();   // zurück zum gespeicherten Stand

  await roleBox(page, MODS).check();
  await roleBox(page, HELFER).uncheck();
  await saveRoles(page).click();
  expect(payload(await waitForBotCall('automod/shield-roles'))).toEqual({ role_ids: [MODS] });
  await expect(saveRoles(page)).toBeDisabled();
  await expect(page.locator('[data-shield-role-count]')).toHaveText('1 / 10');
});

test('Rollen: eingetragene, unbekannte Rolle bleibt beim Speichern erhalten', async ({ page }) => {
  await resetBot(whitelist({ roles: ['300000000000000077'] }));
  await page.goto(PAGE);
  await expect(roleBox(page, '300000000000000077')).toBeChecked();
  await roleBox(page, MODS).check();
  await saveRoles(page).click();
  expect(payload(await waitForBotCall('automod/shield-roles'))).toEqual({ role_ids: [MODS, '300000000000000077'] });
});

test('Admin: Bots ja, Rollen nein', async ({ page }) => {
  await resetBot(whitelist({ is_owner: false }));
  await page.goto(PAGE);
  await expect(botSwitch(page, HELPER_BOT)).toBeEnabled();
  await expect(roleBox(page, MODS)).toBeDisabled();
  await expect(saveRoles(page)).toHaveCount(0);
  await expect(page.locator('#shield-roles')).toContainText(t('automod.shield_roles_owner_only'));
  await expect(page.locator('#shield-bots')).not.toContainText(t('automod.shield_bots_admin_only'));
});

test('Nur „Server verwalten“: alles nur lesbar', async ({ page }) => {
  await resetBot(whitelist({ is_owner: false, can_manage_bots: false }));
  await page.goto(PAGE);
  await expect(botSwitch(page, HELPER_BOT)).toBeDisabled();
  await expect(page.locator('#shield-bots')).toContainText(t('automod.shield_bots_admin_only'));
  await expect(roleBox(page, MODS)).toBeDisabled();
});

test('älterer Bot ohne Whitelist: Shield-Tab wie bisher', async ({ page }) => {
  await resetBot({ 'automod/shield-whitelist': { status: 404, error: 'unknown_action' } });
  await page.goto(PAGE);
  await expect(page.locator('#shield-toggle')).toBeVisible();
  await expect(page.locator('#shield-bots')).toHaveCount(0);
  await expect(page.locator('#shield-roles')).toHaveCount(0);
});

test.describe('Shield ausschalten nur durch den Owner', () => {
  const withStatus = (values: Record<string, unknown>) => ({ 'automod/status': { data: { ...status, ...values } } });

  test('eingeschaltet, kein Owner: Schalter gesperrt mit Hinweis', async ({ page }) => {
    await resetBot(withStatus({ shield_enabled: true, shield_can_disable: false }));
    await page.goto(PAGE);
    await expect(page.locator('#shield-toggle')).toBeDisabled();
    await expect(page.locator('#shield-owner-hint')).toBeVisible();
    await expect(page.locator('#shield-owner-hint')).toHaveText(t('automod.shield_owner_only_hint'));
  });

  test('kein Owner schaltet ein: danach gesperrt', async ({ page }) => {
    await resetBot(withStatus({ shield_enabled: false, shield_can_disable: false }));
    await page.goto(PAGE);
    await expect(page.locator('#shield-owner-hint')).toBeHidden();
    await page.locator('#shield-toggle').click();
    await waitForBotCall('automod/toggle-shield');
    await expect(page.locator('#shield-toggle')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#shield-toggle')).toBeDisabled();
    await expect(page.locator('#shield-owner-hint')).toBeVisible();
  });

  test('Owner und älterer Bot: frei schaltbar', async ({ page }) => {
    for (const extra of [{ shield_can_disable: true }, {}]) {
      await resetBot(withStatus({ shield_enabled: true, ...extra }));
      await page.goto(PAGE);
      await expect(page.locator('#shield-toggle')).toBeEnabled();
      await expect(page.locator('#shield-owner-hint')).toBeHidden();
    }
  });

  test('Bot lehnt Ausschalten ab: Meldung, bleibt an', async ({ page }) => {
    // Status älter als die Rechteänderung (z. B. Owner gewechselt): Schalter frei, der Bot lehnt ab
    await resetBot({
      ...withStatus({ shield_enabled: true, shield_can_disable: true }),
      'automod/toggle-shield': { status: 400, error: 'Das kann nur der Serverbesitzer.' },
    });
    const dialogs = collectDialogs(page);
    await page.goto(PAGE);
    await page.locator('#shield-toggle').click();
    await expect.poll(() => dialogs.join('\n')).toContain('Das kann nur der Serverbesitzer.');
    await expect(page.locator('#shield-toggle')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#shield-toggle')).toBeEnabled();
    expect(await botCalls('automod/toggle-shield')).toHaveLength(1);
  });
});
