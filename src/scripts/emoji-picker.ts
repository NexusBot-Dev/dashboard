// Verhalten der Emoji-Auswahl (src/components/EmojiPicker.astro).
// Die Picker-Bibliothek und die Emoji-Daten werden erst beim ersten Öffnen geladen,
// die Daten liegen im eigenen Build (keine Anfrage an fremde Server).
import type Picker from 'emoji-picker-element/picker';
import type { EmojiClickEventDetail, I18n } from 'emoji-picker-element/shared';
import { customEmojiName, customEmojiUrl, isUnicodeEmoji } from '../lib/emoji';

import dataDe from 'emoji-picker-element-data/de/cldr/data.json?url';
import dataEn from 'emoji-picker-element-data/en/cldr/data.json?url';
import dataEs from 'emoji-picker-element-data/es/cldr/data.json?url';
import dataPt from 'emoji-picker-element-data/pt/cldr/data.json?url';

interface PickerConfig {
  lang: string;
  serverCategory: string;
  serverEmojis: { name: string; url: string; code: string }[];
}

// Twemoji-Schrift enthält Emojis bis Version 15.0 – neuere würden als leere Kästchen erscheinen
// (und Discord kennt sie oft noch nicht)
export const MAX_EMOJI_VERSION = 15;

const LOCALES: Record<string, { dataSource: string; i18n: () => Promise<{ default: I18n }> }> = {
  de: { dataSource: dataDe, i18n: () => import('emoji-picker-element/i18n/de.js') },
  en: { dataSource: dataEn, i18n: () => import('emoji-picker-element/i18n/en.js') },
  es: { dataSource: dataEs, i18n: () => import('emoji-picker-element/i18n/es.js') },
  pt: { dataSource: dataPt, i18n: () => import('emoji-picker-element/i18n/pt_BR.js') },
};

const PICKER_STYLE = [
  '--background: #0f172a',            // slate-900
  '--border-color: #334155',          // slate-700
  '--border-size: 1px',
  '--input-border-color: #334155',
  '--input-font-color: #f8fafc',
  '--input-placeholder-color: #94a3b8',
  '--indicator-color: #00F5D4',       // primary-500
  '--button-hover-background: #1e293b',
  '--button-active-background: #334155',
  '--outline-color: #00F5D4',
  '--category-font-color: #cbd5e1',
  '--emoji-font-family: Twemoji',
].join(';');

/** Vorschau im Button: gewähltes Emoji oder grauer Smiley */
function renderPreview(preview: HTMLElement, value: string) {
  preview.replaceChildren();
  preview.classList.remove('opacity-40', 'grayscale');
  const url = customEmojiUrl(value);
  if (url) {
    const img = document.createElement('img');
    img.src = url;
    img.alt = customEmojiName(value) ?? '';
    img.className = 'w-6 h-6 object-contain';
    preview.append(img);
  } else if (isUnicodeEmoji(value)) {
    preview.textContent = value;
  } else {
    preview.textContent = '😀';
    preview.classList.add('opacity-40', 'grayscale');
  }
}

async function createPicker(config: PickerConfig): Promise<Picker> {
  const locale = LOCALES[config.lang] ?? LOCALES.en;
  const [{ default: PickerElement }, { default: baseI18n }] = await Promise.all([
    import('emoji-picker-element/picker.js'),
    locale.i18n(),
  ]);
  // Tab der Server-Emojis wie die Kategorie benennen (statt „Benutzerdefiniert“)
  const i18n = { ...baseI18n, categories: { ...baseI18n.categories, custom: config.serverCategory } };
  const picker = new PickerElement({
    locale: config.lang in LOCALES ? config.lang : 'en',
    dataSource: locale.dataSource,
    i18n,
    emojiVersion: MAX_EMOJI_VERSION,
    // Ohne eigene category landen sie in der Kategorie „custom“, die oben als Server-Emojis benannt ist
    customEmoji: config.serverEmojis.map((e) => ({ name: e.name, shortcodes: [e.name], url: e.url })),
  });
  picker.classList.add('dark', 'nexus-emoji-picker'); // Größe: src/styles/global.css
  picker.setAttribute('style', PICKER_STYLE);
  return picker;
}

function setupPicker(root: HTMLElement) {
  const input = document.getElementById(root.dataset.emojiPicker ?? '') as HTMLInputElement | null;
  const toggle = root.querySelector<HTMLButtonElement>('[data-emoji-picker-toggle]');
  const popover = root.querySelector<HTMLElement>('[data-emoji-picker-popover]');
  const preview = root.querySelector<HTMLElement>('[data-emoji-picker-preview]');
  if (!input || !toggle || !popover || !preview) return;

  const config = JSON.parse(root.dataset.config ?? '{}') as PickerConfig;
  // Server-Emojis über die Bild-URL wiederfinden (Namen können doppelt vorkommen)
  const codeByUrl = new Map(config.serverEmojis.map((e) => [e.url, e.code]));
  let picker: Promise<Picker> | null = null;

  // Als Popover im Top-Layer: liegt über allem und wird von keinem Container abgeschnitten.
  // Die Position richtet sich nach dem Button und bleibt im sichtbaren Bereich.
  const place = () => {
    const margin = 8;
    const button = toggle.getBoundingClientRect();
    const { offsetWidth: width, offsetHeight: height } = popover;
    const left = Math.max(margin, Math.min(button.left, innerWidth - width - margin));
    let top = button.bottom + margin;
    if (top + height > innerHeight - margin) {
      // Unten kein Platz: darüber, und passt es auch dort nicht (kleines Handy), so weit hoch wie nötig
      top = button.top - margin - height >= margin
        ? button.top - margin - height
        : Math.max(margin, innerHeight - height - margin);
    }
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
  };
  const isOpen = () => popover.matches(':popover-open');
  const close = () => {
    if (!isOpen()) return;
    popover.hidePopover();
    removeEventListener('resize', place);
    removeEventListener('scroll', place, true);
    toggle.setAttribute('aria-expanded', 'false');
  };
  const open = async () => {
    popover.showPopover();
    place();
    addEventListener('resize', place);
    addEventListener('scroll', place, true);
    toggle.setAttribute('aria-expanded', 'true');
    picker ??= createPicker(config).then((el) => {
      el.addEventListener('emoji-click', (event) => {
        const detail: EmojiClickEventDetail = event.detail;
        const value = detail.unicode ?? codeByUrl.get((detail.emoji as { url?: string }).url ?? '') ?? '';
        if (!value) return;
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        close();
        input.focus();
      });
      popover.append(el);
      return el;
    });
    const el = await picker;
    place(); // jetzt mit der echten Größe des Pickers
    el.shadowRoot?.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
  };

  toggle.addEventListener('click', () => (isOpen() ? close() : void open()));
  input.addEventListener('input', () => renderPreview(preview, input.value.trim()));
  renderPreview(preview, input.value.trim());

  root.addEventListener('emoji-picker:close', close);
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isOpen()) {
      event.stopPropagation();
      close();
      toggle.focus();
    }
  });
}

// Klick daneben schließt offene Auswahlen. Nur ein Listener für alle Seiten: das document
// bleibt beim Seitenwechsel über den ClientRouter bestehen.
let outsideClickBound = false;
function bindOutsideClick() {
  if (outsideClickBound) return;
  outsideClickBound = true;
  document.addEventListener('click', (event) => {
    document.querySelectorAll<HTMLElement>('[data-emoji-picker]').forEach((root) => {
      if (!root.contains(event.target as Node)) root.dispatchEvent(new Event('emoji-picker:close'));
    });
  });
}

/** Verdrahtet alle Emoji-Auswahlen der Seite (mehrfacher Aufruf ist unschädlich). */
export function setupEmojiPickers() {
  bindOutsideClick();
  document.querySelectorAll<HTMLElement>('[data-emoji-picker]').forEach((root) => {
    if (root.dataset.bound === 'true') return;
    root.dataset.bound = 'true';
    setupPicker(root);
  });
}

/** Vorschau neu zeichnen, nachdem ein Skript den Wert des Felds gesetzt hat. */
export function refreshEmojiPreview(inputId: string) {
  document.getElementById(inputId)?.dispatchEvent(new Event('input', { bubbles: true }));
}
