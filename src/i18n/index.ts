import type { AstroCookies } from 'astro';
import de from './de.json';
import en from './en.json';
import es from './es.json';
import pt from './pt.json';

const dictionaries = { de, en, es, pt } as const;
export type Lang = keyof typeof dictionaries;

export const SUPPORTED_LANGS: Lang[] = ['de', 'en'];
export const DEFAULT_LANG: Lang = 'en';

const INTL_LOCALES: Record<Lang, string> = { de: 'de-DE', en: 'en-US', es: 'es-MX', pt: 'pt-BR' };
export const intlLocale = (lang: Lang) => INTL_LOCALES[lang];

const LANG_COOKIE = 'nexus_lang';

function isLang(value: string | undefined): value is Lang {
  return !!value && SUPPORTED_LANGS.includes(value as Lang);
}

function fromAcceptLanguage(header: string | null | undefined): Lang | null {
  if (!header) return null;
  const candidates = header
    .split(',')
    .map((part) => {
      const [tag, q] = part.trim().split(';q=');
      return { lang: tag.split('-')[0].toLowerCase(), q: q ? parseFloat(q) : 1 };
    })
    .sort((a, b) => b.q - a.q);
  for (const c of candidates) {
    if (isLang(c.lang)) return c.lang;
  }
  return null;
}

export function getLang(cookies: AstroCookies, acceptLanguage?: string | null): Lang {
  const cookieVal = cookies.get(LANG_COOKIE)?.value;
  if (isLang(cookieVal)) return cookieVal;
  return fromAcceptLanguage(acceptLanguage) ?? DEFAULT_LANG;
}

export function setLang(cookies: AstroCookies, lang: Lang) {
  cookies.set(LANG_COOKIE, lang, {
    httpOnly: false, // muss vom Client lesbar/setzbar sein (Switcher)
    secure: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365,
    path: '/',
  });
}

function getNested(obj: any, path: string): string | undefined {
  return path.split('.').reduce((o, k) => o?.[k], obj);
}

export function t(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  let str = getNested(dictionaries[lang], key) ?? getNested(dictionaries[DEFAULT_LANG], key) ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.replace(`{${k}}`, String(v));
    }
  }
  return str;
}