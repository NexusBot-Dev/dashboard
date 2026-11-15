import type { APIRoute } from 'astro';
import { timingSafeEqual } from 'node:crypto';
import {
  exchangeCodeForToken,
  getDiscordUser,
  OAUTH_RETRY_SUFFIX,
  OAUTH_STATE_COOKIE,
  type LoginError,
} from '../../lib/oauth';
import { createSession } from '../../lib/session';

// Fehler landen auf der Startseite, die sie als Hinweis anzeigt (statt einer nackten Textseite)
function loginError(redirect: (path: string) => Response, code: LoginError): Response {
  return redirect(`/?login_error=${code}`);
}

function sameState(a: string, b: string): boolean {
  return a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export const GET: APIRoute = async ({ url, cookies, redirect, request }) => {
  const code = url.searchParams.get('code');
  const urlState = url.searchParams.get('state');
  const cookieState = cookies.get(OAUTH_STATE_COOKIE)?.value;
  cookies.delete(OAUTH_STATE_COOKIE, { path: '/', secure: true });

  // Abbrechen auf der Discord-Seite: Discord schickt ?error=access_denied zurück
  if (url.searchParams.get('error')) {
    return loginError(redirect, 'denied');
  }

  if (!cookieState || !urlState || !sameState(cookieState, urlState)) {
    const reason = !urlState ? 'ohne State in der URL' : !cookieState ? 'State-Cookie fehlt' : 'State passt nicht';
    console.warn(`OAuth-Callback abgelehnt: ${reason} (${request.headers.get('user-agent')?.slice(0, 160) ?? 'ohne User-Agent'})`);

    // Fehlt nur das Cookie, endet der Login meist in einem anderen Browser als er begonnen hat
    // (auf dem Handy z. B. über die Discord-App). Ein neuer Start in diesem Browser klappt dann.
    // Nur einmal: der neue State trägt die Endung und landet beim zweiten Fehlschlag im Hinweis.
    if (!cookieState && urlState && !urlState.endsWith(OAUTH_RETRY_SUFFIX)) {
      return redirect('/auth/login/?retry=1');
    }
    return loginError(redirect, 'state');
  }

  if (!code) {
    return loginError(redirect, 'failed');
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
    return loginError(redirect, 'failed');
  }
};
