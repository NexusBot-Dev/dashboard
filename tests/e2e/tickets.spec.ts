import { test, expect, type Page } from '@playwright/test';
import { login, resetBot, waitForBotCall, botCalls, collectDialogs, guildPath, t } from './support/helpers';
import { CHANNELS, ROLES } from './support/fixtures.mjs';
import { FOREIGN_GUILD_ID, GUILD_ID, USER_ID } from './support/env.mjs';

// Diese Tests prüfen nur, was der Nutzer sieht und was beim Bot ankommt — nicht, wie der
// Seiten-Code intern aufgebaut ist. So bleiben sie beim Umbau der Skripte unverändert gültig.

test.beforeEach(async ({ context }) => {
  await resetBot();
  await login(context);
});

const openTab = (page: Page, key: string) => page.getByRole('tab', { name: t(`tickets.tab_${key}`) }).click();

test.describe('Übersicht & Navigation', () => {
  test('zeigt offene Tickets mit Status', async ({ page }) => {
    await page.goto(guildPath('tickets/'));
    const overview = page.locator('#tab-panel-overview');
    await expect(overview.getByText('Max Mustermann')).toBeVisible();
    await expect(overview.getByText('Erika')).toBeVisible();
    await expect(overview.getByText(t('tickets.status_pending_closure'))).toBeVisible();
  });

  test('Tabs wechseln und sind per Hash direkt ansteuerbar', async ({ page }) => {
    await page.goto(guildPath('tickets/'));
    await openTab(page, 'categories');
    await expect(page).toHaveURL(/#categories$/);
    await expect(page.locator('#tab-panel-categories')).toBeVisible();
    await expect(page.locator('#tab-panel-overview')).toBeHidden();

    // Von einer anderen Seite kommend (wie ein Link aus der Übersicht). Ein reiner Hash-Wechsel auf
    // derselben Seite schaltet den Tab nicht um — dafür gibt es aktuell aber auch keine Links.
    await page.goto(guildPath(''));
    await page.goto(guildPath('tickets/#settings'));
    await expect(page.locator('#tab-panel-settings')).toBeVisible();
  });

  test('alte Modul-URL leitet auf die neue Seite um', async ({ page }) => {
    await page.goto(guildPath('modules/tickets/'));
    await expect(page).toHaveURL(new RegExp(`/server/${GUILD_ID}/tickets/$`));
  });

  test('fremder Server ohne Rechte ist nicht erreichbar', async ({ page }) => {
    await page.goto(`/server/${FOREIGN_GUILD_ID}/tickets/`);
    await expect(page).not.toHaveURL(new RegExp(FOREIGN_GUILD_ID));
  });

  test('ohne Bot-Daten erscheint der Offline-Hinweis', async ({ page }) => {
    await resetBot({ 'tickets/get-settings': { status: 500, error: 'internal_error' } });
    await page.goto(guildPath('tickets/'));
    await expect(page.getByText(t('common.bot_offline'))).toBeVisible();
  });
});

test.describe('Navigation ohne Neuladen (ClientRouter)', () => {
  // Nutzer kommen meist über die Sidebar, nicht per Direktaufruf. Der ClientRouter tauscht die
  // Seite dann aus, ohne neu zu laden — die Seitenlogik muss trotzdem korrekt verdrahtet werden.
  const ticketsLink = (page: Page) => page.locator(`aside a[href="/server/${GUILD_ID}/tickets/"]`).first();

  async function navigateToTickets(page: Page) {
    await page.evaluate(() => ((window as any).__noReload = true));
    await ticketsLink(page).click();
    await expect(page).toHaveURL(new RegExp(`/server/${GUILD_ID}/tickets/`));
    await expect(page.locator('#tickets-tabs')).toBeVisible();
    // Marker überlebt nur, wenn wirklich nicht neu geladen wurde — sonst testet der Test das Falsche
    expect(await page.evaluate(() => (window as any).__noReload)).toBe(true);
  }

  test('über die Sidebar geöffnet funktionieren Tabs und Aktionen', async ({ page }) => {
    await page.goto(guildPath(''));
    await navigateToTickets(page);

    await openTab(page, 'settings');
    await expect(page.locator('#tab-panel-settings')).toBeVisible();
    await page.locator('#closure-select').selectOption('12');
    await page.locator('#save-timeouts-btn').click();
    expect(await waitForBotCall('tickets/set-timeouts')).toMatchObject({ closure_timeout_hours: 12 });
  });

  test('mehrfach hin und zurück: jede Aktion wird genau einmal gesendet', async ({ page }) => {
    collectDialogs(page);
    await page.goto(guildPath(''));
    for (let i = 0; i < 3; i++) {
      await navigateToTickets(page);
      await page.locator(`aside a[href="/server/${GUILD_ID}/"]`).first().click();
      await expect(page).toHaveURL(new RegExp(`/server/${GUILD_ID}/$`));
    }
    await navigateToTickets(page);
    await openTab(page, 'categories');
    await page.locator('[data-remove-category="1"]').click();

    await waitForBotCall('tickets/delete-category');
    await page.waitForTimeout(500); // etwaige doppelte Aufrufe abwarten
    expect(await botCalls('tickets/delete-category')).toHaveLength(1);
  });
});

test.describe('Panel', () => {
  test('Markdown-Vorschau rendert Formatierung und escaped HTML', async ({ page }) => {
    await page.goto(guildPath('tickets/#panel'));
    await page.locator('#tickets-textarea').fill('**fett** <img src=x onerror="window.__xss=1">');
    const preview = page.locator('#tickets-preview');
    await expect(preview.locator('strong')).toHaveText('fett');
    await expect(preview.locator('img')).toHaveCount(0);
    await expect(preview).toContainText('<img src=x');
    expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();
  });

  test('bestehendes Panel speichern schickt Titel, Text und Channel', async ({ page }) => {
    const dialogs = collectDialogs(page);
    await page.goto(guildPath('tickets/#panel'));
    await page.locator('#panel-title-input').fill('Hilfe');
    await page.locator('#tickets-textarea').fill('Schreib uns!');
    await page.locator('#post-panel-btn').click();

    const body = await waitForBotCall('tickets/post-panel');
    expect(body).toMatchObject({ title: 'Hilfe', description: 'Schreib uns!', channel_id: CHANNELS[0].id });
    await expect.poll(() => dialogs).toContain(t('tickets.alert_panel_updated'));
  });

  test('Panel in anderen Channel verschieben fragt vorher nach', async ({ page }) => {
    const dialogs = collectDialogs(page, { accept: false });
    await page.goto(guildPath('tickets/#panel'));
    await page.locator('#panel-channel-select').selectOption(CHANNELS[1].id);
    await page.locator('#post-panel-btn').click();

    await expect.poll(() => dialogs.length).toBe(1);
    expect(dialogs[0]).toContain(CHANNELS[1].name);
    expect(await botCalls('tickets/post-panel')).toHaveLength(0); // abgelehnt → nichts gesendet
  });

  test('Fehlermeldung des Bots wird angezeigt (nicht "bot unreachable")', async ({ page }) => {
    await resetBot({ 'tickets/post-panel': { status: 400, error: 'Dem Bot fehlen Rechte im Channel' } });
    const dialogs = collectDialogs(page);
    await page.goto(guildPath('tickets/#panel'));
    await page.locator('#post-panel-btn').click();

    await expect.poll(() => dialogs.join('\n')).toContain('Dem Bot fehlen Rechte im Channel');
    expect(dialogs.join('\n')).not.toContain('bot_unreachable');
  });

  test('altes Panel per Nachrichtenlink übernehmen', async ({ page }) => {
    collectDialogs(page);
    const link = `https://discord.com/channels/${GUILD_ID}/${CHANNELS[0].id}/900000000000000003`;
    await page.goto(guildPath('tickets/#panel'));
    await page.locator('#import-panel-input').fill(link);
    await page.locator('#import-panel-btn').click();

    expect(await waitForBotCall('tickets/import-panel')).toMatchObject({ link });
  });
});

test.describe('Kategorien', () => {
  test('neue Kategorie mit Rolle anlegen', async ({ page }) => {
    await page.goto(guildPath('tickets/#categories'));
    await page.locator('#add-category-btn').click();
    await page.locator('#category-name-input').fill('Bewerbungen');
    await page.locator(`[data-role-checkbox][value="${ROLES[1].id}"]`).check();
    await page.locator('#confirm-category-btn').click();

    expect(await waitForBotCall('tickets/create-category')).toMatchObject({ name: 'Bewerbungen', role_ids: [ROLES[1].id] });
  });

  test('Kategorie bearbeiten: Formular ist vorbefüllt, Umbenennen und Rollen werden gespeichert', async ({ page }) => {
    await page.goto(guildPath('tickets/#categories'));
    await page.locator('[data-edit-category="1"]').click();
    await expect(page.locator('#category-name-input')).toHaveValue('Allgemein');
    await expect(page.locator(`[data-role-checkbox][value="${ROLES[0].id}"]`)).toBeChecked();

    await page.locator('#category-name-input').fill('Support');
    await page.locator('#confirm-category-btn').click();

    expect(await waitForBotCall('tickets/rename-category')).toMatchObject({ category_id: 1, name: 'Support' });
    expect(await waitForBotCall('tickets/set-category-roles')).toMatchObject({ category_id: 1, role_ids: [ROLES[0].id] });
  });

  test('nur Rollen ändern benennt nicht um', async ({ page }) => {
    await page.goto(guildPath('tickets/#categories'));
    await page.locator('[data-edit-category="1"]').click();
    await page.locator(`[data-role-checkbox][value="${ROLES[1].id}"]`).check();
    await page.locator('#confirm-category-btn').click();

    expect(await waitForBotCall('tickets/set-category-roles')).toMatchObject({ role_ids: [ROLES[0].id, ROLES[1].id] });
    expect(await botCalls('tickets/rename-category')).toHaveLength(0);
  });

  test('Kategorie löschen nach Bestätigung', async ({ page }) => {
    collectDialogs(page);
    await page.goto(guildPath('tickets/#categories'));
    await page.locator('[data-remove-category="1"]').click();

    expect(await waitForBotCall('tickets/delete-category')).toMatchObject({ category_id: 1 });
  });
});

test.describe('Einstellungen', () => {
  test('Fristen: nur der geänderte Wert wird geschickt', async ({ page }) => {
    await page.goto(guildPath('tickets/#settings'));
    const save = page.locator('#save-timeouts-btn');
    await expect(save).toBeDisabled();

    await page.locator('#closure-select').selectOption('48');
    await expect(save).toBeEnabled();
    await save.click();

    const body = await waitForBotCall('tickets/set-timeouts');
    expect(body.closure_timeout_hours).toBe(48);
    expect(body).not.toHaveProperty('deletion_delay_hours');
  });

  test('Ticket-Log-Channel wird über die Settings-API gespeichert', async ({ page }) => {
    await page.goto(guildPath('tickets/#settings'));
    await page.locator('#log-channel-select').selectOption(CHANNELS[1].id);
    await page.locator('#save-log-channel-btn').click();

    expect((await waitForBotCall('settings')).fields).toEqual({ ticket_log_channel_id: CHANNELS[1].id });
  });
});

test.describe('API-Proxy', () => {
  test('Browser kann acting_user_id und guild_id nicht überschreiben', async ({ page }) => {
    await page.goto(guildPath('tickets/'));
    const res = await page.request.post(`/api/server/${GUILD_ID}/module/tickets/set-timeouts/`, {
      data: { acting_user_id: '666', guild_id: FOREIGN_GUILD_ID, closure_timeout_hours: 12 },
    });
    expect(res.ok()).toBe(true);

    const body = (await botCalls('tickets/set-timeouts'))[0].body;
    expect(body.acting_user_id).toBe(USER_ID);
    expect(body.guild_id).toBe(GUILD_ID);
  });
});
