import { defineMiddleware } from 'astro:middleware';
import { getSession } from './lib/session';
import { userHasGuildAccess } from './lib/guildAccess';
import { getLang, t as translate } from './i18n';
import { apiErrorMessage } from './lib/apiErrors';
import { OWNER_DISCORD_ID } from './lib/secrets';
import { OWNER_ONLY_MODULE_KEYS } from './config';
import { isForeignRequest, isJsonContentType, isWriteRequest } from './lib/requestGuard';

function isPublicPath(pathname: string): boolean {
  if (pathname === '/') return true;
  if (pathname.startsWith('/auth/')) return true;
  if (pathname.startsWith('/_astro/')) return true;
  if (pathname === '/favicon.svg' || pathname === '/robots.txt' || pathname === '/sitemap.xml') return true;
  if (pathname === '/api/set-lang' || pathname === '/api/set-lang/') return true;
  return false;
}

function extractGuildId(pathname: string): string | null {
  const match = pathname.match(/^\/(?:api\/)?server\/(\d+)\//);
  return match ? match[1] : null;
}

function extractModuleKey(pathname: string): string | null {
  const match =
    pathname.match(/^\/server\/\d+\/modules\/([a-z0-9-]+)\//) ||     // alte Adressen /modules/<key>/ (leiten weiter)
    pathname.match(/^\/server\/\d+\/([a-z0-9-]+)\//) ||               // Modul- und andere Seiten, z. B. /levels/
    pathname.match(/^\/api\/server\/\d+\/module\/([a-z0-9_-]+)\//);   // Modul-API
  return match ? match[1].replace(/_/g, '-') : null;
}

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ ok: false, error }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;

  // Sprache gilt für ALLE Requests, auch public paths (Login-Seite etc.)
  const lang = getLang(context.cookies, context.request.headers.get('accept-language'));
  context.locals.lang = lang;
  context.locals.t = (key: string, vars?: Record<string, string | number>) => translate(lang, key, vars);

  // Vor allem anderen (auch vor den öffentlichen Pfaden wie /api/set-lang und /auth/logout):
  // schreibende Anfragen nur von unseren eigenen Seiten, an die API nur als JSON.
  if (isWriteRequest(context.request)) {
    const isApiRoute = pathname.startsWith('/api/');
    if (isForeignRequest(context.request, context.url, import.meta.env.SITE)) {
      return isApiRoute
        ? jsonError(403, apiErrorMessage(context.locals.t, 'invalid_request'))
        : new Response('Anfrage von fremder Seite abgelehnt.', { status: 403 });
    }
    if (isApiRoute && !isJsonContentType(context.request)) {
      return jsonError(415, apiErrorMessage(context.locals.t, 'invalid_request'));
    }
  }

  if (isPublicPath(pathname)) {
    return next();
  }

  const session = await getSession(context.cookies);

  if (!session) {
    const isApiRoute = pathname.startsWith('/api/');
    if (isApiRoute) {
      return new Response(JSON.stringify({ ok: false, error: apiErrorMessage(context.locals.t, 'unauthorized') }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return context.redirect('/auth/login');
  }

  context.locals.session = session;

  const isOwner = Boolean(OWNER_DISCORD_ID && session.discordUserId === OWNER_DISCORD_ID);

  const moduleKey = extractModuleKey(pathname);
  if (moduleKey && OWNER_ONLY_MODULE_KEYS.includes(moduleKey) && !isOwner) {
    const isApiRoute = pathname.startsWith('/api/');
    if (isApiRoute) {
      return new Response(JSON.stringify({ ok: false, error: 'not_found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('Nicht gefunden.', { status: 404 });
  }

  const guildId = extractGuildId(pathname);
  if (guildId) {
    const hasAccess = await userHasGuildAccess(session.accessToken, guildId);
    if (!hasAccess) {
      const isApiRoute = pathname.startsWith('/api/');
      if (isApiRoute) {
        return new Response(JSON.stringify({ ok: false, error: apiErrorMessage(context.locals.t, 'forbidden') }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return context.redirect('/server');
    }
  }

  return next();
});
