// Streamplan als Discord-Events: Daten vom Bot (stream_alerts/schedule) und die Texte einer Zeile.
// Server (Astro) und Browser (src/scripts/pages/stream-alerts.ts) nutzen dieselben Funktionen.

export interface ScheduleEntry {
  monitored_channel_id: number;
  streamer_name: string;
  enabled: boolean;
  active: boolean;        // eingeschaltet und im Limit
  error: ScheduleError | null;
  events: number;         // kommende Events, die der Bot angelegt hat
}

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
}

/** Status und (falls vorhanden) Fehler einer Zeile */
export function scheduleRowText(entry: ScheduleEntry, texts: ScheduleTexts): { status: string; error: string } {
  if (!entry.enabled) return { status: texts.off, error: '' };
  if (!entry.active) return { status: texts.inactive, error: '' };
  return {
    status: texts.events.replace('{count}', String(entry.events)),
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
