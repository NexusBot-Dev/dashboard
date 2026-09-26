import type { AstroCookies } from 'astro';
import de from './de.json';
import en from './en.json';

const dictionaries = { de, en } as const;
export type Lang = keyof typeof dictionaries;

export const SUPPORTED_LANGS: Lang[] = ['de', 'en'];
export const DEFAULT_LANG: Lang = 'de';

const LANG_COOKIE = 'nexus_lang';

function isLang(value: string | undefined): value is Lang {
  return !!value && SUPPORTED_LANGS.includes(value as Lang);
}

export function getLang(cookies: AstroCookies): Lang {
  const cookieVal = cookies.get(LANG_COOKIE)?.value;
  if (isLang(cookieVal)) return cookieVal;
  return DEFAULT_LANG;
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