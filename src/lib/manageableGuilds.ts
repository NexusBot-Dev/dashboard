import { getCachedUserGuilds } from './guildsCache';
import pool from './db';

const ADMINISTRATOR = 0x8;
const MANAGE_GUILD = 0x20;

function hasAdminOrManageAccess(guild: { owner: boolean; permissions: string }): boolean {
  if (guild.owner) return true;
  const perms = BigInt(guild.permissions);
  const isAdmin = (perms & BigInt(ADMINISTRATOR)) === BigInt(ADMINISTRATOR);
  const canManage = (perms & BigInt(MANAGE_GUILD)) === BigInt(MANAGE_GUILD);
  return isAdmin || canManage;
}

export interface ManageableGuild {
  guildId: string;
  name: string;
  iconUrl: string | null;
  botPresent: boolean;
  targetUrl: string;
  isExternal: boolean;
}

/**
 * Liefert alle Guilds, auf denen der User Admin/Manage-Guild hat, inkl.
 * Info ob der Bot dort schon läuft. Wird sowohl vom Server-Picker als auch
 * vom Server-Switcher-Dropdown im TopHeader verwendet — eine Quelle statt
 * doppelter Logik an zwei Stellen.
 */
export async function getManageableGuilds(accessToken: string, clientId: string): Promise<ManageableGuild[]> {
  const discordGuilds = await getCachedUserGuilds(accessToken);
  const manageableGuilds = discordGuilds.filter(hasAdminOrManageAccess);

  const guildIds = manageableGuilds.map((g: any) => g.id);
  let botGuildIds = new Set<string>();

  if (guildIds.length > 0) {
    const placeholders = guildIds.map(() => '?').join(',');
    const [rows] = await pool.query(
      `SELECT guild_id FROM guild_settings WHERE guild_id IN (${placeholders})`,
      guildIds
    );
    botGuildIds = new Set((rows as any[]).map((r) => String(r.guild_id)));
  }

  return manageableGuilds.map((g: any) => {
    const botPresent = botGuildIds.has(g.id);
    const inviteUrl = `https://discord.com/oauth2/authorize?client_id=${clientId}&scope=bot%20applications.commands&permissions=8&guild_id=${g.id}&disable_guild_select=true`;

    return {
      guildId: g.id,
      name: g.name,
      iconUrl: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png` : null,
      botPresent,
      targetUrl: botPresent ? `/server/${g.id}/` : inviteUrl,
      isExternal: !botPresent,
    };
  });
}
