import type { APIRoute } from 'astro';
import { getSession } from '../../../../lib/session';
import { DASHBOARD_TOKEN, BOT_INTERNAL_URL } from '../../../../lib/secrets';

export const POST: APIRoute = async ({ params, request, cookies }) => {
  const session = await getSession(cookies);
  if (!session) {
    return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), { status: 401 });
  }

  const guildId = params.guildId;
  if (!guildId) {
    return new Response(JSON.stringify({ ok: false, error: 'missing_guild_id' }), { status: 400 });
  }

  let fields: unknown;
  try {
    fields = await request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'invalid_json' }), { status: 400 });
  }

  try {
    const botResponse = await fetch(`${BOT_INTERNAL_URL}/api/dashboard/settings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${DASHBOARD_TOKEN}`,
      },
      body: JSON.stringify({
        guild_id: guildId,
        fields,
        discord_access_token: session.accessToken,
      }),
    });

    const data = await botResponse.json();
    return new Response(JSON.stringify(data), { status: botResponse.status });
  } catch (err) {
    console.error('Bot-API nicht erreichbar:', err);
    return new Response(JSON.stringify({ ok: false, error: 'bot_unreachable' }), { status: 502 });
  }
};