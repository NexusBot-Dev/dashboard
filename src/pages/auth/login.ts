import type { APIRoute } from 'astro';
import { randomBytes } from 'node:crypto';
import { getDiscordAuthUrl, OAUTH_STATE_COOKIE } from '../../lib/oauth';

export const GET: APIRoute = ({ cookies, redirect }) => {
  const state = randomBytes(32).toString('hex');
  cookies.set(OAUTH_STATE_COOKIE, state, {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 600,
  });
  return redirect(getDiscordAuthUrl(state));
};