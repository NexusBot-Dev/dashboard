import type { AstroCookies } from 'astro';
import { randomBytes, createHash } from 'node:crypto';
import pool from './db';
import { encrypt, decrypt } from './crypto';
import { refreshAccessToken } from './oauth';

const SESSION_COOKIE = 'nexus_session_id';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

const REFRESH_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 1 Tag

function hashSessionId(sessionId: string): string {
  return createHash('sha256').update(sessionId).digest('hex');
}

export interface SessionData {
  discordUserId: string;
  username: string;
  globalName?: string;
  avatarUrl?: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

interface RefreshedTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

export async function createSession(cookies: AstroCookies, data: Omit<SessionData, 'expiresAt'> & { expiresIn: number }) {
  const sessionId = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + data.expiresIn * 1000);

  await pool.query(
    `INSERT INTO dashboard_sessions
     (id, discord_user_id, username, global_name, avatar_url, access_token, refresh_token, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      hashSessionId(sessionId),
      data.discordUserId,
      data.username,
      data.globalName ?? null,
      data.avatarUrl ?? null,
      encrypt(data.accessToken),
      encrypt(data.refreshToken),
      expiresAt,
    ]
  );

  cookies.set(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: MAX_AGE_SECONDS,
    path: '/',
  });
}

async function refreshAndPersist(sessionIdHash: string, currentRefreshToken: string): Promise<RefreshedTokens> {
  const tokenData = await refreshAccessToken(currentRefreshToken);
  const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);

  await pool.query(
    `UPDATE dashboard_sessions
     SET access_token = ?, refresh_token = ?, expires_at = ?
     WHERE id = ?`,
    [encrypt(tokenData.access_token), encrypt(tokenData.refresh_token), expiresAt, sessionIdHash]
  );

  return {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    expiresAt,
  };
}

// Aktuelle Tokens frisch aus der DB lesen (null, wenn die Session nicht mehr existiert).
async function readStoredTokens(sessionIdHash: string): Promise<RefreshedTokens | null> {
  const [rows] = await pool.query(
    'SELECT access_token, refresh_token, expires_at FROM dashboard_sessions WHERE id = ?',
    [sessionIdHash]
  );
  const row = (rows as any[])[0];
  if (!row) return null;
  return {
    accessToken: decrypt(row.access_token),
    refreshToken: decrypt(row.refresh_token),
    expiresAt: new Date(row.expires_at),
  };
}

// Pro Session läuft höchstens ein Refresh gleichzeitig; parallele Requests teilen sich dasselbe Promise.
const inflightRefreshes = new Map<string, Promise<RefreshedTokens>>();

function refreshOnce(sessionIdHash: string, refreshToken: string): Promise<RefreshedTokens> {
  const existing = inflightRefreshes.get(sessionIdHash);
  if (existing) return existing;

  const promise = (async () => {
    try {
      return await refreshAndPersist(sessionIdHash, refreshToken);
    } catch (err) {
      // Ein anderer Request (oder eine andere Instanz) kann den Refresh-Token schon getauscht haben.
      // Dann steht in der DB bereits ein neuer Stand, und wir nutzen den, statt die Session zu löschen.
      const stored = await readStoredTokens(sessionIdHash).catch(() => null);
      if (stored && stored.refreshToken !== refreshToken) return stored;
      throw err;
    }
  })().finally(() => {
    inflightRefreshes.delete(sessionIdHash);
  });

  inflightRefreshes.set(sessionIdHash, promise);
  return promise;
}

export async function getSession(cookies: AstroCookies): Promise<SessionData | null> {
  const sessionId = cookies.get(SESSION_COOKIE)?.value;
  if (!sessionId) return null;
  const sessionIdHash = hashSessionId(sessionId);

  const [rows] = await pool.query('SELECT * FROM dashboard_sessions WHERE id = ?', [sessionIdHash]);
  const row = (rows as any[])[0];
  if (!row) return null;

  if (new Date(row.expires_at).getTime() < Date.now()) {
    await pool.query('DELETE FROM dashboard_sessions WHERE id = ?', [sessionIdHash]);
    return null;
  }

  let accessToken: string;
  let refreshToken: string;
  let expiresAt: Date;
  try {
    accessToken = decrypt(row.access_token);
    refreshToken = decrypt(row.refresh_token);
    expiresAt = new Date(row.expires_at);
  } catch (err) {
    console.error('Session-Token-Entschlüsselung fehlgeschlagen, verwerfe Session:', err);
    await pool.query('DELETE FROM dashboard_sessions WHERE id = ?', [sessionIdHash]);
    return null;
  }

  if (expiresAt.getTime() - Date.now() < REFRESH_THRESHOLD_MS) {
    try {
      const refreshed = await refreshOnce(sessionIdHash, refreshToken);
      accessToken = refreshed.accessToken;
      refreshToken = refreshed.refreshToken;
      expiresAt = refreshed.expiresAt;
    } catch (err) {
      console.error('Token-Refresh fehlgeschlagen, beende Session:', err);
      await pool.query('DELETE FROM dashboard_sessions WHERE id = ?', [sessionIdHash]);
      return null;
    }
  }

  return {
    discordUserId: row.discord_user_id,
    username: row.username,
    globalName: row.global_name ?? undefined,
    avatarUrl: row.avatar_url ?? undefined,
    accessToken,
    refreshToken,
    expiresAt,
  };
}

export async function clearSession(cookies: AstroCookies) {
  const sessionId = cookies.get(SESSION_COOKIE)?.value;
  if (sessionId) {
    await pool.query('DELETE FROM dashboard_sessions WHERE id = ?', [hashSessionId(sessionId)]);
  }
  cookies.delete(SESSION_COOKIE, { path: '/' });
}