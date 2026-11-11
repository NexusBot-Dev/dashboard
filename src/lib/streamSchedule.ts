// Streamplan als Discord-Events: Daten vom Bot (stream_alerts/schedule) und die Texte einer Zeile.
// Server (Astro) und Browser (src/scripts/pages/stream-alerts.ts) nutzen dieselben Funktionen.

export interface ScheduleEntry {
  monitored_channel_id: number;
  streamer_name: string;
  enabled: boolean;
  active: boolean;        // eingeschaltet und im Limit
  error: ScheduleError | null;
  events: number;         // kommende Events, die der Bot angelegt hat
  image_source?: ScheduleImageSource;   // ältere Bots schicken es nicht — dann keine Auswahl
  custom_text?: string | null;          // gespeicherter eigener Text (gilt nur mit Premium); ältere Bots: fehlt
  custom_image_hash?: string | null;    // eigenes Bild gespeichert? (Bild selbst: schedule-custom-image)
}

export type ScheduleImageSource = 'banner' | 'offline' | 'none' | 'custom';
export const SCHEDULE_IMAGE_SOURCES: ScheduleImageSource[] = ['banner', 'offline', 'none', 'custom'];

// Eigener Text: Platzhalter und Länge wie im Bot (systems/stream_schedule.py: TEXT_PLACEHOLDERS, MAX_TEXT_LENGTH)
export const SCHEDULE_TEXT_PLACEHOLDERS = ['title', 'category', 'link', 'streamer'] as const;
export const SCHEDULE_MAX_TEXT_LENGTH = 800;
// Eigenes Bild: so groß wie das Bild im Discord-Event (der Bot schneidet genauso zu)
// Doppelte Mindestgröße von Discord (800×320): auf hochauflösenden Bildschirmen sonst unscharf. Wie im Bot.
export const SCHEDULE_IMAGE_WIDTH = 1600;
export const SCHEDULE_IMAGE_HEIGHT = 640;
// Der Bot nimmt höchstens 1 MiB pro Anfrage an; Base64 bis hier lässt Platz für den Text
export const SCHEDULE_IMAGE_MAX_BASE64 = 900_000;
// JPEG-Qualitäten, von der besten abwärts, bis das Bild unter die Grenze passt
export const SCHEDULE_IMAGE_QUALITIES = [0.95, 0.9, 0.85, 0.8, 0.7, 0.6, 0.5];

export type ScheduleError = 'missing_permission' | 'no_schedule' | 'twitch_error' | 'discord_error';

export interface ScheduleOverview {
  entries: ScheduleEntry[];
  limit: number;
  premium_limit: number;
  days: number;
  premium_days: number;
  premium_active: boolean;
  can_create_events: boolean;
  available?: boolean;     // false: Testphase, auf diesem Server noch nicht nutzbar (ältere Bots schicken es nicht)
}

export interface ScheduleTexts {
  off: string;
  inactive: string;
  events: string;         // enthält "{count}"
  errors: Record<ScheduleError, string>;
  limitReached: string;   // enthält "{limit}"
  limitPremium: string;   // enthält "{limit}" und "{max}"
  images: Record<ScheduleImageSource, string>;   // Namen der Bildquellen für die Auswahl
  customButton: string;   // Button „Text & Bild“
  customSet: string;      // Zusatz in der Statuszeile, wenn ein eigener Text gilt
}

/** Bildquelle wählbar? Nur für eingeschaltete Kanäle — und nur, wenn der Bot sie kennt (neuere Versionen). */
export const scheduleImageSelectable = (entry: ScheduleEntry) => entry.enabled && entry.image_source !== undefined;

/** Wählbare Bildquellen: „Eigenes Bild“ nur mit Premium und gespeichertem Bild (wie im Discord-Panel). */
export function scheduleImageOptions(entry: ScheduleEntry, premium: boolean): ScheduleImageSource[] {
  return SCHEDULE_IMAGE_SOURCES.filter((source) => source !== 'custom' || (premium && Boolean(entry.custom_image_hash)));
}

/** Button „Text & Bild“: für eingeschaltete Kanäle, wenn der Bot die Funktion kennt (neuere Versionen). */
export const scheduleCustomEditable = (entry: ScheduleEntry) => entry.enabled && entry.custom_text !== undefined;

/** Eigener Text mit Platzhaltern füllen — wie render_text im Bot: unbekannte Platzhalter bleiben stehen. */
export function renderScheduleText(template: string, values: Record<(typeof SCHEDULE_TEXT_PLACEHOLDERS)[number], string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (Object.hasOwn(values, key) ? values[key as keyof typeof values] : match));
}

/** Ausschnitt eines Bildes im Seitenverhältnis des Event-Bildes (5:2). position 0–1 verschiebt ihn entlang der
 *  Seite, die übersteht (0 = links bzw. oben, 0,5 = Mitte wie beim Bot). */
export function scheduleCropRect(width: number, height: number, position = 0.5): { x: number; y: number; width: number; height: number } {
  const ratio = SCHEDULE_IMAGE_WIDTH / SCHEDULE_IMAGE_HEIGHT;
  const p = Math.min(1, Math.max(0, position));
  if (width / height > ratio) {
    const w = Math.round(height * ratio);
    return { x: Math.round((width - w) * p), y: 0, width: w, height };
  }
  const h = Math.round(width / ratio);
  return { x: 0, y: Math.round((height - h) * p), width, height: h };
}

/** Status und (falls vorhanden) Fehler einer Zeile */
export function scheduleRowText(entry: ScheduleEntry, texts: ScheduleTexts, premium = false): { status: string; error: string } {
  if (!entry.enabled) return { status: texts.off, error: '' };
  if (!entry.active) return { status: texts.inactive, error: '' };
  return {
    status: texts.events.replace('{count}', String(entry.events)) + (premium && entry.custom_text ? ` · ${texts.customSet}` : ''),
    error: entry.error ? texts.errors[entry.error] ?? '' : '',
  };
}

/** Limit erreicht: Ausgeschaltete lassen sich nicht mehr einschalten. Text mit Premium-Hinweis, wenn mehr möglich wäre. */
export function scheduleLimitNote(overview: ScheduleOverview, texts: ScheduleTexts): string {
  const used = overview.entries.filter((e) => e.enabled).length;
  if (used < overview.limit) return '';
  const template = !overview.premium_active && overview.premium_limit > overview.limit ? texts.limitPremium : texts.limitReached;
  return template.replace('{limit}', String(overview.limit)).replace('{max}', String(overview.premium_limit));
}

/** Darf der Schalter dieser Zeile umgelegt werden? Ausschalten geht immer, Einschalten nur unter dem Limit. */
export function scheduleCanToggle(entry: ScheduleEntry, overview: ScheduleOverview): boolean {
  return entry.enabled || overview.entries.filter((e) => e.enabled).length < overview.limit;
}
