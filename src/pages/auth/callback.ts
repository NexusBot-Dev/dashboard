import type { APIRoute } from 'astro';
import { timingSafeEqual } from 'node:crypto';
import { exchangeCodeForToken, getDiscordUser } from '../../lib/oauth';
import { createSession } from '../../lib/session';

export const GET: APIRoute = async ({ url, cookies, redirect }) => {
  const code = url.searchParams.get('code');
  const urlState = url.searchParams.get('state');
  const cookieState = cookies.get('oauth_state')?.value;
  cookies.delete('oauth_state', { path: '/' });

  if (
    !cookieState || !urlState ||
    cookieState.length !== urlState.length ||
    !timingSafeEqual(Buffer.from(cookieState), Buffer.from(urlState))
  ) {
    return new Response('Ungültiger OAuth-State — bitte den Login erneut starten.', { status: 400 });
  }

  if (!code) {
    return new Response('Kein Autorisierungscode von Discord erhalten.', { status: 400 });
  }

  try {
    const tokenData = await exchangeCodeForToken(code);
    const discordUser = await getDiscordUser(tokenData.access_token);

    const avatarUrl = discordUser.avatar
      ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`
      : undefined;

    await createSession(cookies, {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresIn: tokenData.expires_in,
      discordUserId: discordUser.id,
      username: discordUser.username,
      globalName: discordUser.global_name,
      avatarUrl,
    });

    return redirect('/');
  } catch (err) {
    console.error('OAuth-Callback fehlgeschlagen:', err);
    return new Response('Login fehlgeschlagen. Bitte erneut versuchen.', { status: 500 });
  }
};