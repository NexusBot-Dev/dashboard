import type { Page } from '@playwright/test';
import { guildPath } from './helpers';
import { GUILD_ID } from './env.mjs';

// Wo auf der Seite liegt was? Die Tests für Welcome, Goodbye und Boosts sprechen nur über diese
// Helfer mit der Seite. Beim Zusammenlegen zu einer Seite mit Tabs ändert sich nur diese Datei —
// die Tests selbst (was angezeigt wird, was beim Bot ankommt) bleiben unverändert.

export type MessageArea = 'welcome' | 'boosts';

const PAGES: Record<MessageArea | 'goodbye', string> = {
  welcome: 'modules/welcome/',
  goodbye: 'modules/welcome/',
  boosts: 'modules/boosts/',
};

/** URL des Bereichs (relativ zum Server) — für Direktaufrufe und Navigationstests */
export const areaPath = (area: MessageArea | 'goodbye') => guildPath(PAGES[area]);

/** Öffnet den Bereich über die Sidebar, ohne Neuladen (ClientRouter) — Start auf einer Modul-Seite */
export async function navigateToArea(page: Page, area: MessageArea | 'goodbye') {
  await page.locator(`aside a[href="/server/${GUILD_ID}/${PAGES[area]}"]`).first().click();
}

/** Öffnet die Seite des Bereichs per Direktaufruf */
export async function openArea(page: Page, area: MessageArea | 'goodbye') {
  await page.goto(areaPath(area));
}

/** Nachrichtenliste mit Formular (Welcome- bzw. Boost-Nachrichten) */
export function messageEditor(page: Page, _area: MessageArea) {
  return {
    root: page.locator('section', { has: page.locator('#messages-list') }),
    list: page.locator('#messages-list'),
    row: (id: number | string) => page.locator(`[data-message-row="${id}"]`),
    rows: page.locator('[data-message-row]'),
    addBtn: page.locator('#add-message-btn'),
    form: page.locator('#message-form'),
    formTitle: page.locator('#message-form-title'),
    textarea: page.locator('#message-textarea'),
    preview: page.locator('#message-preview'),
    toolbar: page.locator('[data-md-toolbar="message-textarea"]'),
    confirmBtn: page.locator('#confirm-message-btn'),
    cancelBtn: page.locator('#cancel-message-btn'),
  };
}

/** Channel-Auswahl mit eigenem Speichern-Button */
export function channelPicker(page: Page, area: MessageArea) {
  return area === 'welcome'
    ? { select: page.locator('#welcome-channel-select'), saveBtn: page.locator('#save-welcome-channel-btn') }
    : { select: page.locator('#boost-channel-select'), saveBtn: page.locator('#save-boost-channel-btn') };
}

export function goodbye(page: Page) {
  return {
    toggle: page.locator('#goodbye-toggle'),
    select: page.locator('#goodbye-channel-select'),
    saveBtn: page.locator('#save-goodbye-btn'),
  };
}
