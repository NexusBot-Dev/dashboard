import type { APIRoute } from 'astro';
import { getSession } from '../../../../lib/session';
import { callBotModuleAction } from '../../../../lib/botApi';

export const GET: APIRoute = async ({ params, cookies }) => {
  const session = await getSession(cookies);
  if (!session) {
    return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), { status: 401 });
  }

  const guildId = params.guildId;
  if (!guildId) {
    return new Response(JSON.stringify({ ok: false, error: 'missing_guild_id' }), { status: 400 });
  }

  try {
    const data = await callBotModuleAction('guild', 'channels', guildId);
    return new Response(JSON.stringify({ ok: true, ...data }), { status: 200 });
  } catch (err) {
    console.error('Channel-Fetch fehlgeschlagen:', err);
    return new Response(JSON.stringify({ ok: false, error: 'bot_unreachable' }), { status: 502 });
  }
};
