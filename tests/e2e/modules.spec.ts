import { test, expect, type Page } from '@playwright/test';
import { login, browserPost, resetBot, waitForBotCall, botCalls, collectDialogs, guildPath, t, dbQuery } from './support/helpers';
import { FOREIGN_GUILD_ID, GUILD_ID } from './support/env.mjs';

// Module werden auf ihrer eigenen Seite ein- und ausgeschaltet (src/components/ModuleToggle.astro).
// Der Stand kommt direkt aus guild_settings.modules; gespeichert wird sofort über den Bot (modules/toggle).

// Entspricht dem DB-Standardwert der Spalte modules
const DEFAULT_MODULES = {
  moderation: true, levels: false, welcome: false, reaction_roles: false, boosts: false,
  embeds: false, automod: false, stream_alerts: true, tickets: true,
};

async function setModules(values: Partial<typeof DEFAULT_MODULES> = {}) {
  await dbQuery('UPDATE guild_settings SET modules = ? WHERE guild_id = ?', [
    JSON.stringify({ ...DEFAULT_MODULES, ...values }), GUILD_ID,
  ]);
}

// Seite, Modul-Schlüssel und Anzeigename je Modul mit eigener Seite
const PAGES = [
  { path: 'levels/', key: 'levels', name: () => t('levels.title') },
  { path: 'reaction-roles/', key: 'reaction_roles', name: () => t('reaction_roles.title') },
  { path: 'automod/', key: 'automod', name: () => t('automod.title') },
  { path: 'stream-alerts/', key: 'stream_alerts', name: () => t('stream_alerts.title') },
  { path: 'tickets/', key: 'tickets', name: () => t('tickets.title') },
  { path: 'welcome/', key: 'welcome', name: () => t('welcome.title') },
];

const moduleSwitch = (page: Page, key: string) => page.locator(`[data-module-switch="${key}"]`);
const root = (page: Page, key: string) => page.locator('[data-module-toggle-root]').filter({ has: moduleSwitch(page, key) });
const offNote = (page: Page, key: string) => root(page, key).locator('[data-module-off-note]');

test.beforeEach(async ({ context }) => {
  await resetBot();
  await setModules();
  await login(context);
});

test.afterAll(async () => {
  await setModules();
});

test.describe('Schalter auf der Modulseite', () => {
  for (const { path, key, name } of PAGES) {
    test(`${key}: Stand aus der DB, Ein- und Ausschalten speichert sofort`, async ({ page }) => {
      await setModules({ [key]: false });
      await page.goto(guildPath(path));
      await expect(moduleSwitch(page, key)).toHaveAttribute('aria-checked', 'false');
      await expect(root(page, key).locator('[data-module-state]')).toHaveText(t('modules.state_off', { module: name() }));
      await expect(offNote(page, key)).toBeVisible();
      await expect(offNote(page, key)).toContainText(t('modules.off_title', { module: name() }));

      await moduleSwitch(page, key).click();
      expect((await waitForBotCall('modules/toggle')).changes).toEqual({ [key]: true });
      await expect(moduleSwitch(page, key)).toHaveAttribute('aria-checked', 'true');
      await expect(root(page, key).locator('[data-module-state]')).toHaveText(t('modules.state_on', { module: name() }));
      await expect(offNote(page, key)).toBeHidden();

      await moduleSwitch(page, key).click();
      expect((await waitForBotCall('modules/toggle', 1)).changes).toEqual({ [key]: false });
      await expect(offNote(page, key)).toBeVisible();
    });
  }

  test('eingeschaltetes Modul: kein Hinweis', async ({ page }) => {
    await setModules({ levels: true });
    await page.goto(guildPath('levels/'));
    await expect(moduleSwitch(page, 'levels')).toHaveAttribute('aria-checked', 'true');
    await expect(offNote(page, 'levels')).toBeHidden();
  });

  test('„Jetzt einschalten“ im Hinweis schaltet das Modul ein', async ({ page }) => {
    await page.goto(guildPath('levels/'));
    await root(page, 'levels').locator('[data-module-enable]').click();
    expect((await waitForBotCall('modules/toggle')).changes).toEqual({ levels: true });
    await expect(moduleSwitch(page, 'levels')).toHaveAttribute('aria-checked', 'true');
    await expect(offNote(page, 'levels')).toBeHidden();
  });

  test('ausgeschaltet bleibt die Seite bearbeitbar', async ({ page }) => {
    await page.goto(guildPath('levels/'));
    await expect(offNote(page, 'levels')).toBeVisible();
    await expect(page.locator('#xp-min-input')).toBeEnabled();
    await page.locator('#xp-min-input').fill('10');
    await expect(page.locator('#save-xp-btn')).toBeEnabled();
  });

  test('Fehler des Bots: Meldung, Schalter springt zurück', async ({ page }) => {
    await resetBot({ 'modules/toggle': { status: 400, error: 'Unbekanntes Modul: levels' } });
    const dialogs = collectDialogs(page);
    await page.goto(guildPath('levels/'));
    await moduleSwitch(page, 'levels').click();
    await expect.poll(() => dialogs).toEqual([`${t('common.error_generic')}: Unbekanntes Modul: levels`]);
    await expect(moduleSwitch(page, 'levels')).toHaveAttribute('aria-checked', 'false');
    await expect(offNote(page, 'levels')).toBeVisible();
  });

  test('immer aktive Bereiche haben keinen Schalter', async ({ page }) => {
    for (const path of ['moderation/', 'embeds/', 'giveaways/']) {
      await page.goto(guildPath(path));
      await expect(page.locator('[data-module-switch]')).toHaveCount(0);
    }
  });
});

test.describe('Übersicht', () => {
  test('zeigt jedes Modul mit Stand und Link auf seine Seite', async ({ page }) => {
    await setModules({ levels: true, tickets: false });
    await page.goto(guildPath(''));
    const status = (key: string) => page.locator(`[data-module-status="${key}"]`);
    await expect(status('levels')).toHaveAttribute('data-enabled', 'true');
    await expect(status('tickets')).toHaveAttribute('data-enabled', 'false');
    await expect(status('stream_alerts')).toHaveAttribute('data-enabled', 'true');
    await expect(status('levels')).toHaveAttribute('href', `/server/${GUILD_ID}/levels/`);
    await expect(status('boosts')).toHaveAttribute('href', `/server/${GUILD_ID}/welcome/#boosts`);
    await expect(status('reaction_roles')).toHaveAttribute('href', `/server/${GUILD_ID}/reaction-roles/`);
  });
});

test.describe('Sidebar', () => {
  test('alle Seiten auf einer Ebene, ohne Überschriften', async ({ page }) => {
    await page.goto(guildPath('levels/'));
    const hrefs = await page.locator('aside nav a').evaluateAll((links) => links.map((a) => a.getAttribute('href')));
    const base = `/server/${GUILD_ID}/`;
    expect(hrefs).toEqual([
      base, `${base}moderation/`, `${base}embeds/`, `${base}levels/`, `${base}stream-alerts/`,
      `${base}welcome/`, `${base}reaction-roles/`, `${base}automod/`, `${base}tickets/`, `${base}giveaways/`,
      `${base}settings/`,
    ]);
    await expect(page.locator('aside nav p')).toHaveCount(0);
    await expect(page.locator(`aside a[href="${base}levels/"]`)).toHaveClass(/font-semibold/);   // aktive Seite
  });
});

test.describe('Alte Adressen', () => {
  const REDIRECTS: [string, string][] = [
    ['modules/', ''],
    ['modules/levels/', 'levels/'],
    ['modules/welcome/', 'welcome/'],
    ['modules/reaction-roles/', 'reaction-roles/'],
    ['modules/automod/', 'automod/'],
    ['modules/stream-alerts/', 'stream-alerts/'],
    ['modules/tickets/', 'tickets/'],
    ['modules/boosts/', 'welcome/#boosts'],
  ];
  for (const [from, to] of REDIRECTS) {
    test(`/${from} leitet auf /${to} weiter`, async ({ page }) => {
      await page.goto(guildPath(from));
      await expect(page).toHaveURL(`${page.url().split('/server/')[0]}/server/${GUILD_ID}/${to}`);
    });
  }
});

test.describe('API-Proxy', () => {
  test('fremder Server: Schalten wird abgewiesen und erreicht den Bot nicht', async ({ page }) => {
    await page.goto(guildPath('levels/'));
    const res = await browserPost(page, `/api/server/${FOREIGN_GUILD_ID}/module/modules/toggle/`, {
      changes: { levels: true },
    });
    expect(res.status).toBe(403);
    expect(res.json.error).toBe(t('api_errors.forbidden'));
    expect(await botCalls('modules/toggle')).toHaveLength(0);
  });
});

test.describe('Navigation ohne Neuladen (ClientRouter)', () => {
  const sidebarLink = (page: Page, sub: string) => page.locator(`aside a[href="/server/${GUILD_ID}/${sub}"]`).first();

  test('mehrfach hin und zurück: Umschalten wird genau einmal gesendet', async ({ page }) => {
    await page.goto(guildPath(''));
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => ((window as any).__noReload = true));
      await sidebarLink(page, 'levels/').click();
      await expect(moduleSwitch(page, 'levels')).toBeVisible();
      await sidebarLink(page, '').click();
      await expect(page).toHaveURL(new RegExp(`/server/${GUILD_ID}/$`));
    }
    await sidebarLink(page, 'levels/').click();
    await expect(moduleSwitch(page, 'levels')).toBeVisible();
    expect(await page.evaluate(() => (window as any).__noReload)).toBe(true);

    await moduleSwitch(page, 'levels').click();
    expect((await waitForBotCall('modules/toggle')).changes).toEqual({ levels: true });
    await page.waitForTimeout(500); // etwaige doppelte Aufrufe abwarten
    expect(await botCalls('modules/toggle')).toHaveLength(1);
  });
});
