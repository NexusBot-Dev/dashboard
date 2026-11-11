import { test, expect, type Page } from '@playwright/test';
import { login, resetBot, waitForBotCall, botCalls, collectDialogs, guildPath, t, delayPageWiring, expectNotWiredYet } from './support/helpers';
import { CHANNELS, ROLES, SCHEDULE, STORED_IMAGE, defaultBotData } from './support/fixtures.mjs';
import { GUILD_ID } from './support/env.mjs';

// Stream-Alerts: Ping-Rollen, überwachte Kanäle (Twitch/YouTube/Kick) und Verknüpfungen zwischen Kanälen.

const PAGE = guildPath('stream-alerts/');
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
const scheduleRow = (page: Page, id: number | string) => page.locator(`[data-schedule-row="${id}"]`);
const scheduleSwitch = (page: Page, id: number | string) => scheduleRow(page, id).locator('[data-schedule-toggle]');
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
    await expect(page.locator('#link-sub-a option[value="101"]')).toHaveText(`Star ${XSS} (Twitch) → #${CHANNELS[0].name}`);
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

  test('Hinweis vom Bot (z. B. fehlende Kanalrechte) wird angezeigt, gespeichert ist trotzdem', async ({ page }) => {
    const warning = '⚠️ Achtung: In #news fehlen mir noch Rechte (Send Messages).';
    await resetBot({
      'stream_alerts/add': { data: { monitored_channel_id: 20, streamer_name: 'kickstar', platform: 'kick', warning } },
      'stream_alerts/edit': { data: { monitored_channel_id: '11', warning } },
    });
    const dialogs = collectDialogs(page);
    await page.goto(PAGE);
    await addKick(page);
    await expect.poll(() => dialogs).toEqual([warning]);
    await expect(subRow(page, 20)).toContainText('kickstar');

    await subRow(page, 11).locator('[data-edit-sub]').click();
    await fillSubForm(page, { channel: CHANNELS[1].id });
    await page.locator('#confirm-sub-btn').click();
    await expect.poll(() => dialogs).toEqual([warning, warning]);
    await expect(subRow(page, 11)).toContainText(`→ #${CHANNELS[1].name}`);
  });

  test('ohne Hinweis kein Dialog', async ({ page }) => {
    const dialogs = collectDialogs(page);
    await page.goto(PAGE);
    await addKick(page);
    await expect(subRow(page, 20)).toBeVisible();
    expect(dialogs).toEqual([]);
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

  test('Auswahl und Verknüpfungen zeigen Plattform und Ziel-Channel', async ({ page }) => {
    await page.goto(PAGE);
    await expect(page.locator('#link-sub-a option')).toHaveText([
      `TwitchStar (Twitch) → #${CHANNELS[0].name}`,
      `TubeStar (YouTube) → ${t('stream_alerts.channel_deleted')}`,
    ]);
    await expect(linkRow(page, 7).locator('[data-side="a"] [data-field="target"]')).toHaveText(`→ #${CHANNELS[0].name}`);
    await expect(linkRow(page, 7).locator('[data-side="b"] [data-field="target"]')).toHaveText(`→ ${t('stream_alerts.channel_deleted')}`);
    // Je Seite genau ein Icon: das der Plattform
    await expect(linkRow(page, 7).locator('[data-side="a"] [data-platform-icon]:visible')).toHaveCount(1);
    await expect(linkRow(page, 7).locator('[data-side="a"] [data-platform-icon="twitch"]')).toBeVisible();
    await expect(linkRow(page, 7).locator('[data-side="b"] [data-platform-icon]:visible')).toHaveCount(1);
    await expect(linkRow(page, 7).locator('[data-side="b"] [data-platform-icon="youtube"]')).toBeVisible();
  });

  test('gleichnamige Kanäle sind unterscheidbar — in der Auswahl und in der neuen Verknüpfung', async ({ page }) => {
    await resetBot({
      ...withSubs({
        twitch: [{ ...TWITCH, streamer_name: 'Gronkh' }],
        youtube: [{ ...YOUTUBE, streamer_name: 'Gronkh', channel_name: CHANNELS[1].name }],
        kick: [{ ...TWITCH, monitored_channel_id: 13, subscription_id: 103, streamer_name: 'Gronkh', channel_id: CHANNELS[1].id, channel_name: CHANNELS[1].name }],
      }),
      'stream_alerts/list-links': { data: { links: [] } },
    });
    await page.goto(PAGE);
    await expect(page.locator('#link-sub-b option')).toHaveText([
      `Gronkh (Twitch) → #${CHANNELS[0].name}`,
      `Gronkh (YouTube) → #${CHANNELS[1].name}`,
      `Gronkh (Kick) → #${CHANNELS[1].name}`,
    ]);
    // Nach Plattform gruppiert
    for (const [platform, label] of [['twitch', 'Twitch'], ['youtube', 'YouTube'], ['kick', 'Kick']]) {
      await expect(page.locator(`#link-sub-b optgroup[data-platform="${platform}"]`)).toHaveAttribute('label', label);
      await expect(page.locator(`#link-sub-b optgroup[data-platform="${platform}"] option`)).toHaveCount(1);
    }

    await page.locator('#add-link-btn').click();
    await page.locator('#link-sub-a').selectOption('102');
    await page.locator('#link-sub-b').selectOption('103');
    await page.locator('#confirm-link-btn').click();
    const row = linkRow(page, 8);
    await expect(row.locator('[data-side="a"] [data-field="name"]')).toHaveText('Gronkh');
    await expect(row.locator('[data-side="a"] [data-platform-icon="youtube"]')).toBeVisible();
    await expect(row.locator('[data-side="b"] [data-platform-icon="kick"]')).toBeVisible();
    await expect(row.locator('[data-platform-icon]:visible')).toHaveCount(2);   // je Seite nur das passende
    await expect(row.locator('[data-side="b"] [data-field="target"]')).toHaveText(`→ #${CHANNELS[1].name}`);
  });

  test('Ziel-Channel geändert: Auswahl und Verknüpfung zeigen den neuen', async ({ page }) => {
    await page.goto(PAGE);
    await subRow(page, 11).locator('[data-edit-sub]').click();
    await fillSubForm(page, { channel: CHANNELS[1].id });
    await page.locator('#confirm-sub-btn').click();
    await expect(subForm(page)).toBeHidden();
    await expect(page.locator('#link-sub-a option[value="101"]')).toHaveText(`TwitchStar (Twitch) → #${CHANNELS[1].name}`);
    await expect(page.locator('#link-sub-b option[value="101"]')).toHaveText(`TwitchStar (Twitch) → #${CHANNELS[1].name}`);
    await expect(linkRow(page, 7).locator('[data-side="a"] [data-field="target"]')).toHaveText(`→ #${CHANNELS[1].name}`);
    await expect(linkRow(page, 7).locator('[data-side="b"] [data-field="target"]')).toHaveText(`→ ${t('stream_alerts.channel_deleted')}`);
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
    await expect(page.locator('#link-sub-a optgroup[data-platform="youtube"]')).toHaveCount(0);   // keine leere Überschrift
    await expect(page.locator('#link-sub-a optgroup[data-platform="twitch"]')).toHaveCount(1);
    await expect(page.getByText(t('stream_alerts.no_links'))).toBeVisible();
  });

  test('neuer Kanal ist sofort verknüpfbar, wenn der Bot die Abo-ID mitliefert', async ({ page }) => {
    await resetBot({ 'stream_alerts/add': { data: { monitored_channel_id: 20, subscription_id: 120, streamer_name: 'kickstar', platform: 'kick' } } });
    await page.goto(PAGE);
    await addKick(page);
    const label = `kickstar (Kick) → #${CHANNELS[1].name}`;
    await expect(page.locator('#link-sub-a option[value="120"]')).toHaveText(label, { timeout: 2000 });
    await expect(page.locator('#link-sub-b option[value="120"]')).toHaveText(label);
    // Neue Gruppe "Kick" — in Plattform-Reihenfolge hinter Twitch und YouTube
    expect(await page.locator('#link-sub-a optgroup').evaluateAll((groups) => groups.map((g) => (g as HTMLOptGroupElement).label)))
      .toEqual(['Twitch', 'YouTube', 'Kick']);
    await expect(page.locator('#link-sub-a optgroup[data-platform="kick"] option[value="120"]')).toHaveCount(1);
  });

  test('neue Plattform-Gruppe landet an ihrem Platz in der Reihenfolge', async ({ page }) => {
    await resetBot({
      ...withSubs({ twitch: [TWITCH], kick: [{ ...TWITCH, monitored_channel_id: 13, subscription_id: 103, streamer_name: 'KickStar' }] }),
      'stream_alerts/add': { data: { monitored_channel_id: 20, subscription_id: 120, streamer_name: 'tuber', platform: 'youtube' } },
    });
    await page.goto(PAGE);
    await addSubBtn(page).click();
    await fillSubForm(page, { platform: 'youtube', username: 'tuber', channel: CHANNELS[1].id });
    await page.locator('#confirm-sub-btn').click();
    await expect(page.locator('#link-sub-b optgroup[data-platform="youtube"] option[value="120"]')).toHaveCount(1);
    expect(await page.locator('#link-sub-b optgroup').evaluateAll((groups) => groups.map((g) => (g as HTMLOptGroupElement).label)))
      .toEqual(['Twitch', 'YouTube', 'Kick']);
  });

  test('letzte Verknüpfung getrennt: der Hinweis „keine Verknüpfungen“ erscheint', async ({ page }) => {
    collectDialogs(page);
    await page.goto(PAGE);
    await linkRow(page, 7).locator('[data-remove-link]').click();
    await expect(linkRow(page, 7)).toHaveCount(0);
    await expect(page.getByText(t('stream_alerts.no_links'))).toBeVisible({ timeout: 2000 });
  });
});

test.describe('Tab „Streamplan“', () => {
  const scheduleTab = (page: Page) => page.locator('#tab-schedule');
  const limitNote = (page: Page) => page.locator('#schedule-limit-note');
  const withSchedule = (values: Record<string, unknown>) => ({ 'stream_alerts/schedule': { data: { ...SCHEDULE, ...values } } });
  const MAX = { ...SCHEDULE.entries[0], monitored_channel_id: 14, streamer_name: 'MaxStreams', enabled: false, active: false, events: 0 };

  async function openSchedule(page: Page) {
    await page.goto(PAGE);
    await scheduleTab(page).click();
    await expect(page.locator('#tab-panel-schedule')).toBeVisible();
  }

  test('Tabs: Alerts zuerst, Streamplan per Klick und per #schedule in der Adresse', async ({ page }) => {
    await page.goto(PAGE);
    await expect(page.locator('#tab-panel-alerts')).toBeVisible();
    await expect(page.locator('#tab-panel-schedule')).toBeHidden();
    await scheduleTab(page).click();
    await expect(page.locator('#tab-panel-alerts')).toBeHidden();
    await expect(page).toHaveURL(/#schedule$/);

    await page.goto(`${PAGE}#schedule`);
    await page.reload();
    await expect(page.locator('#tab-panel-schedule')).toBeVisible();
  });

  test('Übersicht: Zeitfenster, Premium-Hinweis, Status und Limit', async ({ page }) => {
    await openSchedule(page);
    await expect(page.locator('#schedule-desc')).toHaveText(t('stream_alerts.schedule_desc', { days: 7 }));
    await expect(page.getByText(t('stream_alerts.schedule_premium_hint', { max: 5 }))).toBeVisible();
    await expect(scheduleRow(page, 11)).toContainText('TwitchStar');
    await expect(scheduleRow(page, 11).locator('[data-field="status"]')).toHaveText(t('stream_alerts.schedule_events', { count: 2 }));
    await expect(scheduleSwitch(page, 11)).toHaveAttribute('aria-checked', 'true');
    await expect(scheduleSwitch(page, 11)).toBeEnabled();   // ausschalten geht immer
    await expect(limitNote(page)).toHaveText(t('stream_alerts.schedule_limit_premium', { limit: 1, max: 5 }));
    await expect(page.locator('#schedule-permission-warning')).toHaveCount(0);
    await expect(page.locator('#no-schedule-msg')).toBeHidden();
  });

  test('ausschalten: Payload, Zeile und Limit-Hinweis aus der Antwort des Bots', async ({ page }) => {
    await openSchedule(page);
    await scheduleSwitch(page, 11).click();
    expect(await waitForBotCall('stream_alerts/schedule-toggle')).toMatchObject({ monitored_channel_id: '11', enabled: false });
    await expect(scheduleSwitch(page, 11)).toHaveAttribute('aria-checked', 'false');
    await expect(scheduleRow(page, 11).locator('[data-field="status"]')).toHaveText(t('stream_alerts.schedule_off'));
    await expect(limitNote(page)).toBeHidden();

    await scheduleSwitch(page, 11).click();   // wieder ein
    expect((await waitForBotCall('stream_alerts/schedule-toggle', 1)).enabled).toBe(true);
    await expect(scheduleRow(page, 11).locator('[data-field="status"]')).toHaveText(t('stream_alerts.schedule_events', { count: 3 }));
    await expect(scheduleSwitch(page, 11)).toHaveAttribute('aria-checked', 'true');
  });

  test('am Limit: ausgeschaltete Kanäle sind gesperrt, mit Premium ohne Kauf-Hinweis', async ({ page }) => {
    await resetBot(withSchedule({ entries: [SCHEDULE.entries[0], MAX] }));
    await openSchedule(page);
    await expect(scheduleSwitch(page, 14)).toBeDisabled();
    await expect(scheduleSwitch(page, 11)).toBeEnabled();

    await resetBot(withSchedule({ entries: [SCHEDULE.entries[0], MAX], limit: 5, premium_active: true }));
    await page.reload();
    await expect(scheduleSwitch(page, 14)).toBeEnabled();
    await expect(limitNote(page)).toBeHidden();
    await expect(page.getByText(t('stream_alerts.schedule_premium_hint', { max: 5 }))).toHaveCount(0);

    await resetBot(withSchedule({ entries: [SCHEDULE.entries[0]], limit: 1, premium_limit: 1, premium_active: true }));
    await page.reload();
    await expect(limitNote(page)).toHaveText(t('stream_alerts.schedule_limit_reached', { limit: 1 }));
  });

  test('Fehler aus dem Abgleich, inaktiv über dem Limit, fehlendes Recht', async ({ page }) => {
    await resetBot(withSchedule({
      entries: [{ ...SCHEDULE.entries[0], error: 'no_schedule' }, { ...MAX, enabled: true, active: false }],
      can_create_events: false,
    }));
    await openSchedule(page);
    await expect(scheduleRow(page, 11).locator('[data-field="error"]')).toHaveText(t('stream_alerts.schedule_err_no_schedule'));
    await expect(scheduleRow(page, 14).locator('[data-field="status"]')).toHaveText(t('stream_alerts.inactive_limit'));
    await expect(scheduleRow(page, 14).locator('[data-field="error"]')).toBeHidden();
    await expect(page.locator('#schedule-permission-warning')).toHaveText(t('stream_alerts.schedule_missing_permission'));
  });

  test('ohne Twitch-Kanal ein Hinweis, ohne Antwort des Bots eine Meldung', async ({ page }) => {
    await resetBot(withSchedule({ entries: [] }));
    await openSchedule(page);
    await expect(page.locator('#no-schedule-msg')).toHaveText(t('stream_alerts.schedule_no_twitch'));

    await resetBot({ 'stream_alerts/schedule': { status: 500, error: 'internal_error' } });
    await page.reload();
    await expect(page.getByText(t('stream_alerts.schedule_unavailable'))).toBeVisible();
    await expect(page.locator('#tab-panel-alerts')).toBeHidden();   // die restliche Seite funktioniert weiter
    await page.locator('#tab-alerts').click();
    await expect(subRow(page, 11)).toBeVisible();
  });

  test('Fehler des Bots beim Umschalten: Meldung, Schalter bleibt wie er war', async ({ page }) => {
    await resetBot({ 'stream_alerts/schedule-toggle': { status: 400, error: 'Limit erreicht: höchstens 1 Streamer.' } });
    const dialogs = collectDialogs(page);
    await openSchedule(page);
    await scheduleSwitch(page, 11).click();
    await expect.poll(() => dialogs.join('\n')).toContain('Limit erreicht: höchstens 1 Streamer.');
    await expect(scheduleSwitch(page, 11)).toHaveAttribute('aria-checked', 'true');
    await expect(scheduleSwitch(page, 11)).toBeEnabled();
  });

  test('Twitch-Kanal im Tab „Alerts“ hinzugefügt oder entfernt: Streamplan-Liste wird neu geladen', async ({ page }) => {
    collectDialogs(page);
    await page.goto(PAGE);
    expect(await botCalls('stream_alerts/schedule')).toHaveLength(1);   // beim Laden der Seite
    await addKick(page);
    await page.waitForTimeout(300);
    expect(await botCalls('stream_alerts/schedule')).toHaveLength(1);   // Kick betrifft den Streamplan nicht

    await subRow(page, 11).locator('[data-remove-sub]').click();
    await expect.poll(async () => (await botCalls('stream_alerts/schedule')).length).toBe(2);
  });

  test('Namen bleiben Text, auch nach dem Neuaufbau', async ({ page }) => {
    await resetBot(withSchedule({ entries: [{ ...SCHEDULE.entries[0], streamer_name: `Star ${XSS}` }] }));
    await openSchedule(page);
    await expect(scheduleRow(page, 11)).toContainText(`Star ${XSS}`);
    await resetBot({
      'stream_alerts/schedule-toggle': { data: { ...SCHEDULE, entries: [{ ...SCHEDULE.entries[0], streamer_name: `Neu ${XSS}`, enabled: false }] } },
    });
    await scheduleSwitch(page, 11).click();
    await expect(scheduleRow(page, 11)).toContainText(`Neu ${XSS}`);
    await expectNoXss(page);
  });

  test('Bildquelle: Auswahl nur bei eingeschalteten Kanälen, Payload, Anzeige aus der Antwort', async ({ page }) => {
    await resetBot(withSchedule({ entries: [SCHEDULE.entries[0], MAX] }));
    await openSchedule(page);
    const image = (id: number) => scheduleRow(page, id).locator('[data-schedule-image]');
    await expect(image(11)).toBeVisible();
    await expect(image(11)).toHaveValue('banner');
    await expect(image(11).locator('option')).toHaveText([
      t('stream_alerts.schedule_image_banner'), t('stream_alerts.schedule_image_offline'), t('stream_alerts.schedule_image_none'),
    ]);
    await expect(image(14)).toBeHidden();   // ausgeschaltet

    await image(11).selectOption('none');
    expect(await waitForBotCall('stream_alerts/schedule-image')).toMatchObject({ monitored_channel_id: '11', source: 'none' });
    await expect(image(11)).toHaveValue('none');
    await expect(image(11)).toBeEnabled();
  });

  test('Bildquelle: Fehler des Bots setzt die Auswahl zurück', async ({ page }) => {
    await resetBot({ 'stream_alerts/schedule-image': { status: 400, error: 'Der Kanal wurde nicht gefunden.' } });
    const dialogs = collectDialogs(page);
    await openSchedule(page);
    const image = scheduleRow(page, 11).locator('[data-schedule-image]');
    await image.selectOption('offline');
    await expect.poll(() => dialogs.join('\n')).toContain('Der Kanal wurde nicht gefunden.');
    await expect(image).toHaveValue('banner');
    await expect(image).toBeEnabled();
  });

  test('Bildquelle: ältere Bots ohne Angabe — keine Auswahl', async ({ page }) => {
    const { image_source: _, ...entry } = SCHEDULE.entries[0];
    await resetBot(withSchedule({ entries: [entry] }));
    await openSchedule(page);
    await expect(scheduleRow(page, 11).locator('[data-schedule-image]')).toBeHidden();
    await expect(scheduleSwitch(page, 11)).toBeVisible();
  });

  test('Testphase: auf anderen Servern nur „Bald verfügbar“, keine Schalter', async ({ page }) => {
    await resetBot(withSchedule({ available: false }));
    await openSchedule(page);
    await expect(page.locator('#schedule-soon')).toHaveText(t('stream_alerts.schedule_soon'));
    await expect(page.locator('[data-schedule-toggle]')).toHaveCount(0);
    await expect(page.locator('#schedule-desc')).toHaveCount(0);

    // Twitch-Kanal entfernt: das Neuladen der Liste darf ohne Liste nichts kaputt machen
    collectDialogs(page);
    await page.locator('#tab-alerts').click();
    await subRow(page, 11).locator('[data-remove-sub]').click();
    await expect(subRow(page, 11)).toHaveCount(0);
    await page.waitForTimeout(300);
    expect(await botCalls('stream_alerts/schedule')).toHaveLength(1);   // nur beim Laden der Seite
  });

  test('ältere Bots ohne Angabe gelten als freigegeben', async ({ page }) => {
    const withoutFlag: Record<string, unknown> = { ...SCHEDULE };
    delete withoutFlag.available;
    await resetBot({ 'stream_alerts/schedule': { data: withoutFlag } });
    await openSchedule(page);
    await expect(scheduleSwitch(page, 11)).toBeVisible();
  });

  test('ohne Bot: Schalter gesperrt', async ({ page }) => {
    await resetBot({ 'stream_alerts/list': { status: 500, error: 'internal_error' } });
    await openSchedule(page);
    await expect(scheduleSwitch(page, 11)).toBeDisabled();
  });
});

test.describe('Streamplan: Text & Bild (Premium)', () => {
  const PREMIUM = { 'stream_alerts/schedule': { data: { ...SCHEDULE, limit: 5, premium_active: true } } };
  const withEntry = (values: Record<string, unknown>, premium = true) => ({
    'stream_alerts/schedule': { data: { ...SCHEDULE, limit: 5, premium_active: premium, entries: [{ ...SCHEDULE.entries[0], ...values }] } },
  });
  const form = (page: Page) => page.locator('#schedule-custom-form');
  const customBtn = (page: Page, id = 11) => scheduleRow(page, id).locator('[data-schedule-custom]');
  const textarea = (page: Page) => page.locator('#schedule-custom-text');
  const previewText = (page: Page) => page.locator('#schedule-custom-preview-text');
  const imageNote = (page: Page) => page.locator('#schedule-custom-image-note');

  async function openEditor(page: Page, id = 11) {
    await page.goto(`${PAGE}#schedule`);
    await customBtn(page, id).click();
    await expect(form(page)).toBeVisible();
  }

  /** Ein Bild wie vom Rechner: PNG in der gewünschten Größe, im Browser gezeichnet — obere Hälfte blau, untere rot */
  async function pngFile(page: Page, width: number, height: number) {
    const base64 = await page.evaluate(([w, h]) => {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#2828d0';
      ctx.fillRect(0, 0, w, h / 2);
      ctx.fillStyle = '#d02828';
      ctx.fillRect(0, h / 2, w, h / 2);
      return canvas.toDataURL('image/png').split(',')[1];
    }, [width, height]);
    return { name: 'banner.png', mimeType: 'image/png', buffer: Buffer.from(base64, 'base64') };
  }

  test('ohne Premium: Hinweis statt Editor, gespeicherte Inhalte werden erwähnt', async ({ page }) => {
    await openEditor(page);
    await expect(page.locator('#schedule-custom-title')).toHaveText(t('stream_alerts.schedule_custom_title', { streamer: 'TwitchStar' }));
    await expect(page.locator('#schedule-custom-premium')).toContainText(t('stream_alerts.schedule_custom_premium'));
    await expect(page.locator('#schedule-custom-fields')).toBeHidden();
    await expect(page.locator('#schedule-custom-save')).toBeHidden();
    await expect(page.locator('#schedule-custom-stored')).toBeHidden();

    await resetBot(withEntry({ custom_text: 'Mein Text', custom_image_hash: 'b'.repeat(64), image_source: 'banner' }, false));
    await openEditor(page);
    await expect(page.locator('#schedule-custom-stored')).toHaveText(t('stream_alerts.schedule_custom_stored_hint'));
    // Ohne Premium kein „Eigenes Bild“ in der Auswahl und kein „Eigener Text“ im Status
    await expect(scheduleRow(page, 11).locator('[data-schedule-image] option[value="custom"]')).toHaveCount(0);
    await expect(scheduleRow(page, 11).locator('[data-field="status"]')).toHaveText(t('stream_alerts.schedule_events', { count: 2 }));
    expect(await botCalls('stream_alerts/schedule-custom-image')).toHaveLength(0);   // Bild nur mit Premium laden
  });

  test('Button nur bei eingeschalteten Kanälen und neueren Bots', async ({ page }) => {
    const off = { ...SCHEDULE.entries[0], monitored_channel_id: 14, streamer_name: 'MaxStreams', enabled: false, active: false };
    const { custom_text: _, ...older } = { ...SCHEDULE.entries[0], monitored_channel_id: 15, streamer_name: 'Alt' };
    await resetBot({ 'stream_alerts/schedule': { data: { ...SCHEDULE, limit: 5, entries: [SCHEDULE.entries[0], off, older] } } });
    await page.goto(`${PAGE}#schedule`);
    await expect(customBtn(page, 11)).toHaveText(t('stream_alerts.schedule_custom_button'));
    await expect(customBtn(page, 11)).toBeVisible();
    await expect(customBtn(page, 14)).toBeHidden();
    await expect(customBtn(page, 15)).toBeHidden();
  });

  test('Text: Platzhalter einfügen, Zähler, Vorschau mit Beispielwerten, Speichern', async ({ page }) => {
    await resetBot(PREMIUM);
    await openEditor(page);
    await expect(textarea(page)).toHaveValue('');
    await expect(page.locator('#schedule-custom-count')).toHaveText('0/800');
    await expect(previewText(page)).toContainText('twitch.tv/twitchstar');
    await expect(previewText(page)).toContainText(t('stream_alerts.schedule_custom_default_source', { streamer: 'TwitchStar' }));
    await expect(imageNote(page)).toHaveText(t('stream_alerts.schedule_custom_preview_banner'));

    await textarea(page).fill('Heute **');
    await page.locator('[data-insert-placeholder="category"]').click();
    await textarea(page).press('End');
    await textarea(page).type('** {unbekannt} ');
    await page.locator('[data-insert-placeholder="link"]').click();
    await expect(textarea(page)).toHaveValue('Heute **{category}** {unbekannt} {link}');
    await expect(page.locator('#schedule-custom-count')).toHaveText('39/800');
    await expect(previewText(page).locator('strong')).toHaveText(t('stream_alerts.schedule_custom_sample_category'));
    await expect(previewText(page)).toContainText('{unbekannt} https://twitch.tv/twitchstar');   // wie der Bot

    await page.locator('#schedule-custom-save').click();
    const body = await waitForBotCall('stream_alerts/schedule-custom');
    expect(body).toMatchObject({ monitored_channel_id: '11', text: 'Heute **{category}** {unbekannt} {link}' });
    expect('image' in body).toBe(false);   // Bild unverändert
    await expect(form(page)).toBeHidden();
    await expect(scheduleRow(page, 11).locator('[data-field="status"]')).toHaveText(
      `${t('stream_alerts.schedule_events', { count: 2 })} · ${t('stream_alerts.schedule_custom_set')}`);
    await expect(textarea(page)).toHaveAttribute('maxlength', '800');
  });

  test('Bild: zuschneiden im Browser, Ausschnitt wählen, als JPEG speichern', async ({ page }) => {
    await resetBot(PREMIUM);
    await openEditor(page);
    await expect(page.locator('#schedule-custom-position-wrap')).toBeHidden();
    await page.locator('#schedule-custom-file').setInputFiles(await pngFile(page, 1200, 1200));
    await expect(page.locator('#schedule-custom-canvas')).toBeVisible();
    await expect(page.locator('#schedule-custom-position-wrap')).toBeVisible();   // quadratisch: Ausschnitt wählbar
    await expect(imageNote(page)).toBeHidden();
    // Ausschnitt: ganz oben nur Blau, ganz unten nur Rot (Mitte des Vorschaubildes)
    const centerColor = () => page.locator('#schedule-custom-canvas').evaluate((canvas: HTMLCanvasElement) => {
      const [r, , b] = canvas.getContext('2d')!.getImageData(800, 320, 1, 1).data;
      return r > b ? 'rot' : 'blau';
    });
    await page.locator('#schedule-custom-position').fill('100');
    await expect.poll(centerColor).toBe('rot');
    await page.locator('#schedule-custom-position').fill('0');
    await expect.poll(centerColor).toBe('blau');

    await page.locator('#schedule-custom-save').click();
    const body = await waitForBotCall('stream_alerts/schedule-custom');
    expect(body.image.startsWith('/9j/')).toBe(true);   // JPEG
    expect(body.image.length).toBeLessThan(900_000);     // klein genug für den Bot (höchstens 1 MiB pro Anfrage)
    const size = await page.evaluate(async (b64) => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/jpeg;base64,${b64}`)).blob());
      return [bitmap.width, bitmap.height];
    }, body.image);
    expect(size).toEqual([1600, 640]);   // doppelte Mindestgröße: scharf auf hochauflösenden Bildschirmen

    // Antwort: Quelle „Eigenes Bild“ gewählt
    const select = scheduleRow(page, 11).locator('[data-schedule-image]');
    await expect(select).toHaveValue('custom');
    await expect(select.locator('option[value="custom"]')).toHaveText(t('stream_alerts.schedule_image_custom'));
  });

  test('Bild mit viel Detail: Qualität sinkt, bis es unter die Grenze des Bots passt', async ({ page }) => {
    await resetBot(PREMIUM);
    await openEditor(page);
    // Rauschen ist für JPEG der schlimmste Fall — in bester Qualität deutlich über 1 MiB
    const base64 = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 1600;
      canvas.height = 640;
      const ctx = canvas.getContext('2d')!;
      const pixels = ctx.createImageData(1600, 640);
      for (let i = 0; i < pixels.data.length; i++) pixels.data[i] = i % 4 === 3 ? 255 : Math.floor(Math.random() * 256);
      ctx.putImageData(pixels, 0, 0);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    await page.locator('#schedule-custom-file').setInputFiles({ name: 'rauschen.png', mimeType: 'image/png', buffer: Buffer.from(base64, 'base64') });
    await expect(page.locator('#schedule-custom-canvas')).toBeVisible();
    await page.locator('#schedule-custom-save').click();
    const body = await waitForBotCall('stream_alerts/schedule-custom');
    expect(body.image.startsWith('/9j/')).toBe(true);
    expect(body.image.length).toBeLessThanOrEqual(900_000);
  });

  test('Bild im Seitenverhältnis 5:2: kein Ausschnitt nötig', async ({ page }) => {
    await resetBot(PREMIUM);
    await openEditor(page);
    await page.locator('#schedule-custom-file').setInputFiles(await pngFile(page, 1000, 400));
    await expect(page.locator('#schedule-custom-canvas')).toBeVisible();
    await expect(page.locator('#schedule-custom-position-wrap')).toBeHidden();
  });

  test('gespeichertes Bild: Vorschau, entfernen, rückgängig, entfernen und speichern', async ({ page }) => {
    await resetBot(withEntry({ custom_text: 'Gespeichert {title}', custom_image_hash: 'a'.repeat(64), image_source: 'custom' }));
    await openEditor(page);
    expect(await waitForBotCall('stream_alerts/schedule-custom-image')).toMatchObject({ monitored_channel_id: '11' });
    await expect(textarea(page)).toHaveValue('Gespeichert {title}');
    await expect(previewText(page)).toHaveText(`Gespeichert ${t('stream_alerts.schedule_custom_sample_title')}`);
    const stored = page.locator('#schedule-custom-stored-image');
    await expect(stored).toBeVisible();
    await expect(stored).toHaveAttribute('src', `data:image/jpeg;base64,${STORED_IMAGE}`);
    await expect(scheduleRow(page, 11).locator('[data-schedule-image]')).toHaveValue('custom');

    await page.locator('#schedule-custom-remove').click();
    await expect(stored).toBeHidden();
    await expect(imageNote(page)).toHaveText(t('stream_alerts.schedule_custom_preview_banner'));
    await page.locator('#schedule-custom-restore').click();
    await expect(stored).toBeVisible();
    await page.locator('#schedule-custom-remove').click();

    await page.locator('#schedule-custom-save').click();
    const body = await waitForBotCall('stream_alerts/schedule-custom');
    expect(body).toMatchObject({ monitored_channel_id: '11', text: 'Gespeichert {title}', image: null });
    await expect(scheduleRow(page, 11).locator('[data-schedule-image]')).toHaveValue('banner');
  });

  test('neues Bild verwerfen: das gespeicherte bleibt', async ({ page }) => {
    await resetBot(withEntry({ custom_image_hash: 'a'.repeat(64), image_source: 'custom' }));
    await openEditor(page);
    await page.locator('#schedule-custom-file').setInputFiles(await pngFile(page, 1000, 400));
    await expect(page.locator('#schedule-custom-canvas')).toBeVisible();
    await page.locator('#schedule-custom-remove').click();
    await expect(page.locator('#schedule-custom-canvas')).toBeHidden();
    await expect(page.locator('#schedule-custom-stored-image')).toBeVisible();
    await page.locator('#schedule-custom-save').click();
    expect('image' in await waitForBotCall('stream_alerts/schedule-custom')).toBe(false);
  });

  test('gespeichertes Bild nicht ladbar: Hinweis, Rest bleibt nutzbar', async ({ page }) => {
    await resetBot({ ...withEntry({ custom_image_hash: 'a'.repeat(64), image_source: 'custom' }),
      'stream_alerts/schedule-custom-image': { status: 500, error: 'internal_error' } });
    collectDialogs(page);
    await openEditor(page);
    await expect(imageNote(page)).toHaveText(t('stream_alerts.schedule_custom_err_image_load'));
    await expect(textarea(page)).toBeEditable();
  });

  test('falsche oder zu große Datei, Fehler des Bots: Meldung, Editor bleibt offen', async ({ page }) => {
    await resetBot({ ...PREMIUM, 'stream_alerts/schedule-custom': { status: 400, error: 'Das Bild ist zu groß – höchstens 2 MB.' } });
    const dialogs = collectDialogs(page);
    await openEditor(page);
    await page.locator('#schedule-custom-file').setInputFiles({ name: 'notiz.txt', mimeType: 'text/plain', buffer: Buffer.from('hallo') });
    await expect.poll(() => dialogs.join('\n')).toContain(t('stream_alerts.schedule_custom_err_file_type'));
    await page.locator('#schedule-custom-file').setInputFiles({ name: 'kaputt.png', mimeType: 'image/png', buffer: Buffer.from('kein Bild') });
    await expect.poll(() => dialogs.join('\n')).toContain(t('stream_alerts.schedule_custom_err_file_read'));
    await page.locator('#schedule-custom-file').setInputFiles({
      name: 'riesig.png', mimeType: 'image/png', buffer: Buffer.alloc(20 * 1024 * 1024 + 1),
    });
    await expect.poll(() => dialogs.join('\n')).toContain(t('stream_alerts.schedule_custom_err_file_size', { mb: 20 }));
    await expect(page.locator('#schedule-custom-canvas')).toBeHidden();

    await textarea(page).fill('Text');
    await page.locator('#schedule-custom-save').click();
    await expect.poll(() => dialogs.join('\n')).toContain('Das Bild ist zu groß – höchstens 2 MB.');
    await expect(form(page)).toBeVisible();
    await expect(textarea(page)).toHaveValue('Text');
    await expect(page.locator('#schedule-custom-save')).toBeEnabled();
  });

  test('Abbrechen schließt ohne Aufruf; Kanal ausgeschaltet schließt den Editor', async ({ page }) => {
    await resetBot(PREMIUM);
    await openEditor(page);
    await textarea(page).fill('verworfen');
    await page.locator('#schedule-custom-cancel').click();
    await expect(form(page)).toBeHidden();
    await customBtn(page).click();
    await expect(textarea(page)).toHaveValue('');   // aus der letzten Antwort, nicht der verworfene Text

    await scheduleSwitch(page, 11).click();
    await waitForBotCall('stream_alerts/schedule-toggle');
    await expect(form(page)).toBeHidden();
    expect(await botCalls('stream_alerts/schedule-custom')).toHaveLength(0);
  });

  test('Texte bleiben Text: Vorschau und Titel escaped', async ({ page }) => {
    await resetBot(withEntry({ streamer_name: `Star ${XSS}`, custom_text: `Hallo ${XSS} {streamer}` }));
    await openEditor(page);
    await expect(page.locator('#schedule-custom-title')).toContainText(`Star ${XSS}`);
    // __xss__ ist in Discord-Markdown Unterstreichung — entscheidend: als Text, nicht als HTML
    await expect(previewText(page)).toContainText('Hallo <img src=x onerror="window.');
    await expect(previewText(page).locator('img')).toHaveCount(0);
    await expectNoXss(page);
  });
});

test.describe('Navigation ohne Neuladen (ClientRouter)', () => {
  const sidebarLink = (page: Page, sub: string) => page.locator(`aside a[href="/server/${GUILD_ID}/${sub}"]`).first();

  test('mehrfach hin und zurück: Aktionen werden genau einmal gesendet', async ({ page }) => {
    collectDialogs(page);
    // Start in der Modul-Übersicht: nur dort ist das Untermenü mit dem Stream-Alerts-Link aufgeklappt
    await page.goto(guildPath('settings/'));
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => ((window as any).__noReload = true));
      await sidebarLink(page, 'stream-alerts/').click();
      await expect(addSubBtn(page)).toBeVisible();
      await sidebarLink(page, 'settings/').click();
      await expect(page).toHaveURL(new RegExp(`/server/${GUILD_ID}/settings/$`));
    }
    await sidebarLink(page, 'stream-alerts/').click();
    await expect(addSubBtn(page)).toBeVisible();
    expect(await page.evaluate(() => (window as any).__noReload)).toBe(true);

    await linkRow(page, 7).locator('[data-remove-link]').click();
    await waitForBotCall('stream_alerts/delete-link');
    await subRow(page, 11).locator('[data-remove-sub]').click();
    await waitForBotCall('stream_alerts/remove');
    await page.waitForTimeout(500); // etwaige doppelte Aufrufe abwarten
    expect(await botCalls('stream_alerts/remove')).toHaveLength(1);
    expect(await botCalls('stream_alerts/delete-link')).toHaveLength(1);

    await page.locator('#tab-schedule').click();
    await scheduleSwitch(page, 11).click();
    await waitForBotCall('stream_alerts/schedule-toggle');
    await page.waitForTimeout(500);
    expect(await botCalls('stream_alerts/schedule-toggle')).toHaveLength(1);
  });
});

test.describe('Eingaben vor dem Verdrahten der Seite', () => {
  // Auf langsamen Rechnern (z. B. im CI) kann man Felder ändern, bevor astro:page-load die Seite verdrahtet hat.
  // Das Ereignis der Änderung geht dann ins Leere — Speichern muss trotzdem möglich sein.
  test.beforeEach(async ({ page }) => { await delayPageWiring(page); });

  test('Ping-Rolle vor dem Verdrahten geändert: Speichern wird aktiv', async ({ page }) => {
    await page.goto(PAGE);
    await page.locator('[data-ping-role="all"]').selectOption(ROLES[1].id);
    await expectNotWiredYet(page);
    await savePingBtn(page).click();
    expect(await waitForBotCall('stream_alerts/set-ping-role')).toMatchObject({ platform: 'all', role_id: ROLES[1].id });
  });
});
