// Fake-Bot (interne Dashboard-API) und Fake-Discord für die E2E-Tests.
// Läuft als eigener Prozess (von Playwright als webServer gestartet).
//
// Steuerung aus den Tests:
//   POST /__test/reset   { overrides?: { "<module>/<action>": { status, error } | { data } } }
//   GET  /__test/calls   -> alle seit dem letzten Reset empfangenen Bot-Aufrufe
import http from 'node:http';
import { BOT_PORT, DISCORD_PORT, DASHBOARD_SECRET, GUILD_ID, FOREIGN_GUILD_ID } from './env.mjs';
import { defaultBotData } from './fixtures.mjs';

let calls = [];
let overrides = {};

function readJson(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve(null); }
    });
  });
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

// ─── Fake-Bot ────────────────────────────────────────────────────────────────
const bot = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');

  if (url.pathname === '/__test/health') return send(res, 200, { ok: true });
  if (url.pathname === '/__test/calls') return send(res, 200, calls);
  if (url.pathname === '/__test/reset') {
    const body = (await readJson(req)) ?? {};
    calls = [];
    overrides = body.overrides ?? {};
    return send(res, 200, { ok: true });
  }

  // Wie der echte Bot: ohne korrektes Bearer-Token wird nichts beantwortet
  if (req.headers.authorization !== `Bearer ${DASHBOARD_SECRET}`) {
    return send(res, 401, { ok: false, error: 'invalid_token' });
  }

  const body = await readJson(req);
  let key;
  const moduleMatch = url.pathname.match(/^\/api\/dashboard\/module\/([a-z_]+)\/([a-z-]+)$/);
  if (moduleMatch) key = `${moduleMatch[1]}/${moduleMatch[2]}`;
  else if (url.pathname === '/api/dashboard/settings') key = 'settings';
  else return send(res, 404, { ok: false, error: 'unknown_route' });

  calls.push({ key, body });

  const override = overrides[key];
  if (override?.error) return send(res, override.status ?? 400, { ok: false, error: override.error });
  if (override?.data !== undefined) return send(res, 200, { ok: true, data: override.data });

  const handler = defaultBotData[key];
  if (!handler) return send(res, 404, { ok: false, error: 'unknown_action' });
  return send(res, 200, { ok: true, data: typeof handler === 'function' ? handler(body) : handler });
});

// ─── Fake-Discord ────────────────────────────────────────────────────────────
const OWNER_PERMS = '2147483647';
const discord = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/users/@me/guilds') {
    return send(res, 200, [
      { id: GUILD_ID, name: 'Testserver', icon: null, owner: true, permissions: OWNER_PERMS },
      { id: FOREIGN_GUILD_ID, name: 'Fremder Server', icon: null, owner: false, permissions: '0' },
    ]);
  }
  return send(res, 404, { message: 'Not Found' });
});

bot.listen(BOT_PORT, '127.0.0.1');
discord.listen(DISCORD_PORT, '127.0.0.1');
console.log(`Fake-Bot auf :${BOT_PORT}, Fake-Discord auf :${DISCORD_PORT}`);
