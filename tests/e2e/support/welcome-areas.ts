import { expect, type Page } from '@playwright/test';
import { guildPath, t } from './helpers';
import { GUILD_ID } from './env.mjs';

// Wo auf der Seite liegt was? Die Tests für Welcome, Goodbye und Boosts sprechen nur über diese
// Helfer mit der Seite. Beim Zusammenlegen zu einer Seite mit Tabs hat sich nur diese Datei geändert —
// die Tests selbst (was angezeigt wird, was beim Bot ankommt) sind gleich geblieben.

export type MessageArea = 'welcome' | 'boosts';

const PAGE = 'modules/welcome/';
const TAB_LABELS = { welcome: 'welcome.title', goodbye: 'welcome.goodbye_title', boosts: 'boost.title' } as const;

/** URL des Bereichs (relativ zum Server) — der Tab steckt im #hash */
export const areaPath = (area: MessageArea | 'goodbye') => guildPath(`${PAGE}#${area}`);

/** Öffnet den Bereich über die Sidebar und den Tab, ohne Neuladen (ClientRouter) — Start auf einer Modul-Seite */
export async function navigateToArea(page: Page, area: MessageArea | 'goodbye') {
  await page.locator(`aside a[href="/server/${GUILD_ID}/${PAGE}"]`).first().click();
  await expect(page.locator('#welcome-page')).toBeVisible();
  await page.getByRole('tab', { name: t(TAB_LABELS[area]) }).click();
}

/** Öffnet die Seite des Bereichs per Direktaufruf */
export async function openArea(page: Page, area: MessageArea | 'goodbye') {
  await page.goto(areaPath(area));
}

/** Nachrichtenliste mit Formular (Welcome- bzw. Boost-Nachrichten) */
export function messageEditor(page: Page, area: MessageArea) {
  const root = page.locator(`[data-message-editor="${area}"]`);
  const role = (name: string) => root.locator(`[data-role="${name}"]`);
  return {
    root,
    list: role('list'),
    row: (id: number | string) => root.locator(`[data-message-row="${id}"]`),
    rows: root.locator('[data-message-row]'),
    addBtn: role('add'),
    form: role('form'),
    formTitle: role('form-title'),
    textarea: role('textarea'),
    preview: role('preview'),
    toolbar: root.locator('[data-md-toolbar]'),
    confirmBtn: role('confirm'),
    cancelBtn: role('cancel'),
  };
}

/** Channel-Auswahl mit eigenem Speichern-Button */
export function channelPicker(page: Page, area: MessageArea) {
  const root = page.locator(`[data-channel-setting="${area === 'welcome' ? 'welcome_channel_id' : 'boost_channel_id'}"]`);
  return { select: root.locator('select'), saveBtn: root.locator('[data-role="save"]') };
}

export function goodbye(page: Page) {
  return {
    toggle: page.locator('#goodbye-toggle'),
    select: page.locator('#goodbye-channel-select'),
    saveBtn: page.locator('#save-goodbye-btn'),
  };
}
