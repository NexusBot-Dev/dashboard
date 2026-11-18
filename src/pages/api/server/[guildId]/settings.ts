import type { APIRoute } from 'astro';
import { DASHBOARD_TOKEN, BOT_INTERNAL_URL } from '../../../../lib/secrets';
import { apiErrorMessage } from '../../../../lib/apiErrors';
import { jsonResponse } from '../../../../lib/jsonResponse';

export const POST: APIRoute = async ({ params, request, locals }) => {
  // Session hat die Middleware schon geladen (und ohne Session mit 401 abgelehnt)
  const session = locals.session;
  if (!session) {
    return jsonResponse({ ok: false, error: apiErrorMessage(locals.t, 'unauthorized') }, 401);
  }

  const guildId = params.guildId;
  if (!guildId) {
    return jsonResponse({ ok: false, error: apiErrorMessage(locals.t, 'missing_guild_id') }, 400);
  }

  let fields: unknown;
  try {
    fields = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: apiErrorMessage(locals.t, 'invalid_json') }, 400);
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
    return jsonResponse(data, botResponse.status);
  } catch (err) {
    console.error('Bot-API nicht erreichbar:', err);
    return jsonResponse({ ok: false, error: apiErrorMessage(locals.t, 'bot_unreachable') }, 502);
  }
};
