import type { APIRoute } from 'astro';
import { randomBytes } from 'node:crypto';
import { getDiscordAuthUrl, OAUTH_RETRY_SUFFIX, OAUTH_STATE_COOKIE } from '../../lib/oauth';

export const GET: APIRoute = ({ url, cookies, redirect }) => {
  // ?retry=1 kommt nur vom Callback (fehlendes State-Cookie): markiert den State, damit es bei einem Versuch bleibt
  const retry = url.searchParams.get('retry') === '1';
  const state = randomBytes(32).toString('hex') + (retry ? OAUTH_RETRY_SUFFIX : '');
  cookies.set(OAUTH_STATE_COOKIE, state, {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 600,
  });
  return redirect(getDiscordAuthUrl(state));
};
