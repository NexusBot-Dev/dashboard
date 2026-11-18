import type { APIRoute } from 'astro';
import { callBotModuleAction, isValidActionName, BotApiError } from '../../../../../../lib/botApi';
import { jsonResponse } from '../../../../../../lib/jsonResponse';
import { apiErrorMessage } from '../../../../../../lib/apiErrors';
import { readJsonObject } from '../../../../../../lib/requestGuard';

export const POST: APIRoute = async ({ params, request, locals }) => {
  // Session hat die Middleware schon geladen (und ohne Session mit 401 abgelehnt)
  const session = locals.session;
  if (!session) {
    return jsonResponse({ ok: false, error: apiErrorMessage(locals.t, 'unauthorized') }, 401);
  }

  const { guildId, module, action } = params;
  if (!guildId || !module || !action || !isValidActionName(module, action)) {
    return jsonResponse({ ok: false, error: apiErrorMessage(locals.t, 'invalid_request') }, 400);
  }

  // Leerer Body ist erlaubt (z. B. "list"), kaputtes JSON nicht — sonst liefe die Aktion mit {}
  const body = await readJsonObject(request);
  if (!body) {
    return jsonResponse({ ok: false, error: apiErrorMessage(locals.t, 'invalid_request') }, 400);
  }

  try {
    const data = await callBotModuleAction(module, action, guildId, body, session.discordUserId, locals.lang);
    return jsonResponse({ ok: true, data });
  } catch (err) {
    console.error(`Modul-Aktion fehlgeschlagen (${module}/${action}):`, err);

    // Der Bot ist erreichbar, drosselt aber — das ist nicht "offline".
    if (err instanceof BotApiError && err.isRateLimited) {
      return jsonResponse(
        { ok: false, error: apiErrorMessage(locals.t, 'rate_limited'), retry_after: err.retryAfter ?? null },
        429,
      );
    }

    // Der Bot hat geantwortet, die Aktion aber fachlich abgelehnt (z.B. fehlende Rechte) —
    // seine Meldung durchreichen. Nur Netzwerkfehler und 5xx heißen wirklich "nicht erreichbar".
    if (err instanceof BotApiError && err.status >= 400 && err.status < 500) {
      return jsonResponse({ ok: false, error: apiErrorMessage(locals.t, err.code) }, err.status);
    }

    return jsonResponse({ ok: false, error: apiErrorMessage(locals.t, 'bot_unreachable') }, 502);
  }
};