import { DASHBOARD_TOKEN, BOT_INTERNAL_URL } from './secrets';

export async function callBotModuleAction(
  module: string,
  action: string,
  guildId: string,
  extra: Record<string, unknown> = {},
  actingUserId?: string,
  accessToken?: string
) {
  const res = await fetch(`${BOT_INTERNAL_URL}/api/dashboard/module/${module}/${action}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${DASHBOARD_TOKEN}`,
    },
    body: JSON.stringify({ ...extra, guild_id: guildId, acting_user_id: actingUserId, discord_access_token: accessToken }),
  });

  const data = await res.json();
  if (!data.ok) {
    throw new Error(data.error ?? 'bot_error');
  }
  return data.data;
}

export async function callGuildAction(
  Astro: { locals: { session?: { discordUserId: string; accessToken: string } | null } },
  module: string,
  action: string,
  guildId: string,
  extra: Record<string, unknown> = {}
) {
  const session = Astro.locals.session;
  return callBotModuleAction(module, action, guildId, extra, session?.discordUserId, session?.accessToken);
}