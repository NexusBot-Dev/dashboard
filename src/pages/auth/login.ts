import type { APIRoute } from 'astro';
import { randomBytes } from 'node:crypto';
import { getDiscordAuthUrl } from '../../lib/oauth';

export const GET: APIRoute = ({ cookies, redirect }) => {
  const state = randomBytes(32).toString('hex');
  cookies.set('oauth_state', state, {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 600,
  });
  return redirect(getDiscordAuthUrl(state));
};