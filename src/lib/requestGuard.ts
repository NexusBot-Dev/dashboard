// Schutz gegen Anfragen, die eine fremde Seite (auch eine andere Subdomain von trynexus.de)
// über den Browser eines eingeloggten Nutzers auslöst. SameSite=Lax schickt das Session-Cookie
// zwischen Subdomains mit, deshalb prüfen wir die Herkunft selbst, statt uns nur auf Astros
// eingebauten Origin-Check zu verlassen (der prüft JSON-Anfragen erst ab Astro 8).

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function isWriteRequest(request: Request): boolean {
  return !SAFE_METHODS.has(request.method);
}

/**
 * true, wenn die Anfrage nicht von unseren eigenen Seiten kommt. Browser setzen Sec-Fetch-Site
 * (same-origin = dieselbe Adresse, same-site = andere Subdomain); ohne den Header entscheidet Origin.
 * Fehlen beide, lehnen wir ab — das Dashboard wird nur aus dem Browser angesprochen.
 * `site` ist die öffentliche Adresse (astro.config `site`): hinter nginx kann url.origin abweichen.
 */
export function isForeignRequest(request: Request, url: URL, site?: string): boolean {
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite) return fetchSite !== 'same-origin';

  const origin = request.headers.get('origin');
  if (!origin) return true;
  if (origin === url.origin) return false;
  return !site || origin !== new URL(site).origin;
}

/** Nur application/json (Parameter wie charset erlaubt). Formulare und text/plain kämen ohne Preflight durch. */
export function isJsonContentType(request: Request): boolean {
  const mediaType = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  return mediaType === 'application/json';
}

/**
 * JSON-Body als Objekt lesen. Leerer Body = {} (manche Aktionen brauchen keine Daten),
 * kaputtes JSON oder etwas anderes als ein Objekt = null.
 */
export async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  const raw = await request.text();
  if (!raw.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}
