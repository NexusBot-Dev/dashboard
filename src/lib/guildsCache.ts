import { getDiscordUserGuilds as fetchGuildsFromDiscord, DiscordApiError } from './oauth';

interface CacheEntry {
  guilds: any[];
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();
const pendingRequests = new Map<string, Promise<any[]>>();
const blockedUntil = new Map<string, number>();

const TTL_MS = 5 * 60 * 1000;             // so lange gelten die Daten als frisch
const MAX_STALE_MS = 10 * 60 * 1000;      // so lange darf bei Discord-Problemen der alte Stand dienen
const MIN_FORCE_INTERVAL_MS = 30 * 1000;  // ?refresh=1 wirkt höchstens alle 30 s
const MAX_ENTRIES = 500;

export async function getCachedUserGuilds(
  accessToken: string,
  forceRefresh = false,
  allowStale = true
): Promise<any[]> {
  const now = Date.now();
  const cached = cache.get(accessToken);
  const age = cached ? now - cached.fetchedAt : Infinity;

  if (forceRefresh && age < MIN_FORCE_INTERVAL_MS) forceRefresh = false;

  // 1. Frischer Cache-Hit
  if (!forceRefresh && age < TTL_MS) return cached!.guilds;

  // 2. Discord drosselt dieses Token: nicht nachfragen, alten Stand nutzen
  if ((blockedUntil.get(accessToken) ?? 0) > now) {
    if (cached && age < MAX_STALE_MS) return cached.guilds;
    throw new DiscordApiError('Discord Rate-Limit', 429);
  }

  // 3. Stale-While-Revalidate (nur für unkritische Aufrufe)
  if (!forceRefresh && allowStale && cached && age < MAX_STALE_MS) {
    _fetchAndCacheGuilds(accessToken).catch((err) => {
      console.warn('Hintergrund-Refresh der Guild-Liste fehlgeschlagen:', err.message);
    });
    return cached.guilds;
  }

  // 4. Blockierend holen, bei Discord-Fehlern notfalls alter Stand
  try {
    return await _fetchAndCacheGuilds(accessToken);
  } catch (err) {
    const tokenInvalid = err instanceof DiscordApiError && err.status === 401;
    if (cached && age < MAX_STALE_MS && !tokenInvalid) return cached.guilds;
    throw err;
  }
}

async function _fetchAndCacheGuilds(accessToken: string): Promise<any[]> {
  const existing = pendingRequests.get(accessToken);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const guilds = await fetchGuildsFromDiscord(accessToken);
      cache.delete(accessToken); // ans Ende der Einfüge-Reihenfolge
      cache.set(accessToken, { guilds, fetchedAt: Date.now() });
      blockedUntil.delete(accessToken);
      while (cache.size > MAX_ENTRIES) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined) break;
        cache.delete(oldest);
      }
      return guilds;
    } catch (err) {
      if (err instanceof DiscordApiError) {
        if (err.status === 429) {
          const seconds = Math.min(Math.max(err.retryAfter ?? 5, 1), 900);
          blockedUntil.set(accessToken, Date.now() + seconds * 1000);
          console.warn(`Discord 429 auf /users/@me/guilds, Abrufe für dieses Token pausiert (${seconds}s)`);
        } else if (err.status === 401) {
          cache.delete(accessToken);
        }
      }
      throw err;
    } finally {
      pendingRequests.delete(accessToken);
    }
  })();

  pendingRequests.set(accessToken, promise);
  return promise;
}