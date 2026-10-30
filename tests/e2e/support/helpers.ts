import fs from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { expect, type BrowserContext, type Page } from '@playwright/test';
import { APP_URL, BOT_URL, DB, GUILD_ID, SESSION_ID, USER_ID } from './env.mjs';

type BotCall = { key: string; body: any };
type Override = { status?: number; error: string } | { data: unknown };

/** Deutsche Texte aus der echten Übersetzungsdatei — Tests bleiben bei Textänderungen grün */
const de = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../../../src/i18n/de.json'), 'utf-8'));
export function t(key: string, vars: Record<string, string | number> = {}): string {
  const value = key.split('.').reduce((obj: any, part) => obj?.[part], de);
  if (typeof value !== 'string') throw new Error(`Übersetzung fehlt: ${key}`);
  return value.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? `{${name}}`));
}

export async function login(context: BrowserContext) {
  await context.addCookies([{ name: 'nexus_session_id', value: SESSION_ID, url: APP_URL }]);
}

/** Setzt den Fake-Bot zurück; einzelne Aktionen können eine eigene Antwort oder einen Fehler bekommen */
export async function resetBot(overrides: Record<string, Override> = {}) {
  const res = await fetch(`${BOT_URL}/__test/reset`, { method: 'POST', body: JSON.stringify({ overrides }) });
  expect(res.ok).toBe(true);
}

export async function botCalls(key?: string): Promise<BotCall[]> {
  const calls: BotCall[] = await (await fetch(`${BOT_URL}/__test/calls`)).json();
  return key ? calls.filter((c) => c.key === key) : calls;
}

/** Wartet, bis der Bot genau diesen Aufruf bekommen hat, und gibt dessen Body zurück */
export async function waitForBotCall(key: string, index = 0): Promise<any> {
  await expect.poll(async () => (await botCalls(key)).length, { message: `Bot-Aufruf ${key}` }).toBeGreaterThan(index);
  const body = (await botCalls(key))[index].body;
  // Jeder Aufruf muss den eingeloggten User und den Server mitbringen — sonst lehnt der echte Bot ab
  expect(body.acting_user_id).toBe(USER_ID);
  expect(body.guild_id).toBe(GUILD_ID);
  return body;
}

/** Sammelt alle alert/confirm-Texte; confirm wird bestätigt (oder abgelehnt, wenn accept=false) */
export function collectDialogs(page: Page, { accept = true } = {}) {
  const messages: string[] = [];
  page.on('dialog', async (dialog) => {
    messages.push(dialog.message());
    if (dialog.type() === 'confirm' && !accept) await dialog.dismiss();
    else await dialog.accept();
  });
  return messages;
}

export const guildPath = (sub: string) => `/server/${GUILD_ID}/${sub}`;

/** Direkter Zugriff auf die Test-DB — für Seiten, die (wie Settings) selbst aus der DB lesen */
export async function dbQuery(sql: string, params: unknown[] = []) {
  const conn = await mysql.createConnection(DB);
  try {
    await conn.query(sql, params);
  } finally {
    await conn.end();
  }
}
