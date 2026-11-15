import type { APIRoute } from 'astro';
import { randomBytes } from 'node:crypto';
import { getDiscordAuthUrl, OAUTH_RETRY_SUFFIX, OAUTH_STATE_COOKIE } from '../../lib/oauth';

const STATE_PATTERN = /^[0-9a-f]{64}(\.retry)?$/;

export const GET: APIRoute = ({ url, cookies }) => {
  // ?retry=1 kommt nur vom Callback (fehlendes State-Cookie): markiert den State, damit es bei einem Versuch bleibt
  const retry = url.searchParams.get('retry') === '1';

  // Läuft schon ein Login in diesem Browser, denselben State weiterverwenden. Sonst überschreibt ein zweiter
  // Aufruf (doppeltes Tippen, Vorabladen eines Links) das Cookie, und der State von Discord passt nicht mehr.
  const existing = cookies.get(OAUTH_STATE_COOKIE)?.value;
  const reusable = existing && STATE_PATTERN.test(existing) && existing.endsWith(OAUTH_RETRY_SUFFIX) === retry;
  const state = reusable ? existing : randomBytes(32).toString('hex') + (retry ? OAUTH_RETRY_SUFFIX : '');

  cookies.set(OAUTH_STATE_COOKIE, state, {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 600,
  });
  // no-store: Die Weiterleitung enthält den State und darf nie aus einem Cache kommen
  return new Response(null, {
    status: 302,
    headers: { Location: getDiscordAuthUrl(state), 'Cache-Control': 'no-store' },
  });
};
