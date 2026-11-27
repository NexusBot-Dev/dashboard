// AutoMod-Regeln (Bot: systems/automod_rules.py, systems/automod_links.py) — gemeinsam für die Seite
// (src/pages/server/[guildId]/automod/index.astro) und ihr Skript (src/scripts/pages/automod.ts).

export const RULE_KINDS = ['spam', 'mentions', 'keywords', 'presets', 'links', 'names'] as const;
export type RuleKind = (typeof RULE_KINDS)[number];

/** Ohne AutoMod 2.0 (Testphase oder älterer Bot): nur diese drei, mit Schalter und Wortliste */
export const LEGACY_KINDS: readonly RuleKind[] = ['spam', 'mentions', 'keywords'];

export const PRESETS = ['profanity', 'sexual_content', 'slurs'] as const;

/** Timeout-Stufen in Minuten (0 = aus). Discord erlaubt höchstens 4 Wochen. */
export const TIMEOUT_OPTIONS = [0, 1, 5, 10, 60, 1440, 10080] as const;

export interface RuleData {
  enabled: boolean;
  custom_message: string | null;
  exempt_role_ids: string[];
  exempt_channel_ids: string[];
  timeout_minutes: number;
  // je nach Regel
  mention_limit?: number;
  raid_protection?: boolean;
  keywords?: string[];
  presets?: string[];
  allow_list?: string[];
  block_invites?: boolean;
  allow_support?: boolean;
  blocked_domains?: string[];
  partner_codes?: string[];
  allow_list_count?: number;
}

export interface RuleLimits {
  custom_message: number;
  exempt_roles: number;
  exempt_channels: number;
  mention_limit: number;
  timeout_minutes: number;
  timeout_kinds: string[];
  words: number;
  allow_list: number;
  word_length: number;
  partners: number;
  link_allow_list: number;
}

/** Grenzen, falls der Bot sie nicht mitschickt (älterer Bot) — wie in systems/automod_rules.py */
export const DEFAULT_LIMITS: RuleLimits = {
  custom_message: 150, exempt_roles: 20, exempt_channels: 50, mention_limit: 50, timeout_minutes: 40320,
  timeout_kinds: ['keywords', 'links', 'mentions'], words: 1000, allow_list: 1000, word_length: 60,
  partners: 25, link_allow_list: 100,
};

/** Texte für Zusammenfassung und Timeout — Vorlagen mit {count}/{n}/{duration} */
export interface RuleTexts {
  minutes: string;
  hours: string;
  days: string;
  week: string;
  /** Einzahl („1 Tag“, „1 Woche“) – Minuten und Stunden sind abgekürzt und brauchen keine */
  dayOne: string;
  weekOne: string;
  timeoutOff: string;
  summaryWords: string;
  summaryAllowed: string;
  summaryRoles: string;
  summaryChannels: string;
  summaryTimeout: string;
  summaryLimit: string;
  summaryRaid: string;
  summaryInvites: string;
  summaryDomains: string;
  summaryPartners: string;
  summaryNotice: string;
  /** Einzahl („1 Rolle ausgenommen“) — Schlüssel wie oben ohne „summary“, z. B. roles */
  one: Record<'words' | 'allowed' | 'roles' | 'channels' | 'domains' | 'partners', string>;
  presets: Record<string, string>;
}

const fill = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (match, key) => (key in values ? String(values[key]) : match));

export function timeoutLabel(minutes: number, texts: RuleTexts): string {
  if (!minutes) return texts.timeoutOff;
  if (minutes % 10080 === 0) return minutes === 10080 ? texts.weekOne : fill(texts.week, { n: minutes / 10080 });
  if (minutes % 1440 === 0) return minutes === 1440 ? texts.dayOne : fill(texts.days, { n: minutes / 1440 });
  if (minutes % 60 === 0) return fill(texts.hours, { n: minutes / 60 });
  return fill(texts.minutes, { n: minutes });
}

/** Timeout-Stufen fürs Auswahlfeld — ein vom Admin in Discord gesetzter anderer Wert bleibt wählbar */
export function timeoutOptions(current: number): number[] {
  return [...new Set<number>([...TIMEOUT_OPTIONS, current])].sort((a, b) => a - b);
}

type CountKey = keyof RuleTexts['one'];
const COUNT_TEMPLATES: Record<CountKey, keyof RuleTexts> = {
  words: 'summaryWords', allowed: 'summaryAllowed', roles: 'summaryRoles', channels: 'summaryChannels',
  domains: 'summaryDomains', partners: 'summaryPartners',
};
const counted = (key: CountKey, count: number, texts: RuleTexts) =>
  count === 1 ? texts.one[key] : fill(texts[COUNT_TEMPLATES[key]] as string, { count });

/** Kurze Zeile unter dem Titel, z. B. „12 Wörter · 2 Rollen ausgenommen · Timeout 10 Min.“ */
export function ruleSummary(kind: RuleKind, rule: RuleData, texts: RuleTexts): string {
  const parts: string[] = [];
  if (kind === 'mentions' && rule.mention_limit) parts.push(fill(texts.summaryLimit, { count: rule.mention_limit }));
  if (kind === 'mentions' && rule.raid_protection) parts.push(texts.summaryRaid);
  if ((kind === 'keywords' || kind === 'names') && rule.keywords?.length) parts.push(counted('words', rule.keywords.length, texts));
  if (kind === 'presets' && rule.presets?.length) parts.push(rule.presets.map((p) => texts.presets[p] ?? p).join(', '));
  if (kind === 'presets' && rule.allow_list?.length) parts.push(counted('allowed', rule.allow_list.length, texts));
  if (kind === 'links' && rule.block_invites) parts.push(texts.summaryInvites);
  if (kind === 'links' && rule.blocked_domains?.length) parts.push(counted('domains', rule.blocked_domains.length, texts));
  if (kind === 'links' && rule.partner_codes?.length) parts.push(counted('partners', rule.partner_codes.length, texts));
  if (rule.custom_message) parts.push(texts.summaryNotice);
  if (rule.exempt_role_ids.length) parts.push(counted('roles', rule.exempt_role_ids.length, texts));
  if (rule.exempt_channel_ids.length) parts.push(counted('channels', rule.exempt_channel_ids.length, texts));
  if (rule.timeout_minutes) parts.push(fill(texts.summaryTimeout, { duration: timeoutLabel(rule.timeout_minutes, texts) }));
  return parts.join(' · ');
}

/** Partnerlink zum Anzeigen im Textfeld (der Bot speichert nur den Code) */
export const partnerLink = (code: string) => `discord.gg/${code}`;

// ── Eskalation (Bot: systems/automod_escalation.py) ────────────────────────────────────────────────

export type EscalationAction = 'warn' | 'timeout' | 'kick' | 'ban';

export interface EscalationStep {
  strikes: number;
  window_minutes: number;
  action: EscalationAction;
  timeout_minutes?: number;   // nur bei action = timeout
}

/** Auswahlwerte, die der Bot vorgibt */
export interface EscalationOptions {
  actions: EscalationAction[];
  window_options: number[];
  timeout_options: number[];
  max_strikes: number;
}

export interface EscalationData extends EscalationOptions {
  enabled: boolean;
  steps: EscalationStep[];
  max_steps: number;           // Free 1, Premium mehr (feature_limits)
  premium_max_steps: number;
}
