import type { APIRoute } from 'astro';
import { setLang, SUPPORTED_LANGS, type Lang } from '../../i18n';
 
export const POST: APIRoute = async ({ request, cookies }) => {
  const body = await request.json().catch(() => ({}));
  const lang = body?.lang;
 
  if (!SUPPORTED_LANGS.includes(lang)) {
    return new Response(JSON.stringify({ ok: false, error: 'Unbekannte Sprache' }), { status: 400 });
  }
 
  setLang(cookies, lang as Lang);
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};