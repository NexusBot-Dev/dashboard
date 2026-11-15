import { createHash } from 'node:crypto';
import { test, expect, type APIResponse } from '@playwright/test';
import { dbQuery, t, SESSION_COOKIE } from './support/helpers';

// Login über Discord (auth/login.ts, auth/callback.ts). Discord selbst ist hier nicht im Spiel:
// Die Tests rufen den Callback so auf, wie Discord zurückleitet, Token und Profil liefert der Fake-Discord.

const STATE_COOKIE = '__Host-nexus_oauth_state';
const STATE = 'a'.repeat(64);

test.use({ extraHTTPHeaders: { 'Accept-Language': 'de' } });

const location = (res: APIResponse) => res.headers()['location'];

function callback(request: import('@playwright/test').APIRequestContext, query: string, cookieState?: string) {
  return request.get(`/auth/callback/?${query}`, {
    headers: cookieState ? { Cookie: `${STATE_COOKIE}=${cookieState}` } : {},
    maxRedirects: 0,
  });
}

test.describe('Rückkehr von Discord', () => {
  test('passender State: Session wird angelegt, weiter zur Startseite', async ({ request }) => {
    const res = await callback(request, `code=good-code&state=${STATE}`, STATE);
    expect(res.status()).toBe(302);
    expect(location(res)).toBe('/');

    const cookie = res.headers()['set-cookie'] ?? '';
    const sessionId = cookie.match(new RegExp(`${SESSION_COOKIE}=([0-9a-f]{64})`))?.[1];
    expect(sessionId).toBeTruthy();
    const hash = createHash('sha256').update(sessionId!).digest('hex');
    const rows = await dbQuery('SELECT username FROM dashboard_sessions WHERE id = ?', [hash]);
    expect(rows).toEqual([{ username: 'e2e-user' }]);
    await dbQuery('DELETE FROM dashboard_sessions WHERE id = ?', [hash]);
  });

  test('State-Cookie fehlt (Login endet in anderem Browser): ein automatischer Neustart', async ({ request }) => {
    const res = await callback(request, `code=good-code&state=${STATE}`);
    expect(res.status()).toBe(302);
    expect(location(res)).toBe('/auth/login/?retry=1');

    // Der Neustart markiert den State, damit es bei einem Versuch bleibt
    const login = await request.get('/auth/login/?retry=1', { maxRedirects: 0 });
    const discordState = new URL(location(login)).searchParams.get('state')!;
    expect(discordState).toMatch(/^[0-9a-f]{64}\.retry$/);
    expect(login.headers()['set-cookie']).toContain(`${STATE_COOKIE}=${discordState};`);
  });

  test('fehlt das Cookie auch beim Neustart: Hinweis statt Endlosschleife', async ({ request }) => {
    const res = await callback(request, `code=good-code&state=${STATE}.retry`);
    expect(location(res)).toBe('/?login_error=state');
  });

  test('falscher State (Cookie da, passt aber nicht): sofort Hinweis, kein Neustart', async ({ request }) => {
    const res = await callback(request, `code=good-code&state=${'b'.repeat(64)}`, STATE);
    expect(location(res)).toBe('/?login_error=state');
    const noState = await callback(request, 'code=good-code', STATE);
    expect(location(noState)).toBe('/?login_error=state');
  });

  test('Abbrechen bei Discord', async ({ request }) => {
    const res = await callback(request, `error=access_denied&state=${STATE}`, STATE);
    expect(location(res)).toBe('/?login_error=denied');
  });

  test('Discord lehnt den Code ab oder kein Code: Hinweis „fehlgeschlagen“', async ({ request }) => {
    expect(location(await callback(request, `code=bad-code&state=${STATE}`, STATE))).toBe('/?login_error=failed');
    expect(location(await callback(request, `state=${STATE}`, STATE))).toBe('/?login_error=failed');
  });

  test('das State-Cookie wird in jedem Fall gelöscht', async ({ request }) => {
    const res = await callback(request, `code=x&state=${'b'.repeat(64)}`, STATE);
    expect(res.headers()['set-cookie']).toMatch(new RegExp(`${STATE_COOKIE}=deleted|${STATE_COOKIE}=;`));
  });
});

test.describe('Hinweis auf der Startseite', () => {
  test('wird angezeigt, verschwindet aus der Adresse und lässt sich schließen', async ({ page }) => {
    await page.goto('/?login_error=state');
    const banner = page.locator('#login-error');
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute('role', 'alert');
    await expect(banner).toContainText(t('landing.login_error.state'));
    // Login-Knopf bleibt direkt darunter erreichbar
    await expect(page.getByRole('link', { name: t('landing.login_with_discord') })).toBeVisible();

    await expect.poll(() => new URL(page.url()).search).toBe('');
    await banner.getByRole('button', { name: t('landing.login_error.close') }).click();
    await expect(banner).toHaveCount(0);
  });

  test('Abbruch erscheint als neutraler Hinweis, nicht als Fehler', async ({ page }) => {
    await page.goto('/?login_error=denied');
    const banner = page.locator('#login-error');
    await expect(banner).toContainText(t('landing.login_error.denied'));
    await expect(banner).not.toHaveClass(/border-red/);
  });

  test('unbekannte Codes zeigen nichts an', async ({ page }) => {
    await page.goto('/?login_error=<script>');
    await expect(page.locator('#login-error')).toHaveCount(0);
  });

  test('passt aufs Handy', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto('/?login_error=state');
    const box = await page.locator('#login-error').boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(360);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  });
});
