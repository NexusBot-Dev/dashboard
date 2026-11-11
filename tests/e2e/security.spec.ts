import { createHash } from 'node:crypto';
import { test, expect, type APIRequestContext } from '@playwright/test';
import { APP_URL, GUILD_ID, SESSION_ID } from './support/env.mjs';
import { login, resetBot, botCalls, browserPost, dbQuery, guildPath, t, SESSION_COOKIE } from './support/helpers';

// Schutz gegen Anfragen fremder Seiten (z. B. einer gekaperten Subdomain von trynexus.de):
// Deren Seite kann den Browser eines eingeloggten Nutzers Anfragen schicken lassen, SameSite=Lax
// gibt das Session-Cookie zwischen Subdomains mit. Die Anfragen hier spielen die Header nach,
// die ein Browser in diesem Fall setzt.

const ACTION = `/api/server/${GUILD_ID}/module/tickets/set-timeouts/`;
const BOT_KEY = 'tickets/set-timeouts';
const COOKIE = `${SESSION_COOKIE}=${SESSION_ID}`;
const SAME_ORIGIN = { 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' };

test.use({ extraHTTPHeaders: { 'Accept-Language': 'de' } });

function post(request: APIRequestContext, url: string, headers: Record<string, string>, data = '{"closure_timeout_hours":12}') {
  return request.post(url, { headers: { Cookie: COOKIE, ...headers }, data });
}

test.beforeEach(async () => {
  await resetBot();
});

test.describe('Anfragen fremder Seiten', () => {
  test('andere Subdomain (same-site) wird abgewiesen und erreicht den Bot nicht', async ({ request }) => {
    const res = await post(request, ACTION, { ...SAME_ORIGIN, 'Sec-Fetch-Site': 'same-site' });
    expect(res.status()).toBe(403);
    expect((await res.json()).error).toBe(t('api_errors.invalid_request'));
    expect(await botCalls(BOT_KEY)).toHaveLength(0);
  });

  test('fremde Website (cross-site) wird abgewiesen', async ({ request }) => {
    const res = await post(request, ACTION, { ...SAME_ORIGIN, 'Sec-Fetch-Site': 'cross-site' });
    expect(res.status()).toBe(403);
    expect(await botCalls(BOT_KEY)).toHaveLength(0);
  });

  test('ältere Browser ohne Sec-Fetch-Site: fremder Origin wird abgewiesen, eigener durchgelassen', async ({ request }) => {
    const json = { 'Content-Type': 'application/json' };
    expect((await post(request, ACTION, { ...json, Origin: 'https://evil.trynexus.de' })).status()).toBe(403);
    expect((await post(request, ACTION, json)).status()).toBe(403); // weder Sec-Fetch-Site noch Origin
    expect(await botCalls(BOT_KEY)).toHaveLength(0);

    // Hinter nginx kennt Astro die öffentliche Adresse nicht (url.origin ist localhost) — maßgeblich ist `site`
    expect((await post(request, ACTION, { ...json, Origin: 'https://dashboard.trynexus.de' })).status()).toBe(200);
    expect(await botCalls(BOT_KEY)).toHaveLength(1);
  });

  test('Sprache umstellen und Abmelden gehen nur von eigenen Seiten', async ({ request }) => {
    const sameSite = { 'Sec-Fetch-Site': 'same-site', 'Content-Type': 'application/json' };
    const lang = await post(request, '/api/set-lang/', sameSite, '{"lang":"en"}');
    expect(lang.status()).toBe(403);
    expect(lang.headers()['set-cookie']).toBeUndefined();

    const logout = await request.post('/auth/logout/', {
      headers: { Cookie: COOKIE, 'Sec-Fetch-Site': 'same-site', 'Content-Type': 'application/x-www-form-urlencoded' },
      maxRedirects: 0,
    });
    expect(logout.status()).toBe(403);
    const rows = await dbQuery('SELECT 1 FROM dashboard_sessions WHERE id = ?', [createHash('sha256').update(SESSION_ID).digest('hex')]);
    expect(rows).toHaveLength(1);
  });

  test('eigene Seite: normale Aktion geht durch', async ({ page, context }) => {
    await login(context);
    await page.goto(guildPath('tickets/'));
    const res = await browserPost(page, ACTION, { closure_timeout_hours: 12 });
    expect(res.status).toBe(200);
    expect(await botCalls(BOT_KEY)).toHaveLength(1);
  });
});

test.describe('API nimmt nur JSON an', () => {
  test('Formular- und Text-Bodies werden abgewiesen (die kämen ohne Preflight durch)', async ({ request }) => {
    for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x']) {
      const res = await post(request, ACTION, { ...SAME_ORIGIN, 'Content-Type': type });
      expect(res.status(), type).toBe(415);
      expect((await res.json()).error).toBe(t('api_errors.invalid_request'));
    }
    const noType = await request.post(ACTION, { headers: { Cookie: COOKIE, 'Sec-Fetch-Site': 'same-origin' } });
    expect(noType.status()).toBe(415);
    expect(await botCalls(BOT_KEY)).toHaveLength(0);
  });

  test('JSON mit charset ist erlaubt', async ({ request }) => {
    const res = await post(request, ACTION, { ...SAME_ORIGIN, 'Content-Type': 'Application/JSON; charset=utf-8' });
    expect(res.status()).toBe(200);
  });

  test('kaputtes JSON oder kein Objekt: 400, die Aktion läuft nicht', async ({ request }) => {
    for (const body of ['{"closure_timeout_hours":', '[1,2]', 'null', '"text"']) {
      const res = await post(request, ACTION, SAME_ORIGIN, body);
      expect(res.status(), body).toBe(400);
      expect((await res.json()).error).toBe(t('api_errors.invalid_request'));
    }
    expect(await botCalls(BOT_KEY)).toHaveLength(0);
  });

  test('leerer Body bleibt erlaubt (Aktionen ohne Daten)', async ({ request }) => {
    // ohne `data`: Playwright würde '' als JSON-String "" schicken
    const res = await request.post(ACTION, { headers: { Cookie: COOKIE, ...SAME_ORIGIN } });
    expect(res.status()).toBe(200);
    expect(await botCalls(BOT_KEY)).toHaveLength(1);
  });
});

test.describe('Cookies mit __Host-Präfix', () => {
  test('Login setzt den OAuth-State als __Host-Cookie', async ({ request }) => {
    const res = await request.get('/auth/login/', { maxRedirects: 0 });
    const cookie = res.headers()['set-cookie'];
    expect(cookie).toMatch(/^__Host-nexus_oauth_state=[0-9a-f]{64};/);
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('Path=/');
    expect(cookie).not.toMatch(/Domain=/i);
  });

  test('der alte Cookie-Name meldet nicht mehr an', async ({ request }) => {
    const res = await request.post(ACTION, {
      headers: { ...SAME_ORIGIN, Cookie: `nexus_session_id=${SESSION_ID}` },
      data: '{}',
    });
    expect(res.status()).toBe(401);
  });

  test('Abmelden löscht das __Host-Cookie im Browser', async ({ page, context }) => {
    // Eigene Session, damit die gemeinsame Test-Session erhalten bleibt
    const ownId = 'e2e-logout-session';
    const hash = (id: string) => createHash('sha256').update(id).digest('hex');
    await dbQuery(
      `INSERT INTO dashboard_sessions (id, discord_user_id, username, global_name, access_token, refresh_token, expires_at)
       SELECT ?, discord_user_id, username, global_name, access_token, refresh_token, expires_at
       FROM dashboard_sessions WHERE id = ?`,
      [hash(ownId), hash(SESSION_ID)]
    );
    await login(context, ownId);
    await page.goto('/server/');
    await page.locator('form[action^="/auth/logout"]').evaluate((form: HTMLFormElement) => form.submit());
    await page.waitForURL(`${APP_URL}/`);

    expect((await context.cookies()).map((c) => c.name)).not.toContain(SESSION_COOKIE);
    expect(await dbQuery('SELECT 1 FROM dashboard_sessions WHERE id = ?', [hash(ownId)])).toHaveLength(0);
  });
});
