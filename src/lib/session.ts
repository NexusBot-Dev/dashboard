import type { AstroCookies } from 'astro';
import { randomBytes } from 'node:crypto';
import pool from './db';
import { encrypt, decrypt } from './crypto';
import { refreshAccessToken } from './oauth';

const SESSION_COOKIE = 'nexus_session_id';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

const REFRESH_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 1 Tag

export interface SessionData {
  discordUserId: string;
  username: string;
  globalName?: string;
  avatarUrl?: string;
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
      sessionId,
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

async function refreshAndPersist(sessionId: string, currentRefreshToken: string) {
  const tokenData = await refreshAccessToken(currentRefreshToken);
  const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);

  await pool.query(
    `UPDATE dashboard_sessions
     SET access_token = ?, refresh_token = ?, expires_at = ?
     WHERE id = ?`,
    [encrypt(tokenData.access_token), encrypt(tokenData.refresh_token), expiresAt, sessionId]
  );

  return {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    expiresAt,
  };
}

export async function getSession(cookies: AstroCookies): Promise<SessionData | null> {
  const sessionId = cookies.get(SESSION_COOKIE)?.value;
  if (!sessionId) return null;

  const [rows] = await pool.query('SELECT * FROM dashboard_sessions WHERE id = ?', [sessionId]);
  const row = (rows as any[])[0];
  if (!row) return null;

  if (new Date(row.expires_at).getTime() < Date.now()) {
    await pool.query('DELETE FROM dashboard_sessions WHERE id = ?', [sessionId]);
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
    await pool.query('DELETE FROM dashboard_sessions WHERE id = ?', [sessionId]);
    return null;
  }

  if (expiresAt.getTime() - Date.now() < REFRESH_THRESHOLD_MS) {
    try {
      const refreshed = await refreshAndPersist(sessionId, refreshToken);
      accessToken = refreshed.accessToken;
      refreshToken = refreshed.refreshToken;
      expiresAt = refreshed.expiresAt;
    } catch (err) {
      console.error('Token-Refresh fehlgeschlagen, beende Session:', err);
      await pool.query('DELETE FROM dashboard_sessions WHERE id = ?', [sessionId]);
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
    await pool.query('DELETE FROM dashboard_sessions WHERE id = ?', [sessionId]);
  }
  cookies.delete(SESSION_COOKIE, { path: '/' });
}
