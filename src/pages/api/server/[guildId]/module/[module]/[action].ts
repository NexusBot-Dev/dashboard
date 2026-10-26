import type { APIRoute } from 'astro';
import { getSession } from '../../../../../../lib/session';
import { callBotModuleAction, BotApiError } from '../../../../../../lib/botApi';

export const POST: APIRoute = async ({ params, request, cookies }) => {
  const session = await getSession(cookies);
  if (!session) {
    return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), { status: 401 });
  }

  const { guildId, module, action } = params;
  if (!guildId || !module || !action) {
    return new Response(JSON.stringify({ ok: false, error: 'invalid_request' }), { status: 400 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    // Manche Aktionen (z.B. "list") brauchen keinen Body — kein harter Fehler
  }

  try {
    const data = await callBotModuleAction(module, action, guildId, body, session.discordUserId);
    return new Response(JSON.stringify({ ok: true, data }), { status: 200 });
  } catch (err) {
    console.error(`Modul-Aktion fehlgeschlagen (${module}/${action}):`, err);

    // Der Bot ist erreichbar, drosselt aber — das ist nicht "offline".
    if (err instanceof BotApiError && err.isRateLimited) {
      return new Response(
        JSON.stringify({ ok: false, error: 'rate_limited', retry_after: err.retryAfter ?? null }),
        { status: 429 }
      );
    }

    // Der Bot hat geantwortet, die Aktion aber fachlich abgelehnt (z.B. fehlende Rechte) —
    // seine Meldung durchreichen. Nur Netzwerkfehler und 5xx heißen wirklich "nicht erreichbar".
    if (err instanceof BotApiError && err.status >= 400 && err.status < 500) {
      return new Response(JSON.stringify({ ok: false, error: err.code }), { status: err.status });
    }

    return new Response(JSON.stringify({ ok: false, error: 'bot_unreachable' }), { status: 502 });
  }
};