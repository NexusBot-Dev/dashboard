import pool from './db';

// Standardwerte wie im Bot (database/db_settings.py, DEFAULT_MODULES) — gelten, wenn ein Modul in der DB fehlt
export const MODULE_DEFAULTS: Record<string, boolean> = {
  moderation: true, levels: false, welcome: false, reaction_roles: false, boosts: false,
  embeds: false, automod: false, stream_alerts: true, tickets: true,
};

/** Module, die man ein- und ausschalten kann (Moderation, Embeds, Giveaways sind immer aktiv) */
export const TOGGLEABLE_MODULES = ['tickets', 'levels', 'welcome', 'boosts', 'reaction_roles', 'automod', 'stream_alerts'] as const;
export type ModuleKey = (typeof TOGGLEABLE_MODULES)[number];

export function parseModules(raw: unknown): Record<string, boolean> {
  const stored = typeof raw === 'string' ? JSON.parse(raw) : (raw ?? {});
  return { ...MODULE_DEFAULTS, ...(stored as Record<string, boolean>) };
}

/** An/Aus aller Module eines Servers. null, wenn es (noch) keine Einstellungen gibt. */
export async function getModuleStates(guildId: string): Promise<Record<string, boolean> | null> {
  const [rows] = await pool.query(`SELECT modules FROM guild_settings WHERE guild_id = ?`, [guildId]);
  const row = (rows as any[])[0];
  return row ? parseModules(row.modules) : null;
}
