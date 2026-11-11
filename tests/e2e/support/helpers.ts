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

export const SESSION_COOKIE = '__Host-nexus_session_id';

export async function login(context: BrowserContext, sessionId = SESSION_ID) {
  // __Host- verlangt Secure und Path=/; mit `url` statt domain/path lässt Chromium das nicht zu
  await context.addCookies([{ name: SESSION_COOKIE, value: sessionId, domain: new URL(APP_URL).hostname, path: '/', secure: true }]);
}

/** POST wie von unseren eigenen Seiten: echtes fetch im Browser, mit Origin und Sec-Fetch-Site */
export async function browserPost(page: Page, url: string, body: unknown): Promise<{ status: number; json: any }> {
  return page.evaluate(async ({ url, body }) => {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, json: await res.json() };
  }, { url, body });
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
  // ...und die Dashboard-Sprache (Browser in den Tests: de-DE) — sonst antwortet der Bot in der Server-Sprache
  expect(body.lang).toBe('de');
  return body;
}

/** Sammelt alle alert/confirm-Texte; confirm wird bestätigt (oder abgelehnt, wenn accept=false) */
export function collectDialogs(page: Page, { accept = true } = {}) {
  const messages: string[] = [];
  page.on('dialog', async (dialog) => {
    messages.push(dialog.message());
    // Kommt der Dialog erst, während der Test schon endet, ist die Seite weg — das ist kein Fehler
    if (dialog.type() === 'confirm' && !accept) await dialog.dismiss().catch(() => {});
    else await dialog.accept().catch(() => {});
  });
  return messages;
}

export const guildPath = (sub: string) => `/server/${GUILD_ID}/${sub}`;

/** Direkter Zugriff auf die Test-DB — für Seiten, die (wie Settings) selbst aus der DB lesen */
export async function dbQuery(sql: string, params: unknown[] = []): Promise<any> {
  const conn = await mysql.createConnection(DB);
  try {
    const [rows] = await conn.query(sql, params);
    return rows;
  } finally {
    await conn.end();
  }
}

/**
 * Simuliert einen langsamen Rechner (z. B. im CI): astro:page-load-Handler laufen erst nach `ms`.
 * So lassen sich Felder ändern, bevor die Seite verdrahtet ist. `expectNotWiredYet` belegt, dass die
 * Eingabe wirklich vor dem Verdrahten passiert ist (sonst prüft der Test nichts).
 */
export async function delayPageWiring(page: Page, ms = 2000) {
  await page.addInitScript((delay) => {
    (window as any).__pageWired = false;
    const add = document.addEventListener.bind(document);
    document.addEventListener = ((type: string, listener: any, options?: any) => {
      if (type !== 'astro:page-load') return add(type, listener, options);
      return add(type, (event: Event) => setTimeout(() => {
        (window as any).__pageWired = true;
        typeof listener === 'function' ? listener(event) : listener.handleEvent(event);
      }, delay), options);
    }) as typeof document.addEventListener;
  }, ms);
}

export async function expectNotWiredYet(page: Page) {
  expect(await page.evaluate(() => (window as any).__pageWired), 'Eingabe kam erst nach dem Verdrahten').toBe(false);
}
