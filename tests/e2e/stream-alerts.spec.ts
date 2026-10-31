import { test, expect, type Page } from '@playwright/test';
import { login, resetBot, waitForBotCall, botCalls, collectDialogs, guildPath, t } from './support/helpers';
import { CHANNELS, ROLES, defaultBotData } from './support/fixtures.mjs';
import { GUILD_ID } from './support/env.mjs';

// Stream-Alerts: Ping-Rollen, überwachte Kanäle (Twitch/YouTube/Kick) und Verknüpfungen zwischen Kanälen.

const PAGE = guildPath('modules/stream-alerts/');
const XSS = '<img src=x onerror="window.__xss=1">';
const list = defaultBotData['stream_alerts/list'];
const links = defaultBotData['stream_alerts/list-links'];
const [TWITCH] = list.subscriptions.twitch;
const [YOUTUBE] = list.subscriptions.youtube;

const withList = (values: Record<string, unknown>) => ({ 'stream_alerts/list': { data: { ...list, ...values } } });
const withSubs = (subs: Record<string, object[]>) => withList({ subscriptions: { twitch: [], youtube: [], kick: [], ...subs } });

const subRow = (page: Page, id: number | string) => page.locator(`[data-sub-row="${id}"]`);
const platformSection = (page: Page, platform: string) => page.locator(`[data-platform-section="${platform}"]`);
const addSubBtn = (page: Page) => page.locator('#add-sub-btn');
const subForm = (page: Page) => page.locator('#sub-form');
const linkRow = (page: Page, id: number | string) => page.locator(`[data-link-row="${id}"]`);
const linkRows = (page: Page) => page.locator('[data-link-row]');
const savePingBtn = (page: Page) => page.locator('#save-ping-roles-btn');
const counters = (page: Page) => page.locator('#add-sub-btn').locator('xpath=../following-sibling::p[1]');
const expectNoXss = async (page: Page) => expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();

async function fillSubForm(page: Page, values: { platform?: string; username?: string; channel?: string; message?: string }) {
  if (values.platform !== undefined) await page.locator('#new-sub-platform').selectOption(values.platform);
  if (values.username !== undefined) await page.locator('#new-sub-username').fill(values.username);
  if (values.channel !== undefined) await page.locator('#new-sub-channel').selectOption(values.channel);
  if (values.message !== undefined) await page.locator('#new-sub-message').fill(values.message);
}

async function addKick(page: Page, extra: Record<string, string> = {}) {
  await addSubBtn(page).click();
  await fillSubForm(page, { platform: 'kick', username: 'kickstar', channel: CHANNELS[1].id, ...extra });
  await page.locator('#confirm-sub-btn').click();
  await expect(subForm(page)).toBeHidden();
}

test.beforeEach(async ({ context }) => {
  await resetBot();
  await login(context);
});

test.describe('Übersicht', () => {
  test('Kanäle nach Plattform: Ziel-Channel, Nachricht, Live- und Limit-Status', async ({ page }) => {
    await page.goto(PAGE);
    await expect(platformSection(page, 'twitch')).toBeVisible();
    await expect(subRow(page, 11)).toContainText('TwitchStar');
    await expect(subRow(page, 11)).toContainText(`→ #${CHANNELS[0].name} · "Er ist live!"`);
    await expect(subRow(page, 11)).toContainText(t('stream_alerts.live'));

    await expect(subRow(page, 12)).toContainText(`→ ${t('stream_alerts.channel_deleted')}`);
    await expect(subRow(page, 12)).toContainText(t('stream_alerts.inactive_limit'));
    await expect(subRow(page, 12)).toContainText(t('stream_alerts.offline'));

    await expect(platformSection(page, 'kick')).toBeHidden();
    await expect(page.getByText(t('stream_alerts.no_subs'))).toBeHidden();
  });

  test('Zähler je Plattform, ohne Premium mit Premium-Limit als Hinweis', async ({ page }) => {
    await page.goto(PAGE);
    await expect(counters(page)).toContainText('Twitch: 1/1');
    await expect(counters(page)).toContainText('(Premium: 5)');
    await expect(counters(page)).toContainText('Kick: 0/1');

    await resetBot(withList({ premium_active: true }));
    await page.reload();
    await expect(counters(page)).toContainText('Twitch: 1/5');
    await expect(counters(page)).not.toContainText('Premium:');
  });

  test('Ping-Rollen: ohne Premium eine Rolle für alle, mit Premium je Plattform', async ({ page }) => {
    await page.goto(PAGE);
    await expect(page.locator('[data-ping-role]')).toHaveCount(1);
    await expect(page.locator('[data-ping-role="all"]')).toHaveValue('');

    await resetBot(withList({ premium_active: true, ping_roles: { all: null, twitch: ROLES[0].id, youtube: null, kick: ROLES[1].id } }));
    await page.reload();
    await expect(page.locator('[data-ping-role]')).toHaveCount(3);
    await expect(page.locator('[data-ping-role="twitch"]')).toHaveValue(ROLES[0].id);
    await expect(page.locator('[data-ping-role="kick"]')).toHaveValue(ROLES[1].id);
    await expect(savePingBtn(page)).toBeDisabled();
  });

  test('Verknüpfungen und Leer-Hinweise', async ({ page }) => {
    await page.goto(PAGE);
    await expect(linkRow(page, 7)).toContainText('TwitchStar');
    await expect(linkRow(page, 7)).toContainText('TubeStar');
    await expect(page.getByText(t('stream_alerts.no_links'))).toBeHidden();

    await resetBot({ ...withSubs({}), 'stream_alerts/list-links': { data: { links: [] } } });
    await page.reload();
    await expect(page.getByText(t('stream_alerts.no_subs'))).toBeVisible();
    await expect(page.getByText(t('stream_alerts.no_links'))).toBeVisible();
  });

  test('Namen und Nachrichten bleiben Text', async ({ page }) => {
    await resetBot({
      ...withSubs({ twitch: [{ ...TWITCH, streamer_name: `Star ${XSS}`, message: `Nachricht ${XSS}` }] }),
      'stream_alerts/list-links': { data: { links: [{ ...links.links[0], a: { ...links.links[0].a, streamer_name: `Link ${XSS}` } }] } },
    });
    await page.goto(PAGE);
    await expect(subRow(page, 11)).toContainText(`Star ${XSS}`);
    await expect(subRow(page, 11)).toContainText(`Nachricht ${XSS}`);
    await expect(linkRow(page, 7)).toContainText(`Link ${XSS}`);
    await expectNoXss(page);
  });

  test('ohne Bot-Daten erscheint der Offline-Hinweis und alles ist gesperrt', async ({ page }) => {
    await resetBot({ 'stream_alerts/list': { status: 500, error: 'internal_error' } });
    await page.goto(PAGE);
    await expect(page.getByText(t('common.bot_offline'))).toBeVisible();
    await expect(addSubBtn(page)).toBeDisabled();
    await expect(page.locator('#add-link-btn')).toBeDisabled();
    await expect(page.locator('[data-ping-role="all"]')).toBeDisabled();
  });

  test('alle Plätze belegt: Hinzufügen ist gesperrt', async ({ page }) => {
    await resetBot(withSubs({
      twitch: [TWITCH],
      youtube: [{ ...YOUTUBE, active: true }],
      kick: [{ ...TWITCH, monitored_channel_id: 13, subscription_id: 103, streamer_name: 'KickStar' }],
    }));
    await page.goto(PAGE);
    await expect(addSubBtn(page)).toBeDisabled();
  });
});

test.describe('Ping-Rollen', () => {
  test('Speichern sendet die Rolle, „Keine“ sendet null', async ({ page }) => {
    await page.goto(PAGE);
    await page.locator('[data-ping-role="all"]').selectOption(ROLES[1].id);
    await expect(savePingBtn(page)).toBeEnabled();
    await savePingBtn(page).click();
    expect(await waitForBotCall('stream_alerts/set-ping-role')).toMatchObject({ platform: 'all', role_id: ROLES[1].id });
    await expect(savePingBtn(page)).toHaveText(t('common.save'));
    await expect(savePingBtn(page)).toBeDisabled();

    await page.locator('[data-ping-role="all"]').selectOption('');
    await savePingBtn(page).click();
    expect((await waitForBotCall('stream_alerts/set-ping-role', 1)).role_id).toBeNull();
  });

  test('mit Premium werden nur geänderte Plattformen gesendet', async ({ page }) => {
    await resetBot(withList({ premium_active: true }));
    await page.goto(PAGE);
    await page.locator('[data-ping-role="youtube"]').selectOption(ROLES[0].id);
    await savePingBtn(page).click();
    expect(await waitForBotCall('stream_alerts/set-ping-role')).toMatchObject({ platform: 'youtube', role_id: ROLES[0].id });
    await expect(savePingBtn(page)).toHaveText(t('common.save'));
    expect(await botCalls('stream_alerts/set-ping-role')).toHaveLength(1);
  });

  test('Fehler des Bots: Meldung, Speichern bleibt möglich', async ({ page }) => {
    await resetBot({ 'stream_alerts/set-ping-role': { status: 400, error: 'Rolle existiert nicht auf diesem Server' } });
    const dialogs = collectDialogs(page);
    await page.goto(PAGE);
    await page.locator('[data-ping-role="all"]').selectOption(ROLES[1].id);
    await savePingBtn(page).click();
    await expect.poll(() => dialogs.join('\n')).toContain('Rolle existiert nicht auf diesem Server');
    await expect(savePingBtn(page)).toBeEnabled();
  });
});

test.describe('Überwachte Kanäle', () => {
  test('hinzufügen: Pflichtfeld, Payload, neue Zeile in der richtigen Plattform', async ({ page }) => {
    const dialogs = collectDialogs(page);
    await page.goto(PAGE);
    await addSubBtn(page).click();
    await expect(page.locator('#sub-form-title')).toHaveText(t('stream_alerts.sub_form_add_title'));
    await page.locator('#confirm-sub-btn').click();
    await expect.poll(() => dialogs).toEqual([t('stream_alerts.alert_username_required')]);
    expect(await botCalls('stream_alerts/add')).toHaveLength(0);

    await fillSubForm(page, { platform: 'kick', username: '  kickstar ', channel: CHANNELS[1].id, message: ' Hallo ' });
    await page.locator('#confirm-sub-btn').click();
    expect(await waitForBotCall('stream_alerts/add')).toMatchObject({
      platform: 'kick', username: 'kickstar', channel_id: CHANNELS[1].id, message: 'Hallo',
    });
    await expect(subForm(page)).toBeHidden();
    await expect(platformSection(page, 'kick')).toBeVisible();
    await expect(platformSection(page, 'kick').locator('[data-sub-row="20"]')).toContainText('kickstar');
    await expect(subRow(page, 20)).toContainText(`→ #${CHANNELS[1].name} · "Hallo"`);
  });

  test('ohne Nachricht wird null gesendet', async ({ page }) => {
    await page.goto(PAGE);
    await addKick(page);
    expect((await waitForBotCall('stream_alerts/add')).message).toBeNull();
    await expect(subRow(page, 20)).toContainText(`→ #${CHANNELS[1].name}`);
    await expect(subRow(page, 20)).not.toContainText('"');
  });

  test('bearbeiten: Plattform und Name gesperrt, Payload, Zeile aktualisiert', async ({ page }) => {
    await page.goto(PAGE);
    await subRow(page, 11).locator('[data-edit-sub]').click();
    await expect(page.locator('#sub-form-title')).toHaveText(t('stream_alerts.sub_form_edit_title'));
    await expect(page.locator('#new-sub-platform')).toHaveValue('twitch');
    await expect(page.locator('#new-sub-platform')).toBeDisabled();
    await expect(page.locator('#new-sub-username')).toHaveValue('TwitchStar');
    await expect(page.locator('#new-sub-username')).toBeDisabled();
    await expect(page.locator('#new-sub-channel')).toHaveValue(CHANNELS[0].id);
    await expect(page.locator('#new-sub-message')).toHaveValue('Er ist live!');

    await fillSubForm(page, { channel: CHANNELS[1].id, message: 'Neu' });
    await page.locator('#confirm-sub-btn').click();
    expect(await waitForBotCall('stream_alerts/edit')).toMatchObject({ monitored_channel_id: '11', channel_id: CHANNELS[1].id, message: 'Neu' });
    await expect(subForm(page)).toBeHidden();
    await expect(subRow(page, 11)).toContainText(`→ #${CHANNELS[1].name} · "Neu"`);

    // Nachricht leeren schickt null
    await subRow(page, 11).locator('[data-edit-sub]').click();
    await expect(page.locator('#new-sub-message')).toHaveValue('Neu');
    await fillSubForm(page, { message: '' });
    await page.locator('#confirm-sub-btn').click();
    expect((await waitForBotCall('stream_alerts/edit', 1)).message).toBeNull();

    // Danach ist das Formular wieder im Hinzufügen-Modus
    await addSubBtn(page).click();
    await expect(page.locator('#new-sub-username')).toBeEnabled();
    await expect(page.locator('#new-sub-username')).toHaveValue('');
  });

  test('entfernen: Rückfrage, Payload, leere Plattform wird ausgeblendet', async ({ page }) => {
    const dialogs = collectDialogs(page);
    await page.goto(PAGE);
    await subRow(page, 11).locator('[data-remove-sub]').click();
    expect(await waitForBotCall('stream_alerts/remove')).toMatchObject({ monitored_channel_id: '11' });
    expect(dialogs).toEqual([t('stream_alerts.confirm_remove_sub')]);
    await expect(subRow(page, 11)).toHaveCount(0);
    await expect(platformSection(page, 'twitch')).toBeHidden();
  });

  test('entfernen abgebrochen: nichts wird gesendet', async ({ page }) => {
    const dialogs = collectDialogs(page, { accept: false });
    await page.goto(PAGE);
    await subRow(page, 11).locator('[data-remove-sub]').click();
    await expect.poll(() => dialogs.length).toBe(1);
    await page.waitForTimeout(300);
    expect(await botCalls('stream_alerts/remove')).toHaveLength(0);
    await expect(subRow(page, 11)).toBeVisible();
  });

  test('neu angelegte Zeile lässt sich bearbeiten und entfernen', async ({ page }) => {
    collectDialogs(page);
    await page.goto(PAGE);
    await addKick(page, { message: 'Hi' });
    await subRow(page, 20).locator('[data-edit-sub]').click();
    await expect(page.locator('#new-sub-platform')).toHaveValue('kick');
    await expect(page.locator('#new-sub-username')).toHaveValue('kickstar');
    await expect(page.locator('#new-sub-message')).toHaveValue('Hi');
    await page.locator('#cancel-sub-btn').click();

    await subRow(page, 20).locator('[data-remove-sub]').click();
    expect((await waitForBotCall('stream_alerts/remove')).monitored_channel_id).toBe('20');
    await expect(subRow(page, 20)).toHaveCount(0);
  });

  test('Fehler des Bots: Meldung, Formular bleibt offen', async ({ page }) => {
    await resetBot({ 'stream_alerts/add': { status: 400, error: "User 'kickstar' wurde nicht gefunden" } });
    const dialogs = collectDialogs(page);
    await page.goto(PAGE);
    await addSubBtn(page).click();
    await fillSubForm(page, { platform: 'kick', username: 'kickstar' });
    await page.locator('#confirm-sub-btn').click();
    await expect.poll(() => dialogs.join('\n')).toContain("User 'kickstar' wurde nicht gefunden");
    await expect(subForm(page)).toBeVisible();
    await expect(subRow(page, 20)).toHaveCount(0);
  });
});

test.describe('Verknüpfungen', () => {
  test('erstellen: gleiche Kanäle abgelehnt, Payload, neue Zeile', async ({ page }) => {
    await resetBot({ 'stream_alerts/list-links': { data: { links: [] } } });
    const dialogs = collectDialogs(page);
    await page.goto(PAGE);
    await page.locator('#add-link-btn').click();
    await page.locator('#link-sub-a').selectOption('101');
    await page.locator('#link-sub-b').selectOption('101');
    await page.locator('#confirm-link-btn').click();
    await expect.poll(() => dialogs).toEqual([t('stream_alerts.alert_different_channels')]);

    await page.locator('#link-sub-b').selectOption('102');
    await page.locator('#confirm-link-btn').click();
    expect(await waitForBotCall('stream_alerts/create-link')).toMatchObject({ subscription_a_id: '101', subscription_b_id: '102' });
    await expect(linkRow(page, 8)).toContainText('TwitchStar');
    await expect(linkRow(page, 8)).toContainText('TubeStar');
    await expect(page.locator('#link-form')).toBeHidden();
    await expect(page.getByText(t('stream_alerts.no_links'))).toBeHidden();
  });

  test('trennen: Rückfrage, Payload, Zeile verschwindet', async ({ page }) => {
    const dialogs = collectDialogs(page);
    await page.goto(PAGE);
    await linkRow(page, 7).locator('[data-remove-link]').click();
    expect(await waitForBotCall('stream_alerts/delete-link')).toMatchObject({ link_id: '7' });
    expect(dialogs).toEqual([t('stream_alerts.confirm_remove_link')]);
    await expect(linkRow(page, 7)).toHaveCount(0);
  });

  test('Fehler des Bots: Meldung, Formular bleibt offen', async ({ page }) => {
    await resetBot({ 'stream_alerts/create-link': { status: 400, error: 'Diese Verknüpfung existiert bereits' } });
    const dialogs = collectDialogs(page);
    await page.goto(PAGE);
    await page.locator('#add-link-btn').click();
    await page.locator('#link-sub-b').selectOption('102');
    await page.locator('#confirm-link-btn').click();
    await expect.poll(() => dialogs.join('\n')).toContain('Diese Verknüpfung existiert bereits');
    await expect(page.locator('#link-form')).toBeVisible();
    await expect(linkRows(page)).toHaveCount(1);
  });
});

test.describe('Anzeige nach Änderungen', () => {
  test('nach dem Hinzufügen: Zähler steigt, bei vollem Kontingent wird Hinzufügen gesperrt', async ({ page }) => {
    await page.goto(PAGE);
    await addKick(page);
    await expect(counters(page)).toContainText('Kick: 1/1', { timeout: 2000 });
    await expect(addSubBtn(page)).toBeDisabled(); // 3 von 3 Plätzen belegt
  });

  test('nach dem Entfernen bei vollem Kontingent ist Hinzufügen wieder möglich', async ({ page }) => {
    await resetBot(withSubs({
      twitch: [TWITCH],
      youtube: [{ ...YOUTUBE, active: true }],
      kick: [{ ...TWITCH, monitored_channel_id: 13, subscription_id: 103, streamer_name: 'KickStar' }],
    }));
    collectDialogs(page);
    await page.goto(PAGE);
    await subRow(page, 13).locator('[data-remove-sub]').click();
    await expect(subRow(page, 13)).toHaveCount(0);
    await expect(addSubBtn(page)).toBeEnabled({ timeout: 2000 });
    await expect(counters(page)).toContainText('Kick: 0/1');
  });

  test('letzten Kanal entfernt: der Hinweis „keine Kanäle“ erscheint', async ({ page }) => {
    await resetBot(withSubs({ twitch: [TWITCH] }));
    collectDialogs(page);
    await page.goto(PAGE);
    await subRow(page, 11).locator('[data-remove-sub]').click();
    await expect(subRow(page, 11)).toHaveCount(0);
    await expect(page.getByText(t('stream_alerts.no_subs'))).toBeVisible({ timeout: 2000 });
  });

  test('neu angelegte Zeile zeigt den Offline-Status wie die übrigen', async ({ page }) => {
    await page.goto(PAGE);
    await addKick(page);
    await expect(subRow(page, 20)).toContainText(t('stream_alerts.offline'), { timeout: 2000 });
  });

  test('Kanal entfernt: er verschwindet aus der Verknüpfungs-Auswahl, seine Verknüpfungen auch', async ({ page }) => {
    collectDialogs(page);
    await page.goto(PAGE);
    await subRow(page, 12).locator('[data-remove-sub]').click();
    await expect(subRow(page, 12)).toHaveCount(0);
    await expect(linkRow(page, 7)).toHaveCount(0, { timeout: 2000 });
    await expect(page.locator('#link-sub-a option[value="102"]')).toHaveCount(0);
    await expect(page.locator('#link-sub-b option[value="102"]')).toHaveCount(0);
    await expect(page.getByText(t('stream_alerts.no_links'))).toBeVisible();
  });

  test('neuer Kanal ist sofort verknüpfbar, wenn der Bot die Abo-ID mitliefert', async ({ page }) => {
    await resetBot({ 'stream_alerts/add': { data: { monitored_channel_id: 20, subscription_id: 120, streamer_name: 'kickstar', platform: 'kick' } } });
    await page.goto(PAGE);
    await addKick(page);
    await expect(page.locator('#link-sub-a option[value="120"]')).toHaveText('kickstar', { timeout: 2000 });
    await expect(page.locator('#link-sub-b option[value="120"]')).toHaveText('kickstar');
  });

  test('letzte Verknüpfung getrennt: der Hinweis „keine Verknüpfungen“ erscheint', async ({ page }) => {
    collectDialogs(page);
    await page.goto(PAGE);
    await linkRow(page, 7).locator('[data-remove-link]').click();
    await expect(linkRow(page, 7)).toHaveCount(0);
    await expect(page.getByText(t('stream_alerts.no_links'))).toBeVisible({ timeout: 2000 });
  });
});

test.describe('Navigation ohne Neuladen (ClientRouter)', () => {
  const sidebarLink = (page: Page, sub: string) => page.locator(`aside a[href="/server/${GUILD_ID}/${sub}"]`).first();

  test('mehrfach hin und zurück: Aktionen werden genau einmal gesendet', async ({ page }) => {
    collectDialogs(page);
    // Start in der Modul-Übersicht: nur dort ist das Untermenü mit dem Stream-Alerts-Link aufgeklappt
    await page.goto(guildPath('modules/'));
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => ((window as any).__noReload = true));
      await sidebarLink(page, 'modules/stream-alerts/').click();
      await expect(addSubBtn(page)).toBeVisible();
      await sidebarLink(page, 'modules/').click();
      await expect(page).toHaveURL(new RegExp(`/server/${GUILD_ID}/modules/$`));
    }
    await sidebarLink(page, 'modules/stream-alerts/').click();
    await expect(addSubBtn(page)).toBeVisible();
    expect(await page.evaluate(() => (window as any).__noReload)).toBe(true);

    await linkRow(page, 7).locator('[data-remove-link]').click();
    await waitForBotCall('stream_alerts/delete-link');
    await subRow(page, 11).locator('[data-remove-sub]').click();
    await waitForBotCall('stream_alerts/remove');
    await page.waitForTimeout(500); // etwaige doppelte Aufrufe abwarten
    expect(await botCalls('stream_alerts/remove')).toHaveLength(1);
    expect(await botCalls('stream_alerts/delete-link')).toHaveLength(1);
  });
});
