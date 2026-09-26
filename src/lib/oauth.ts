import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { CLIENT_ID, CLIENT_SECRET } from './secrets';

export const REDIRECT_URI = 'https://dashboard.trynexus.de/auth/callback';

export function generateState(): string {
  const nonce = randomBytes(16).toString('hex');
  const sig = createHmac('sha256', CLIENT_SECRET).update(nonce).digest('hex');
  return `${nonce}.${sig}`;
}

export function verifyState(state: string | null): boolean {
  if (!state) return false;
  const [nonce, sig] = state.split('.');
  if (!nonce || !sig) return false;
  const expected = createHmac('sha256', CLIENT_SECRET).update(nonce).digest('hex');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function getDiscordAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'identify guilds',
    state,
  });

  return `https://discord.com/api/oauth2/authorize?${params.toString()}`;
}

export interface DiscordTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

export async function exchangeCodeForToken(code: string): Promise<DiscordTokenResponse> {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
  });

  const res = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Fehler beim Token-Austausch (${res.status}): ${errText}`);
  }

  return await res.json();
}

export async function refreshAccessToken(refreshToken: string): Promise<DiscordTokenResponse> {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });

  const res = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Fehler beim Token-Refresh (${res.status}): ${errText}`);
  }

  return await res.json();
}

export async function getDiscordUser(accessToken: string) {
  const res = await fetch('https://discord.com/api/users/@me', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    throw new Error('Fehler beim Abrufen des Nutzerprofils');
  }

  return await res.json();
}

export async function getDiscordUserGuilds(accessToken: string) {
  const res = await fetch('https://discord.com/api/users/@me/guilds', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    throw new Error('Fehler beim Abrufen der Serverliste');
  }

  return await res.json();
}