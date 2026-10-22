import { DASHBOARD_TOKEN, BOT_INTERNAL_URL } from './secrets';

export class BotApiError extends Error {
  code: string;
  status: number;
  retryAfter?: number; // Sekunden, falls der Bot einen Wert mitschickt

  constructor(code: string, status: number, retryAfter?: number) {
    super(code);
    this.name = 'BotApiError';
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }

  get isRateLimited(): boolean {
    return this.code === 'rate_limited' || this.status === 429;
  }
}

const CACHE_TTL_MS = 30 * 1000;
const STALE_MAX_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 500;
const RETRY_MAX_WAIT_MS = 2000;
const RETRY_GIVE_UP_AFTER_S = 3;

const CACHEABLE = new Set(['guild/info', 'guild/channels', 'guild/roles', 'guild/emojis']);

const cache = new Map<string, { data: unknown; at: number }>();
const inflight = new Map<string, Promise<unknown>>();

function isReadAction(module: string, action: string): boolean {
  return (
    CACHEABLE.has(`${module}/${action}`) ||
    action === 'list' ||
    action.startsWith('list-') ||
    action === 'status' ||
    action === 'overview' ||
    action === 'health-issues'
  );
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function rawCall(
  module: string,
  action: string,
  guildId: string,
  extra: Record<string, unknown>,
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

  let data: any = null;
  try {
    data = await res.json();
  } catch {
    // keine JSON-Antwort (z. B. Proxy-Fehlerseite) — unten als Fehler behandelt
  }

  if (!data || !data.ok) {
    const code: string = data?.error ?? (res.status === 429 ? 'rate_limited' : `bot_http_${res.status}`);
    const headerValue = Number(res.headers.get('retry-after'));
    const retryAfter = Number(data?.retry_after) || (headerValue > 0 ? headerValue : undefined);
    throw new BotApiError(code, res.status, retryAfter);
  }
  return data.data;
}

async function callWithRetry(
  module: string,
  action: string,
  guildId: string,
  extra: Record<string, unknown>,
  actingUserId?: string,
  accessToken?: string
) {
  try {
    return await rawCall(module, action, guildId, extra, actingUserId, accessToken);
  } catch (err) {
    if (
      err instanceof BotApiError &&
      err.isRateLimited &&
      isReadAction(module, action) &&
      !(err.retryAfter && err.retryAfter > RETRY_GIVE_UP_AFTER_S)
    ) {
      const wait = Math.min(Math.max((err.retryAfter ?? 1) * 1000, 300), RETRY_MAX_WAIT_MS);
      await sleep(wait);
      return rawCall(module, action, guildId, extra, actingUserId, accessToken);
    }
    throw err;
  }
}

export async function callBotModuleAction(
  module: string,
  action: string,
  guildId: string,
  extra: Record<string, unknown> = {},
  actingUserId?: string,
  accessToken?: string
) {
  const cacheable = CACHEABLE.has(`${module}/${action}`) && Object.keys(extra).length === 0;
  if (!cacheable) {
    return callWithRetry(module, action, guildId, extra, actingUserId, accessToken);
  }

  const key = `${guildId}:${module}/${action}`;

  // 1. Frischer Cache-Hit
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

  // 2. Läuft derselbe Call schon (z. B. Promise.all auf mehreren Seiten gleichzeitig)? Dranhängen.
  const pending = inflight.get(key);
  if (pending) return pending;

  // 3. Frisch holen; bei vorübergehenden Fehlern notfalls alter Stand
  const promise = (async () => {
    try {
      const data = await callWithRetry(module, action, guildId, extra, actingUserId, accessToken);
      cache.delete(key); // ans Ende der Einfüge-Reihenfolge
      cache.set(key, { data, at: Date.now() });
      while (cache.size > MAX_ENTRIES) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined) break;
        cache.delete(oldest);
      }
      return data;
    } catch (err) {
      const transient = !(err instanceof BotApiError) || err.isRateLimited || err.status >= 500;
      const stale = cache.get(key);
      if (transient && stale && Date.now() - stale.at < STALE_MAX_MS) return stale.data;
      throw err;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);
  return promise;
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