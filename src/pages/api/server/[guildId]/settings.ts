import type { APIRoute } from 'astro';
import { getSession } from '../../../../lib/session';
import { DASHBOARD_TOKEN, BOT_INTERNAL_URL } from '../../../../lib/secrets';
import { apiErrorMessage } from '../../../../lib/apiErrors';

export const POST: APIRoute = async ({ params, request, cookies, locals }) => {
  const session = await getSession(cookies);
  if (!session) {
    return new Response(JSON.stringify({ ok: false, error: apiErrorMessage(locals.t, 'unauthorized') }), { status: 401 });
  }

  const guildId = params.guildId;
  if (!guildId) {
    return new Response(JSON.stringify({ ok: false, error: apiErrorMessage(locals.t, 'missing_guild_id') }), { status: 400 });
  }

  let fields: unknown;
  try {
    fields = await request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: apiErrorMessage(locals.t, 'invalid_json') }), { status: 400 });
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
        acting_user_id: session.discordUserId,
        lang: locals.lang,
      }),
    });

    const data = await botResponse.json();
    // Fachliche Fehler kommen vom Bot schon übersetzt, technische Codes (z. B. rate_limited) noch nicht
    if (data && typeof data === 'object' && 'error' in data) data.error = apiErrorMessage(locals.t, data.error);
    return new Response(JSON.stringify(data), { status: botResponse.status });
  } catch (err) {
    console.error('Bot-API nicht erreichbar:', err);
    return new Response(JSON.stringify({ ok: false, error: apiErrorMessage(locals.t, 'bot_unreachable') }), { status: 502 });
  }
};
