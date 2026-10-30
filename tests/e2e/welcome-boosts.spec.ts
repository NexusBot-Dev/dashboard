import { test, expect, type Page } from '@playwright/test';
import { login, resetBot, waitForBotCall, botCalls, collectDialogs, guildPath, t, dbQuery } from './support/helpers';
import { CHANNELS } from './support/fixtures.mjs';
import { GUILD_ID } from './support/env.mjs';
import { channelPicker, goodbye, messageEditor, navigateToArea, openArea, type MessageArea } from './support/welcome-areas';

// Welcome-, Goodbye- und Boost-Einstellungen. Die Seitenstruktur steckt in support/welcome-areas.ts,
// damit diese Tests das Zusammenlegen der Seiten (Tabs) unverändert überstehen.

const XSS = '<img src=x onerror="window.__xss=1">';
const PREVIEW_USER = '@Test User'; // global_name der Test-Session

const AREAS: { area: MessageArea; module: string; channelField: string; placeholderValue: string }[] = [
  { area: 'welcome', module: 'welcome', channelField: 'welcome_channel_id', placeholderValue: '1.284' }, // {membercount} (Beispielwert)
  { area: 'boosts', module: 'boosts', channelField: 'boost_channel_id', placeholderValue: '3' },          // {count} = boost_count
];

async function setChannels(values: Record<string, unknown> = {}) {
  const row = {
    welcome_channel_id: CHANNELS[0].id, goodbye_channel_id: CHANNELS[0].id, goodbye_enabled: 0,
    boost_channel_id: CHANNELS[0].id, ...values,
  };
  await dbQuery(
    `UPDATE guild_settings SET ${Object.keys(row).map((c) => `${c} = ?`).join(', ')} WHERE guild_id = ?`,
    [...Object.values(row), GUILD_ID]
  );
}

const expectNoXss = async (page: Page) => expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();

test.beforeEach(async ({ context }) => {
  await resetBot();
  await setChannels();
  await login(context);
});

test.afterAll(async () => {
  await setChannels({ welcome_channel_id: null, goodbye_channel_id: null, boost_channel_id: null });
});

for (const { area, module, channelField, placeholderValue } of AREAS) {
  test.describe(`${area}: Nachrichten`, () => {
    test('zeigt Nachrichten mit Vorschau (Platzhalter ersetzt, HTML escaped)', async ({ page }) => {
      await openArea(page, area);
      const ed = messageEditor(page, area);
      const row = ed.row(1);
      await expect(row.locator('[data-message-text]')).toContainText('{user}'); // Rohtext
      const preview = row.locator('[data-message-preview]');
      await expect(preview).toContainText(PREVIEW_USER);
      await expect(preview).toContainText(placeholderValue);
      await expect(preview.locator('strong')).toHaveText('Testserver');
      await expect(preview.locator('b')).toHaveCount(0);
      await expect(preview).toContainText('<b>');
      await expect(ed.root).toContainText(t(`${area === 'welcome' ? 'welcome' : 'boost'}.messages_count`, { count: 1, limit: 2 }));
    });

    test('Nachricht hinzufügen: Live-Vorschau, Payload, neue Zeile', async ({ page }) => {
      await openArea(page, area);
      const ed = messageEditor(page, area);
      await ed.addBtn.click();
      await expect(ed.form).toBeVisible();
      await ed.textarea.fill(`**neu** {user} ${XSS}`);
      await expect(ed.preview.locator('strong')).toHaveText('neu');
      await expect(ed.preview).toContainText(PREVIEW_USER);
      await expect(ed.preview.locator('img')).toHaveCount(0);
      await ed.confirmBtn.click();

      expect(await waitForBotCall(`${module}/add-message`)).toMatchObject({ message: `**neu** {user} ${XSS}` });
      await expect(ed.row(9).locator('[data-message-text]')).toHaveText(`**neu** {user} ${XSS}`);
      await expect(ed.row(9).locator('[data-message-preview] strong')).toHaveText('neu');
      await expect(ed.form).toBeHidden();
      await expectNoXss(page);
    });

    test('Toolbar formatiert die Auswahl', async ({ page }) => {
      await openArea(page, area);
      const ed = messageEditor(page, area);
      await ed.addBtn.click();
      await ed.textarea.fill('fett');
      await ed.textarea.selectText();
      await ed.toolbar.locator('[data-md="bold"]').click();
      await expect(ed.textarea).toHaveValue('**fett**');
    });

    test('Nachricht bearbeiten: Formular vorbefüllt, Zeile aktualisiert', async ({ page }) => {
      await openArea(page, area);
      const ed = messageEditor(page, area);
      const original = await ed.row(1).locator('[data-message-text]').textContent();
      await ed.row(1).locator('[data-edit-message]').click();
      await expect(ed.textarea).toHaveValue(original!);
      await ed.textarea.fill('Geändert {user}');
      await ed.confirmBtn.click();

      const body = await waitForBotCall(`${module}/edit-message`);
      expect(String(body.message_id)).toBe('1');
      expect(body.message).toBe('Geändert {user}');
      await expect(ed.row(1).locator('[data-message-text]')).toHaveText('Geändert {user}');
      await expect(ed.row(1).locator('[data-message-preview]')).toContainText(`Geändert ${PREVIEW_USER}`);
      expect(await botCalls(`${module}/add-message`)).toHaveLength(0);
    });

    test('Nachricht löschen: abgelehnt passiert nichts, bestätigt wird sie entfernt', async ({ page }) => {
      const dialogs = collectDialogs(page, { accept: false });
      await openArea(page, area);
      const ed = messageEditor(page, area);
      await ed.row(1).locator('[data-remove-message]').click();
      await expect.poll(() => dialogs).toContain(t('boost.confirm_delete_message'));
      expect(await botCalls(`${module}/delete-message`)).toHaveLength(0);

      page.removeAllListeners('dialog');
      collectDialogs(page);
      await ed.row(1).locator('[data-remove-message]').click();
      expect(String((await waitForBotCall(`${module}/delete-message`)).message_id)).toBe('1');
      await expect(ed.row(1)).toHaveCount(0);
    });

    test('leere Nachricht wird abgelehnt, ohne den Bot zu fragen', async ({ page }) => {
      const dialogs = collectDialogs(page);
      await openArea(page, area);
      const ed = messageEditor(page, area);
      await ed.addBtn.click();
      await ed.confirmBtn.click();
      await expect.poll(() => dialogs).toContain(t('boost.alert_message_required'));
      expect(await botCalls(`${module}/add-message`)).toHaveLength(0);
    });

    test('Fehler des Bots wird angezeigt, Formular bleibt offen', async ({ page }) => {
      await resetBot({ [`${module}/add-message`]: { status: 400, error: 'Limit erreicht (2 Nachrichten)' } });
      const dialogs = collectDialogs(page);
      await openArea(page, area);
      const ed = messageEditor(page, area);
      await ed.addBtn.click();
      await ed.textarea.fill('Hallo');
      await ed.confirmBtn.click();
      await expect.poll(() => dialogs.join('\n')).toContain('Limit erreicht (2 Nachrichten)');
      await expect(ed.form).toBeVisible();
      await expect(ed.confirmBtn).toBeEnabled();
    });

    test('Limit: nach Erreichen ist Hinzufügen gesperrt', async ({ page }) => {
      test.fail(area === 'boosts', 'Bekannter Bug: Boosts sperrt den Button nach dem Hinzufügen nicht');
      await openArea(page, area);
      const ed = messageEditor(page, area);
      await expect(ed.addBtn).toBeEnabled();
      await ed.addBtn.click();
      await ed.textarea.fill('Zweite');
      await ed.confirmBtn.click();
      await waitForBotCall(`${module}/add-message`);
      await expect(ed.rows).toHaveCount(2);
      await expect(ed.addBtn).toBeDisabled();
    });

    test('Limit: nach dem Löschen ist Hinzufügen wieder möglich', async ({ page }) => {
      test.fail(true, 'Bekannter Bug: der Button bleibt gesperrt, bis die Seite neu geladen wird');
      const full = { messages: [{ id: 1, message: 'Eins' }, { id: 2, message: 'Zwei' }], limit_free: 2, limit_premium: 5 };
      await resetBot({ [`${module}/list`]: { data: full } });
      collectDialogs(page);
      await openArea(page, area);
      const ed = messageEditor(page, area);
      await expect(ed.addBtn).toBeDisabled();
      await ed.row(2).locator('[data-remove-message]').click();
      await waitForBotCall(`${module}/delete-message`);
      await expect(ed.row(2)).toHaveCount(0);
      await expect(ed.addBtn).toBeEnabled();
    });

    test('ohne Bot-Daten erscheint der Offline-Hinweis und Hinzufügen ist gesperrt', async ({ page }) => {
      await resetBot({ [`${module}/list`]: { status: 500, error: 'internal_error' } });
      await openArea(page, area);
      await expect(page.getByText(t('common.bot_offline'))).toBeVisible();
      await expect(messageEditor(page, area).addBtn).toBeDisabled();
    });
  });

  test.describe(`${area}: Channel`, () => {
    test('Channel speichern schickt nur dieses Feld', async ({ page }) => {
      await openArea(page, area);
      const { select, saveBtn } = channelPicker(page, area);
      await expect(select).toHaveValue(CHANNELS[0].id);
      await expect(saveBtn).toBeDisabled();
      await select.selectOption(CHANNELS[1].id);
      await expect(saveBtn).toBeEnabled();
      await saveBtn.click();

      expect((await waitForBotCall('settings')).fields).toEqual({ [channelField]: CHANNELS[1].id });
      await expect(saveBtn).toBeDisabled();
    });
  });
}

test.describe('welcome: Channel', () => {
  test('Welcome-Channel lässt sich abwählen', async ({ page }) => {
    test.fail(true, 'Bekannter Bug: keine Option „Kein Channel“');
    await openArea(page, 'welcome');
    const { select, saveBtn } = channelPicker(page, 'welcome');
    await expect(select.locator('option[value=""]')).toHaveCount(1);
    await select.selectOption('');
    await saveBtn.click();
    expect((await waitForBotCall('settings')).fields).toEqual({ welcome_channel_id: '' });
  });
});

test.describe('goodbye', () => {
  test('Einschalten speichert Schalter und Channel', async ({ page }) => {
    await openArea(page, 'goodbye');
    const gb = goodbye(page);
    await expect(gb.toggle).toHaveAttribute('aria-checked', 'false');
    await expect(gb.saveBtn).toBeDisabled();
    await gb.toggle.click();
    await gb.select.selectOption(CHANNELS[1].id);
    await gb.saveBtn.click();

    expect((await waitForBotCall('settings')).fields).toEqual({ goodbye_enabled: true, goodbye_channel_id: CHANNELS[1].id });
    await expect(gb.saveBtn).toBeDisabled();
  });

  test('Zurückschalten ohne Speichern sperrt den Button wieder', async ({ page }) => {
    await openArea(page, 'goodbye');
    const gb = goodbye(page);
    await gb.toggle.click();
    await expect(gb.saveBtn).toBeEnabled();
    await gb.toggle.click();
    await expect(gb.saveBtn).toBeDisabled();
  });

  test('ohne gesetzten Goodbye-Channel wird kein Channel still mitgespeichert', async ({ page }) => {
    test.fail(true, 'Bekannter Bug: ohne „Kein Channel“-Option zeigt die Auswahl den ersten Channel und speichert ihn mit');
    await setChannels({ goodbye_channel_id: null });
    await openArea(page, 'goodbye');
    const gb = goodbye(page);
    await expect(gb.select).toHaveValue('');
  });
});

test.describe('boosts: Status', () => {
  test('zeigt Anzahl der Boosts und Server-Level', async ({ page }) => {
    await openArea(page, 'boosts');
    await expect(page.getByText(`3 ${t('boost.boost_plural')}`)).toBeVisible();
    await expect(page.getByText(t('boost.server_level', { tier: 1 }))).toBeVisible();
  });
});

test.describe('Navigation ohne Neuladen (ClientRouter)', () => {
  for (const { area, module } of AREAS) {
    test(`${area}: mehrfach hin und zurück, Hinzufügen wird genau einmal gesendet`, async ({ page }) => {
      await page.goto(guildPath('modules/'));
      for (let i = 0; i < 3; i++) {
        await page.evaluate(() => ((window as any).__noReload = true));
        await navigateToArea(page, area);
        await expect(messageEditor(page, area).addBtn).toBeVisible();
        await page.locator(`aside a[href="/server/${GUILD_ID}/modules/"]`).first().click();
        await expect(page).toHaveURL(new RegExp(`/server/${GUILD_ID}/modules/$`));
      }
      await navigateToArea(page, area);
      expect(await page.evaluate(() => (window as any).__noReload)).toBe(true);

      const ed = messageEditor(page, area);
      await ed.addBtn.click();
      await ed.textarea.fill('Einmal');
      await expect(ed.preview).toHaveText('Einmal');
      await ed.confirmBtn.click();
      await waitForBotCall(`${module}/add-message`);
      await page.waitForTimeout(500); // etwaige doppelte Aufrufe abwarten
      expect(await botCalls(`${module}/add-message`)).toHaveLength(1);
    });
  }
});
