// Fehlercodes der API-Kette (Astro-Proxy, Middleware, Bot-Middleware) als lesbare Meldung.
// Der Bot schickt fachliche Fehler bereits übersetzt (Dashboard-Sprache) — die kommen hier unverändert durch.
// Nur technische Codes in snake_case werden übersetzt; unbekannte als "Unbekannter Fehler (code)".

type Translate = (key: string, vars?: Record<string, string | number>) => string;

const KNOWN_CODES = new Set([
  'rate_limited',
  'bot_unreachable',
  'discord_unavailable',
  'guild_access_denied',
  'forbidden',
  'unauthorized',
  'internal_error',
  'invalid_request',
]);

const TECHNICAL_CODE = /^[a-z][a-z0-9_]*$/;

export function apiErrorMessage(t: Translate, error: unknown): string {
  if (typeof error !== 'string' || !TECHNICAL_CODE.test(error)) return String(error ?? '');
  if (KNOWN_CODES.has(error)) return t(`api_errors.${error}`);
  return t('api_errors.unknown', { code: error });
}
