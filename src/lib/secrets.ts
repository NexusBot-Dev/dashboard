import fs from 'node:fs';

function getSecret(envVarName: string, fileEnvVarName?: string): string {
  const filePath = fileEnvVarName ? process.env[fileEnvVarName] : undefined;
  if (filePath && fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, 'utf-8').trim();
  }

  return process.env[envVarName]?.trim() || '';
}

export const DB_PASSWORD = getSecret('NEXUS_DASHBOARD_DB_PASSWORD', 'DB_PASSWORD_FILE');
export const CLIENT_ID = getSecret('DISCORD_CLIENT_ID', 'DISCORD_CLIENT_ID_FILE');
export const CLIENT_SECRET = getSecret('DISCORD_CLIENT_SECRET', 'DISCORD_CLIENT_SECRET_FILE');
export const SESSION_ENCRYPTION_KEY = getSecret('NEXUS_SESSION_ENCRYPTION_KEY', 'SESSION_ENCRYPTION_KEY_FILE');
export const DASHBOARD_TOKEN = getSecret('NEXUS_DASHBOARD_SECRET', 'DASHBOARD_SECRET_FILE');
export const BOT_INTERNAL_URL = process.env.BOT_INTERNAL_URL ?? 'http://nexus-bot:8080';
export const OWNER_DISCORD_ID = process.env.OWNER_DISCORD_ID ?? '170551974461308929';
