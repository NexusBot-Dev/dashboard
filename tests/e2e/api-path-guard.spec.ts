import { test, expect, type Page } from '@playwright/test';
import { login, resetBot, botCalls, guildPath, t } from './support/helpers';
import { GUILD_ID } from './support/env.mjs';

// Modul-API (src/pages/api/server/[guildId]/module/[module]/[action].ts → src/lib/botApi.ts): Modul und Aktion
// landen im Pfad der Bot-URL. Ein „\“ (%5C) behandelt fetch wie „/“ — mit „..“ ging die Anfrage sonst an einen
// anderen Endpunkt des Bots (nachgestellt: x/..%5C..%5Csettings erreichte /api/dashboard/settings).

async function post(page: Page, url: string, body: unknown = {}) {
  return page.evaluate(async ({ url, body }) => {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, type: res.headers.get('content-type'), json: await res.json() };
  }, { url, body });
}

test.beforeEach(async ({ context, page }) => {
  await resetBot();
  await login(context);
  await page.goto(guildPath(''));
  await resetBot();   // Aufrufe beim Seitenaufbau nicht mitzählen
});

const BAD = [
  'x/..%5C..%5Csettings',          // Backslash: kam bis /api/dashboard/settings durch
  'x/..%2F..%2Fsettings',          // kodierter Schrägstrich
  'x/%2E%2E%5C%2E%2E%5Csettings',  // kodierte Punkte
  'automod/Status',                // Großbuchstaben
  'automod/sta.tus',
  'auto%20mod/status',
  '..%5Cx/status',                 // im Modul statt in der Aktion
];

for (const path of BAD) {
  test(`abgelehnt, ohne den Bot zu fragen: ${path}`, async ({ page }) => {
    const res = await post(page, `/api/server/${GUILD_ID}/module/${path}/`, { fields: { prefix: '!' } });
    expect(res.status).toBe(400);
    expect(res.json).toEqual({ ok: false, error: t('api_errors.invalid_request') });
    expect(res.type).toMatch(/^application\/json/);
    expect(await botCalls()).toEqual([]);
  });
}

test('gültige Aktion geht durch, Antworten sind JSON', async ({ page }) => {
  const ok = await post(page, `/api/server/${GUILD_ID}/module/automod/status/`);
  expect(ok.status).toBe(200);
  expect(ok.type).toMatch(/^application\/json/);
  expect((await botCalls()).map((c) => c.key)).toEqual(['automod/status']);

  await resetBot({ 'automod/status': { status: 400, error: 'Nö.' } });
  const rejected = await post(page, `/api/server/${GUILD_ID}/module/automod/status/`);
  expect(rejected.status).toBe(400);
  expect(rejected.type).toMatch(/^application\/json/);

  const settings = await post(page, `/api/server/${GUILD_ID}/settings/`, { prefix: '!' });
  expect(settings.status).toBe(200);
  expect(settings.type).toMatch(/^application\/json/);
  expect((await botCalls('settings')).map((c) => c.body.acting_user_id)).toHaveLength(1);
});
