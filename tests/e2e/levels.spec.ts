import { test, expect, type Page } from '@playwright/test';
import { login, resetBot, waitForBotCall, botCalls, collectDialogs, guildPath, t } from './support/helpers';
import { CHANNELS, ROLES, defaultBotData } from './support/fixtures.mjs';
import { GUILD_ID } from './support/env.mjs';

// Levelsystem: XP-Vergabe, Level-Up-Channel, Channels ohne XP, Level-Rollen und Leaderboard.

const PAGE = guildPath('modules/levels/');
const XSS = '<img src=x onerror="window.__xss=1">';
const excluded = defaultBotData['leveling/get-excluded'];
const CATEGORY_ID = excluded.targets[0].id;

const minInput = (page: Page) => page.locator('#xp-min-input');
const maxInput = (page: Page) => page.locator('#xp-max-input');
const saveXpBtn = (page: Page) => page.locator('#save-xp-btn');
const levelupSelect = (page: Page) => page.locator('#levelup-channel-select');
const saveLevelupBtn = (page: Page) => page.locator('#save-levelup-btn');
const chips = (page: Page) => page.locator('#xp-excluded-list > span');
const excludeSelect = (page: Page) => page.locator('#xp-exclude-select');
const addExcludeBtn = (page: Page) => page.locator('#add-xp-exclude-btn');
const roleRow = (page: Page, level: number) => page.locator(`[data-level-role-row="${level}"]`);
const roleRows = (page: Page) => page.locator('[data-level-role-row]');
const roleForm = (page: Page) => page.locator('#level-role-form');
const levelInput = (page: Page) => page.locator('#new-level-input');
const roleSelect = (page: Page) => page.locator('#new-role-select');
const confirmRoleBtn = (page: Page) => page.locator('#confirm-level-role-btn');
const leaderboard = (page: Page) => page.locator('section').filter({ hasText: t('levels.leaderboard_title') });
const expectNoXss = async (page: Page) => expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();

test.beforeEach(async ({ context }) => {
  await resetBot();
  await login(context);
});

test.describe('Übersicht', () => {
  test('XP-Werte und Cooldown, Speichern erst nach einer Änderung', async ({ page }) => {
    await page.goto(PAGE);
    await expect(minInput(page)).toHaveValue('15');
    await expect(maxInput(page)).toHaveValue('25');
    await expect(page.getByText('60s', { exact: true })).toBeVisible();
    await expect(saveXpBtn(page)).toBeDisabled();
    await expect(levelupSelect(page)).toHaveValue('');
    await expect(saveLevelupBtn(page)).toBeDisabled();
  });

  test('Level-Rollen mit Level, Name und Farbe', async ({ page }) => {
    await page.goto(PAGE);
    await expect(roleRows(page)).toHaveCount(2);
    await expect(roleRow(page, 5)).toContainText(t('levels.level_badge', { level: 5 }));
    await expect(roleRow(page, 5)).toContainText('Mods');
    await expect(roleRow(page, 5).locator('span[style]')).toHaveAttribute('style', /background-color: #ff0000/);
    await expect(roleRow(page, 10)).toContainText('Helfer');
    await expect(page.getByText(t('levels.no_roles'))).toBeHidden();
  });

  test('Leaderboard: Platzierung, XP im Format der Sprache, Avatar-Fallback', async ({ page }) => {
    await page.goto(PAGE);
    const board = leaderboard(page);
    await expect(board).toContainText(t('levels.top_label', { count: 4 }));
    await expect(board).toContainText('🥇');
    await expect(board).toContainText('#4');
    await expect(board).toContainText('12.345 XP');
    await expect(board).toContainText(t('levels.level_badge', { level: 12 }));
    const idx = Number(BigInt('510000000000000002') % 6n);
    await expect(board.locator(`img[src="https://cdn.discordapp.com/embed/avatars/${idx}.png"]`)).toHaveCount(1);
  });

  test('leeres Leaderboard und keine Level-Rollen zeigen Hinweise', async ({ page }) => {
    await resetBot({ 'leveling/leaderboard': { data: { entries: [] } }, 'leveling/list-roles': { data: { roles: [] } } });
    await page.goto(PAGE);
    await expect(page.getByText(t('levels.no_entries'))).toBeVisible();
    await expect(page.getByText(t('levels.no_roles'))).toBeVisible();
  });

  test('Channels ohne XP: Chips, Zähler und Auswahl ohne bereits ausgeschlossene', async ({ page }) => {
    await page.goto(PAGE);
    await expect(chips(page)).toHaveCount(1);
    await expect(chips(page)).toContainText(`#${CHANNELS[1].name}`);
    await expect(page.locator('#xp-exclude-count')).toHaveText(t('levels.exclude_count', { count: 1, limit: 25 }));
    await expect(page.locator('#xp-excluded-empty')).toBeHidden();

    await expect(excludeSelect(page).locator('optgroup')).toHaveCount(2);
    await expect(excludeSelect(page).locator(`option[value="${CATEGORY_ID}"]`)).toHaveText('Talk');
    await expect(excludeSelect(page).locator(`option[value="${CHANNELS[0].id}"]`)).toHaveText(`#${CHANNELS[0].name} · Talk`);
    await expect(excludeSelect(page).locator(`option[value="${CHANNELS[1].id}"]`)).toHaveCount(0);
    await expect(addExcludeBtn(page)).toBeDisabled();
  });

  test('Namen von Rollen, Mitgliedern und Channels bleiben Text', async ({ page }) => {
    await resetBot({
      'leveling/list-roles': { data: { roles: [{ level: 5, role_id: ROLES[0].id, role_name: `Rolle ${XSS}`, role_color: '#ff0000' }] } },
      'leveling/leaderboard': { data: { entries: [{ user_id: '510000000000000001', username: `User ${XSS}`, avatar_url: null, xp: 1, level: 0 }] } },
      'leveling/get-excluded': { data: { ...excluded, excluded_ids: [CATEGORY_ID], targets: [{ ...excluded.targets[0], name: `Kat ${XSS}` }, ...excluded.targets.slice(1)] } },
    });
    await page.goto(PAGE);
    await expect(roleRow(page, 5)).toContainText(`Rolle ${XSS}`);
    await expect(leaderboard(page)).toContainText(`User ${XSS}`);
    await expect(chips(page)).toContainText(`Kat ${XSS}`);
    await expectNoXss(page);
  });

  test('ohne Bot-Daten erscheint der Offline-Hinweis und alles ist gesperrt', async ({ page }) => {
    await resetBot({ 'leveling/list-roles': { status: 500, error: 'internal_error' } });
    await page.goto(PAGE);
    await expect(page.getByText(t('common.bot_offline'))).toBeVisible();
    await expect(minInput(page)).toBeDisabled();
    await expect(levelupSelect(page)).toBeDisabled();
    await expect(excludeSelect(page)).toBeDisabled();
    await expect(page.locator('#add-level-role-btn')).toBeDisabled();
  });
});

test.describe('XP-Vergabe', () => {
  test('Speichern sendet Ganzzahlen, danach ist der Button wieder gesperrt', async ({ page }) => {
    await page.goto(PAGE);
    await minInput(page).fill('10');
    await expect(saveXpBtn(page)).toBeEnabled();
    await minInput(page).fill('15');
    await expect(saveXpBtn(page)).toBeDisabled(); // zurück auf den gespeicherten Wert

    await minInput(page).fill('10');
    await maxInput(page).fill('40');
    await saveXpBtn(page).click();
    expect(await waitForBotCall('leveling/set-xp-settings')).toEqual(expect.objectContaining({ xp_min: 10, xp_max: 40 }));
    await expect(saveXpBtn(page)).toBeDisabled();
    await expect(saveXpBtn(page)).toHaveText(t('common.save'));
  });

  test('ungültige Werte: Meldung, nichts wird gesendet', async ({ page }) => {
    const dialogs = collectDialogs(page);
    await page.goto(PAGE);
    await minInput(page).fill('30');
    await saveXpBtn(page).click();
    await expect.poll(() => dialogs).toEqual([t('levels.alert_min_gt_max')]);

    await minInput(page).fill('0');
    await saveXpBtn(page).click();
    await expect.poll(() => dialogs.length).toBe(2);
    expect(dialogs[1]).toBe(t('levels.alert_invalid_xp'));

    await minInput(page).fill('1001');
    await maxInput(page).fill('1001');
    await saveXpBtn(page).click();
    await expect.poll(() => dialogs.length).toBe(3);
    expect(dialogs[2]).toBe(t('levels.alert_invalid_xp'));
    expect(await botCalls('leveling/set-xp-settings')).toHaveLength(0);
  });

  test('Fehler des Bots: Meldung, Speichern bleibt möglich', async ({ page }) => {
    await resetBot({ 'leveling/set-xp-settings': { status: 400, error: 'Werte müssen zwischen 1 und 1000 liegen' } });
    const dialogs = collectDialogs(page);
    await page.goto(PAGE);
    await minInput(page).fill('10');
    await saveXpBtn(page).click();
    await expect.poll(() => dialogs.join('\n')).toContain('Werte müssen zwischen 1 und 1000 liegen');
    await expect(saveXpBtn(page)).toBeEnabled();
  });
});

test.describe('Level-Up-Channel', () => {
  test('Channel setzen und wieder auf „Kein Channel“ zurück', async ({ page }) => {
    await page.goto(PAGE);
    await levelupSelect(page).selectOption(CHANNELS[0].id);
    await saveLevelupBtn(page).click();
    expect(await waitForBotCall('leveling/set-levelup-channel')).toMatchObject({ channel_id: CHANNELS[0].id });
    // Erst weiter, wenn die Seite mit dem Speichern fertig ist — sonst gilt die nächste Auswahl schon als gespeichert
    await expect(saveLevelupBtn(page)).toHaveText(t('common.save'));
    await expect(saveLevelupBtn(page)).toBeDisabled();

    await levelupSelect(page).selectOption('');
    await saveLevelupBtn(page).click();
    expect((await waitForBotCall('leveling/set-levelup-channel', 1)).channel_id).toBeNull();
  });

  test('gespeicherter Channel ist vorausgewählt', async ({ page }) => {
    await resetBot({ 'leveling/get-xp-settings': { data: { ...defaultBotData['leveling/get-xp-settings'], levelup_channel_id: CHANNELS[1].id } } });
    await page.goto(PAGE);
    await expect(levelupSelect(page)).toHaveValue(CHANNELS[1].id);
  });
});

test.describe('Channels ohne XP', () => {
  test('hinzufügen: Payload, neuer Chip, Eintrag verschwindet aus der Auswahl', async ({ page }) => {
    await page.goto(PAGE);
    await excludeSelect(page).selectOption(CATEGORY_ID);
    await addExcludeBtn(page).click();
    expect((await waitForBotCall('leveling/set-excluded')).channel_ids).toEqual([CHANNELS[1].id, CATEGORY_ID]);
    await expect(chips(page)).toHaveCount(2);
    await expect(chips(page).nth(1)).toContainText('📁 Talk');
    await expect(excludeSelect(page).locator(`option[value="${CATEGORY_ID}"]`)).toHaveCount(0);
    await expect(page.locator('#xp-exclude-count')).toHaveText(t('levels.exclude_count', { count: 2, limit: 25 }));
  });

  test('entfernen: Payload ohne den Eintrag, danach Leer-Hinweis', async ({ page }) => {
    await page.goto(PAGE);
    await chips(page).first().getByRole('button').click();
    expect((await waitForBotCall('leveling/set-excluded')).channel_ids).toEqual([]);
    await expect(chips(page)).toHaveCount(0);
    await expect(page.locator('#xp-excluded-empty')).toBeVisible();
    await expect(excludeSelect(page).locator(`option[value="${CHANNELS[1].id}"]`)).toHaveCount(1);
  });

  test('am Limit ist die Auswahl gesperrt', async ({ page }) => {
    await resetBot({ 'leveling/get-excluded': { data: { ...excluded, limit: 1 } } });
    await page.goto(PAGE);
    await expect(excludeSelect(page)).toBeDisabled();
    await expect(page.locator('#xp-exclude-count')).toHaveText(t('levels.exclude_count', { count: 1, limit: 1 }));
  });

  test('Fehler des Bots: Meldung, Chips bleiben wie vorher', async ({ page }) => {
    await resetBot({ 'leveling/set-excluded': { status: 400, error: 'Channel existiert nicht (mehr)' } });
    const dialogs = collectDialogs(page);
    await page.goto(PAGE);
    await excludeSelect(page).selectOption(CHANNELS[0].id);
    await addExcludeBtn(page).click();
    await expect.poll(() => dialogs.join('\n')).toContain('Channel existiert nicht (mehr)');
    await expect(chips(page)).toHaveCount(1);
  });
});

test.describe('Level-Rollen', () => {
  test('hinzufügen: Pflichtfelder, Payload, Zeile wird nach Level einsortiert', async ({ page }) => {
    const dialogs = collectDialogs(page);
    await page.goto(PAGE);
    await page.locator('#add-level-role-btn').click();
    await expect(roleForm(page)).toBeVisible();
    await expect(page.locator('#level-role-form-title')).toHaveText(t('levels.role_form_add_title'));

    await confirmRoleBtn(page).click();
    await expect.poll(() => dialogs).toEqual([t('levels.alert_invalid_level')]);
    await levelInput(page).fill('7');
    await confirmRoleBtn(page).click();
    await expect.poll(() => dialogs.length).toBe(2);
    expect(dialogs[1]).toBe(t('levels.alert_no_role'));
    expect(await botCalls('leveling/set-role')).toHaveLength(0);

    await roleSelect(page).selectOption(ROLES[1].id);
    await confirmRoleBtn(page).click();
    expect(await waitForBotCall('leveling/set-role')).toMatchObject({ level: 7, role_id: ROLES[1].id });
    await expect(roleForm(page)).toBeHidden();
    await expect(roleRow(page, 7)).toContainText('Helfer');
    await expect(roleRow(page, 7)).toContainText(t('levels.level_badge', { level: 7 }));
    expect(await roleRows(page).evaluateAll((rows) => rows.map((r) => (r as HTMLElement).dataset.levelRoleRow))).toEqual(['5', '7', '10']);
  });

  test('bearbeiten: Level gesperrt, Rolle vorausgewählt, Zeile wird ersetzt', async ({ page }) => {
    await page.goto(PAGE);
    await roleRow(page, 5).locator('[data-edit-level-role]').click();
    await expect(page.locator('#level-role-form-title')).toHaveText(t('levels.role_form_edit_title', { level: 5 }));
    await expect(levelInput(page)).toHaveValue('5');
    await expect(levelInput(page)).toBeDisabled();
    await expect(roleSelect(page)).toHaveValue(ROLES[0].id);

    await roleSelect(page).selectOption(ROLES[1].id);
    await confirmRoleBtn(page).click();
    expect(await waitForBotCall('leveling/set-role')).toMatchObject({ level: 5, role_id: ROLES[1].id });
    await expect(roleRows(page)).toHaveCount(2);
    await expect(roleRow(page, 5)).toContainText('Helfer');

    // Danach ist das Formular wieder im Hinzufügen-Modus
    await page.locator('#add-level-role-btn').click();
    await expect(levelInput(page)).toBeEnabled();
    await expect(levelInput(page)).toHaveValue('');
  });

  test('entfernen: Rückfrage mit Level, Payload als Zahl, Zeile verschwindet', async ({ page }) => {
    const dialogs = collectDialogs(page);
    await page.goto(PAGE);
    await roleRow(page, 5).locator('[data-remove-level-role]').click();
    expect(await waitForBotCall('leveling/remove-role')).toEqual(expect.objectContaining({ level: 5 }));
    expect(dialogs).toEqual([t('levels.confirm_remove_role', { level: 5 })]);
    await expect(roleRow(page, 5)).toHaveCount(0);
  });

  test('entfernen abgebrochen: nichts wird gesendet', async ({ page }) => {
    const dialogs = collectDialogs(page, { accept: false });
    await page.goto(PAGE);
    await roleRow(page, 5).locator('[data-remove-level-role]').click();
    await expect.poll(() => dialogs.length).toBe(1);
    await page.waitForTimeout(300);
    expect(await botCalls('leveling/remove-role')).toHaveLength(0);
    await expect(roleRow(page, 5)).toBeVisible();
  });

  test('neu angelegte Zeile lässt sich bearbeiten und entfernen', async ({ page }) => {
    collectDialogs(page);
    await page.goto(PAGE);
    await page.locator('#add-level-role-btn').click();
    await levelInput(page).fill('20');
    await roleSelect(page).selectOption(ROLES[0].id);
    await confirmRoleBtn(page).click();
    await expect(roleRow(page, 20)).toBeVisible();

    await roleRow(page, 20).locator('[data-edit-level-role]').click();
    await expect(levelInput(page)).toHaveValue('20');
    await expect(roleSelect(page)).toHaveValue(ROLES[0].id);
    await page.locator('#cancel-level-role-btn').click();

    await roleRow(page, 20).locator('[data-remove-level-role]').click();
    expect((await waitForBotCall('leveling/remove-role')).level).toBe(20);
    await expect(roleRow(page, 20)).toHaveCount(0);
  });

  test('Fehler des Bots: Meldung, Formular bleibt offen', async ({ page }) => {
    await resetBot({ 'leveling/set-role': { status: 400, error: 'Die Rolle steht über der Rolle des Bots' } });
    const dialogs = collectDialogs(page);
    await page.goto(PAGE);
    await page.locator('#add-level-role-btn').click();
    await levelInput(page).fill('7');
    await roleSelect(page).selectOption(ROLES[0].id);
    await confirmRoleBtn(page).click();
    await expect.poll(() => dialogs.join('\n')).toContain('Die Rolle steht über der Rolle des Bots');
    await expect(roleForm(page)).toBeVisible();
    await expect(roleRow(page, 7)).toHaveCount(0);
  });
});

test.describe('Anzeige und Eingaben', () => {
  test('erste Level-Rolle: der Hinweis „keine Level-Rollen“ verschwindet', async ({ page }) => {
    test.fail(true, 'Bekannter Bug: der Leer-Hinweis bleibt bis zum Neuladen stehen');
    await resetBot({ 'leveling/list-roles': { data: { roles: [] } } });
    await page.goto(PAGE);
    await page.locator('#add-level-role-btn').click();
    await levelInput(page).fill('3');
    await roleSelect(page).selectOption(ROLES[0].id);
    await confirmRoleBtn(page).click();
    await expect(roleRow(page, 3)).toBeVisible();
    await expect(page.getByText(t('levels.no_roles'))).toBeHidden({ timeout: 2000 });
  });

  test('letzte Level-Rolle entfernt: der Hinweis „keine Level-Rollen“ erscheint', async ({ page }) => {
    test.fail(true, 'Bekannter Bug: leere Liste ohne Hinweis bis zum Neuladen');
    await resetBot({ 'leveling/list-roles': { data: { roles: [defaultBotData['leveling/list-roles'].roles[0]] } } });
    collectDialogs(page);
    await page.goto(PAGE);
    await roleRow(page, 5).locator('[data-remove-level-role]').click();
    await expect(roleRow(page, 5)).toHaveCount(0);
    await expect(page.getByText(t('levels.no_roles'))).toBeVisible({ timeout: 2000 });
  });

  test('Kommazahl bei XP wird abgelehnt statt still abgeschnitten', async ({ page }) => {
    test.fail(true, 'Bekannter Bug: aus 12.5 wird ohne Hinweis 12 gespeichert');
    const dialogs = collectDialogs(page);
    await page.goto(PAGE);
    await minInput(page).fill('12.5');
    await saveXpBtn(page).click();
    await expect.poll(() => dialogs, { timeout: 2000 }).toEqual([t('levels.alert_invalid_xp')]);
    expect(await botCalls('leveling/set-xp-settings')).toHaveLength(0);
  });

  test('Kommazahl beim Level wird abgelehnt statt still abgeschnitten', async ({ page }) => {
    test.fail(true, 'Bekannter Bug: aus Level 3.5 wird ohne Hinweis Level 3');
    const dialogs = collectDialogs(page);
    await page.goto(PAGE);
    await page.locator('#add-level-role-btn').click();
    await levelInput(page).fill('3.5');
    await roleSelect(page).selectOption(ROLES[0].id);
    await confirmRoleBtn(page).click();
    await expect.poll(() => dialogs, { timeout: 2000 }).toEqual([t('levels.alert_invalid_level')]);
    expect(await botCalls('leveling/set-role')).toHaveLength(0);
  });
});

test.describe('Navigation ohne Neuladen (ClientRouter)', () => {
  const sidebarLink = (page: Page, sub: string) => page.locator(`aside a[href="/server/${GUILD_ID}/${sub}"]`).first();

  test('mehrfach hin und zurück: Aktionen werden genau einmal gesendet', async ({ page }) => {
    collectDialogs(page);
    // Start in der Modul-Übersicht: nur dort ist das Untermenü mit dem Levels-Link aufgeklappt
    await page.goto(guildPath('modules/'));
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => ((window as any).__noReload = true));
      await sidebarLink(page, 'modules/levels/').click();
      await expect(minInput(page)).toBeVisible();
      await sidebarLink(page, 'modules/').click();
      await expect(page).toHaveURL(new RegExp(`/server/${GUILD_ID}/modules/$`));
    }
    await sidebarLink(page, 'modules/levels/').click();
    await expect(minInput(page)).toBeVisible();
    expect(await page.evaluate(() => (window as any).__noReload)).toBe(true);

    await excludeSelect(page).selectOption(CATEGORY_ID);
    await addExcludeBtn(page).click();
    await waitForBotCall('leveling/set-excluded');
    await roleRow(page, 5).locator('[data-remove-level-role]').click();
    await waitForBotCall('leveling/remove-role');
    await page.waitForTimeout(500); // etwaige doppelte Aufrufe abwarten
    expect(await botCalls('leveling/set-excluded')).toHaveLength(1);
    expect(await botCalls('leveling/remove-role')).toHaveLength(1);
    await expect(chips(page)).toHaveCount(2);
  });
});
