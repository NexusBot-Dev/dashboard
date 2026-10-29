import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import mysql from 'mysql2/promise';
import { DB, GUILD_ID, FOREIGN_GUILD_ID, USER_ID, SESSION_ID, SESSION_ENCRYPTION_KEY } from './support/env.mjs';

// Legt die Test-Datenbank frisch an: Schema, beide Testserver und eine gültige Login-Session.
export default async function globalSetup() {
  // crypto.ts liest den Schlüssel beim Import aus der Umgebung — daher erst setzen, dann importieren
  process.env.NEXUS_SESSION_ENCRYPTION_KEY = SESSION_ENCRYPTION_KEY;
  const { encrypt } = await import('../../src/lib/crypto');

  const conn = await mysql.createConnection({ ...DB, multipleStatements: true });
  try {
    await conn.query(fs.readFileSync(path.join(import.meta.dirname, 'support/schema.sql'), 'utf-8'));

    await conn.query('INSERT INTO guild_settings (guild_id, setup_complete) VALUES (?, 1), (?, 1)', [GUILD_ID, FOREIGN_GUILD_ID]);

    // Gleiche Ableitung wie src/lib/session.ts: in der DB steht nur der SHA-256-Hash der Session-ID
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // > 1 Tag → kein Token-Refresh
    await conn.query(
      `INSERT INTO dashboard_sessions (id, discord_user_id, username, global_name, access_token, refresh_token, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        createHash('sha256').update(SESSION_ID).digest('hex'),
        USER_ID, 'testuser', 'Test User',
        encrypt('e2e-access-token'), encrypt('e2e-refresh-token'),
        expiresAt,
      ]
    );
  } finally {
    await conn.end();
  }
}
