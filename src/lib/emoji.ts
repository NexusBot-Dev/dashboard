// Emoji-Helfer für Server (Astro) und Browser: Prüfen, ob eine Eingabe ein Emoji ist,
// und Server-Emojis (<:name:id>) als Bild darstellen.

// Ein oder mehrere Emoji-Zeichen samt Verbindern: ZWJ, Variation Selector, Hautton,
// Tasten-Emojis (1️⃣ = Ziffer + VS16 + Keycap) und Tag-Sequenzen (🏴󠁧󠁢󠁥󠁮󠁧󠁿)
const UNICODE_EMOJI_REGEX =
  /^(?:\p{Extended_Pictographic}|\p{Emoji_Presentation}|[0-9#*]️?⃣|[‍️⃣\u{E0020}-\u{E007F}])+$/u;
const CUSTOM_EMOJI_REGEX = /^<(a?):(\w+):(\d+)>$/;

export interface ServerEmoji {
  name: string;
  id: string;
  animated: boolean;
  url: string;
}

export const isUnicodeEmoji = (value: string) => UNICODE_EMOJI_REGEX.test(value);
export const isCustomEmoji = (value: string) => CUSTOM_EMOJI_REGEX.test(value);
export const isValidEmojiInput = (value: string) => isCustomEmoji(value) || isUnicodeEmoji(value);

/** Code, den Discord für ein Server-Emoji erwartet: <:name:id> bzw. <a:name:id> */
export const customEmojiCode = (e: Pick<ServerEmoji, 'name' | 'id' | 'animated'>) =>
  `<${e.animated ? 'a' : ''}:${e.name}:${e.id}>`;

/** Bild-URL zu <:name:id>; auch für Emojis, die es auf dem Server nicht mehr gibt */
export function customEmojiUrl(code: string): string | null {
  const match = CUSTOM_EMOJI_REGEX.exec(code);
  if (!match) return null;
  const [, animated, , id] = match;
  return `https://cdn.discordapp.com/emojis/${id}.${animated ? 'gif' : 'png'}`;
}

/** Name aus <:name:id> (für alt-Texte) */
export const customEmojiName = (code: string) => CUSTOM_EMOJI_REGEX.exec(code)?.[2] ?? null;
