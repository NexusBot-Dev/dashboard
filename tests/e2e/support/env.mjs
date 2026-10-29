// Gemeinsame Konstanten für Testlauf, Fake-Backends und Dashboard-Server.
// Plain JS, damit auch der Fake-Backend-Prozess (node, ohne TS) sie importieren kann.

const env = process.env;

export const APP_PORT = Number(env.E2E_APP_PORT ?? 4329);
export const BOT_PORT = Number(env.E2E_BOT_PORT ?? 4401);
export const DISCORD_PORT = Number(env.E2E_DISCORD_PORT ?? 4402);

export const APP_URL = `http://127.0.0.1:${APP_PORT}`;
export const BOT_URL = `http://127.0.0.1:${BOT_PORT}`;
export const DISCORD_URL = `http://127.0.0.1:${DISCORD_PORT}`;

export const DB = {
  host: env.E2E_DB_HOST ?? '127.0.0.1',
  port: Number(env.E2E_DB_PORT ?? 3306),
  user: env.E2E_DB_USER ?? 'nexus_test',
  password: env.E2E_DB_PASSWORD ?? 'test',
  database: env.E2E_DB_NAME ?? 'nexus_test',
};

export const DASHBOARD_SECRET = 'e2e-dashboard-secret';
export const SESSION_ENCRYPTION_KEY = 'e2e-session-encryption-key';

// Der eingeloggte Test-User und seine Server
export const USER_ID = '500000000000000001';
export const GUILD_ID = '100000000000000001';        // User ist Owner, Bot ist drauf
export const FOREIGN_GUILD_ID = '100000000000000002'; // User ist Mitglied ohne Rechte
export const SESSION_ID = 'e2e-test-session';        // Roh-Wert des Session-Cookies

/** Umgebung für den Dashboard-Server (node dist/server/entry.mjs) */
export function appEnv() {
  return {
    HOST: '127.0.0.1',
    PORT: String(APP_PORT),
    DB_HOST: DB.host,
    DB_PORT: String(DB.port),
    DB_USER: DB.user,
    DB_NAME: DB.database,
    NEXUS_DASHBOARD_DB_PASSWORD: DB.password,
    NEXUS_DASHBOARD_SECRET: DASHBOARD_SECRET,
    NEXUS_SESSION_ENCRYPTION_KEY: SESSION_ENCRYPTION_KEY,
    BOT_INTERNAL_URL: BOT_URL,
    DISCORD_API_BASE: `${DISCORD_URL}/api`,
    DISCORD_CLIENT_ID: '400000000000000001',
    DISCORD_CLIENT_SECRET: 'e2e-client-secret',
    OWNER_DISCORD_ID: '999999999999999999', // Test-User ist bewusst nicht Owner
  };
}
