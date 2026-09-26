import { getDiscordUserGuilds as fetchGuildsFromDiscord } from './oauth';

interface CacheEntry {
  guilds: any[];
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const pendingRequests = new Map<string, Promise<any[]>>();

// TTL: Wie lange Daten als absolut frisch gelten
const TTL_MS = 5 * 60 * 1000;

/**
 * @param accessToken Discord Access-Token des Users
 * @param forceRefresh true = Cache komplett ignorieren, immer frisch holen
 * @param allowStale true = bei abgelaufenem Cache sofort den alten Wert zurückgeben
 *   und im Hintergrund aktualisieren (schnell, aber ggf. veraltet).
 *   false = bei abgelaufenem Cache blockierend auf die frische Antwort warten
 *   (langsamer, aber garantiert aktuell — für Autorisierungs-Checks).
 */
export async function getCachedUserGuilds(
  accessToken: string,
  forceRefresh = false,
  allowStale = true
): Promise<any[]> {
  const now = Date.now();
  const cached = cache.get(accessToken);

  // 1. Frischer Cache-Hit
  if (!forceRefresh && cached && cached.expiresAt > now) {
    return cached.guilds;
  }

  // 2. Stale-While-Revalidate
  if (!forceRefresh && allowStale && cached) {
    _fetchAndCacheGuilds(accessToken).catch((err) => {
      console.warn('Hintergrund-Refresh der Guild-Liste fehlgeschlagen:', err.message);
    });
    return cached.guilds;
  }

  // 3. Kein Cache, forceRefresh, oder allowStale=false bei abgelaufenem Cache
  return await _fetchAndCacheGuilds(accessToken);
}

async function _fetchAndCacheGuilds(accessToken: string): Promise<any[]> {
  if (pendingRequests.has(accessToken)) {
    return pendingRequests.get(accessToken)!;
  }

  const promise = (async () => {
    try {
      const guilds = await fetchGuildsFromDiscord(accessToken);
      cache.set(accessToken, { guilds, expiresAt: Date.now() + TTL_MS });
      if (cache.size > 500) {
        const oldestKey = cache.keys().next().value;
        if (oldestKey) cache.delete(oldestKey);
      }
      return guilds;
    } finally {
      pendingRequests.delete(accessToken);
    }
  })();

  pendingRequests.set(accessToken, promise);
  return promise;
}