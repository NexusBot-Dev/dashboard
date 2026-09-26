import { getCachedUserGuilds } from './guildsCache';

const ADMINISTRATOR = 0x8;
const MANAGE_GUILD = 0x20;

export async function userHasGuildAccess(accessToken: string, guildId: string): Promise<boolean> {
  const guilds = await getCachedUserGuilds(accessToken, false, false);
  const guild = guilds.find((g: any) => g.id === guildId);
  if (!guild) return false;

  if (guild.owner) return true;
  const perms = BigInt(guild.permissions);
  return (
    (perms & BigInt(ADMINISTRATOR)) === BigInt(ADMINISTRATOR) ||
    (perms & BigInt(MANAGE_GUILD)) === BigInt(MANAGE_GUILD)
  );
}