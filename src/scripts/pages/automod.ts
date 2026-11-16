// Browser-Logik der AutoMod-Seite (/server/<id>/automod/).
// Gebündeltes Modul: läuft einmal pro Seitenladen; bei Navigation über den ClientRouter
// sorgt astro:page-load dafür, dass die neue Seite neu verdrahtet wird.
import { byId, createDashboardApi, readPageConfig, type ApiMessages, type DashboardApi } from '../dashboard-api';
import { isSwitchOn, setSwitch } from '../switch';
import { setupTabs } from '../tabs';
import { setupMarkdownToolbars } from '../markdown-toolbar';
import { renderDiscordMarkdown } from '../../lib/discordMarkdown';
import { partnerLink, ruleSummary, type RuleData, type RuleKind, type RuleTexts } from '../../lib/automodRules';

interface AutomodConfig {
  guildId: string;
  v2?: boolean;
  ruleTexts?: RuleTexts;
  shieldCanDisable?: boolean;   // false: nur der Owner darf das Shield ausschalten
  i18n: ApiMessages & {
    confirmAdoptTemplate: string;
    allowListUsageTemplate: string;
    noKeywords: string;
    alertHoneypotRequired: string;
    confirmDeleteHoneypot: string;
    alertWarnTextRequired: string;
    alertTextReposted: string;
    alertTextSavedOnly: string;
    save: string;
    saving: string;
  };
}

type I18n = AutomodConfig['i18n'];
const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

const KEYWORD_CLASS = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-800 text-xs font-mono text-slate-300';

function setupSwitches(root: HTMLElement, api: DashboardApi, canDisable?: boolean) {
  root.querySelectorAll<HTMLButtonElement>('[data-automod-toggle]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const previous = isSwitchOn(btn);
      btn.disabled = true;
      try {
        const result = await api.callModuleAction<{ enabled?: boolean }>('automod', 'toggle-rule', { rule_key: btn.dataset.automodToggle });
        // Neuer Bot meldet den Zustand mit (die Regel kann inzwischen in Discord geändert worden sein);
        // ältere Bot-Versionen nicht — dann die Anzeige umdrehen
        const enabled = result?.enabled ?? !previous;
        setSwitch(btn, enabled);
        // AutoMod 2.0: Regel neu angelegt — neu laden, damit ihre Einstellungen erscheinen
        const card = btn.closest<HTMLElement>('[data-rule-card]');
        if (enabled && card?.dataset.hasRule === 'false' && root.querySelector('[data-rule-expand], [data-rule-setup-hint]')) {
          window.location.reload();
          return;
        }
      } catch (err) {
        alert(errorMessage(err));
      } finally {
        btn.disabled = false;
      }
    });
  });

  const shieldToggle = byId<HTMLButtonElement>('shield-toggle');
  shieldToggle?.addEventListener('click', async () => {
    shieldToggle.disabled = true;
    let enabled = isSwitchOn(shieldToggle);
    try {
      const result = await api.callModuleAction<{ shield_enabled: boolean }>('automod', 'toggle-shield');
      enabled = result.shield_enabled;
      setSwitch(shieldToggle, enabled);
    } catch (err) {
      alert(errorMessage(err));
    } finally {
      // Wer nicht Owner ist, kann das eingeschaltete Shield nicht wieder ausschalten (der Bot lehnt ab)
      const locked = enabled && canDisable === false;
      shieldToggle.disabled = locked;
      byId('shield-owner-hint')?.classList.toggle('hidden', !locked);
    }
  });
}

// ── Shield-Whitelist (src/components/automod/ShieldWhitelist.astro) ──────────────────────────────

interface ShieldWhitelistResult {
  bots: { id: string; whitelisted: boolean }[];
  roles: string[];
}

function setupShieldWhitelist(api: DashboardApi) {
  const botSection = byId('shield-bots');
  const roleSection = byId('shield-roles');

  function showWhitelist(result: ShieldWhitelistResult) {
    const listed = new Set(result.bots.filter((b) => b.whitelisted).map((b) => b.id));
    botSection?.querySelectorAll<HTMLButtonElement>('[data-shield-bot]').forEach((sw) => setSwitch(sw, listed.has(sw.dataset.shieldBot!)));
    const botCount = botSection?.querySelector('[data-shield-bot-count]');
    if (botCount) botCount.textContent = `${listed.size} / ${botSection!.dataset.max}`;
    const roleCount = roleSection?.querySelector('[data-shield-role-count]');
    if (roleCount) roleCount.textContent = `${result.roles.length} / ${roleSection!.dataset.max}`;
  }

  // Bots: jeder Schalter speichert sofort
  botSection?.querySelectorAll<HTMLButtonElement>('[data-shield-bot]').forEach((sw) => {
    sw.addEventListener('click', async () => {
      sw.disabled = true;
      try {
        showWhitelist(await api.callModuleAction<ShieldWhitelistResult>('automod', 'shield-bot', {
          bot_id: sw.dataset.shieldBot, whitelisted: !isSwitchOn(sw),
        }));
      } catch (err) {
        alert(errorMessage(err));
      } finally {
        sw.disabled = false;
      }
    });
  });

  // Suche nach Name oder ID
  const search = byId<HTMLInputElement>('shield-bot-search');
  search?.addEventListener('input', () => {
    const query = search.value.trim().toLowerCase();
    let visible = 0;
    botSection!.querySelectorAll<HTMLElement>('[data-shield-bot-row]').forEach((row) => {
      const match = !query || row.dataset.search!.includes(query);
      row.classList.toggle('hidden', !match);
      if (match) visible++;
    });
    botSection!.querySelector('[data-shield-no-results]')?.classList.toggle('hidden', visible > 0);
  });

  // Rollen: Auswahl ändern, dann speichern
  const saveRoles = byId<HTMLButtonElement>('shield-roles-save');
  const boxes = [...(roleSection?.querySelectorAll<HTMLInputElement>('[data-shield-roles] input') ?? [])];
  const changed = () => boxes.some((box) => box.checked !== box.defaultChecked);
  boxes.forEach((box) => box.addEventListener('change', () => {
    if (saveRoles) saveRoles.disabled = !changed();
  }));
  saveRoles?.addEventListener('click', async () => {
    saveRoles.disabled = true;
    try {
      const result = await api.callModuleAction<ShieldWhitelistResult>('automod', 'shield-roles', {
        role_ids: boxes.filter((box) => box.checked).map((box) => box.value),
      });
      const saved = new Set(result.roles);
      boxes.forEach((box) => (box.defaultChecked = box.checked = saved.has(box.value)));
      showWhitelist(result);
    } catch (err) {
      alert(errorMessage(err));
    } finally {
      saveRoles.disabled = !changed();
    }
  });
}

function setupKeywords(root: HTMLElement, api: DashboardApi, i18n: I18n) {
  const editBtn = byId<HTMLButtonElement>('edit-keywords-btn');
  const form = byId('keywords-form');
  const textarea = byId<HTMLTextAreaElement>('keywords-textarea');
  const display = byId('keywords-display');
  const confirmBtn = byId<HTMLButtonElement>('confirm-keywords-btn');
  const cancelBtn = byId<HTMLButtonElement>('cancel-keywords-btn');
  const keywordsSwitch = root.querySelector<HTMLButtonElement>('[data-automod-toggle="keywords"]');
  if (!editBtn || !form || !textarea || !display || !confirmBtn || !cancelBtn) return;

  const span = (className: string, text: string) => {
    const el = document.createElement('span');
    el.className = className;
    el.textContent = text;
    return el;
  };

  function renderKeywords(keywords: string[]) {
    if (keywords.length === 0) display!.replaceChildren(span('text-xs text-slate-400', i18n.noKeywords));
    else display!.replaceChildren(...keywords.map((kw) => span(KEYWORD_CLASS, kw)));
  }

  // Gespeicherter Stand steht in defaultValue: Abbrechen stellt ihn wieder her
  editBtn.addEventListener('click', () => form.classList.remove('hidden'));
  cancelBtn.addEventListener('click', () => {
    textarea.value = textarea.defaultValue;
    form.classList.add('hidden');
  });

  confirmBtn.addEventListener('click', async () => {
    const keywords = textarea.value.split('\n').map((k) => k.trim().toLowerCase()).filter(Boolean);
    confirmBtn.disabled = true;
    try {
      const result = await api.callModuleAction<{ enabled?: boolean }>('automod', 'set-keywords', { keywords });
      renderKeywords(keywords);
      textarea.defaultValue = textarea.value = keywords.join('\n');
      // Gab es noch keine Keyword-Regel, legt der Bot sie aktiv an
      if (typeof result?.enabled === 'boolean' && keywordsSwitch) setSwitch(keywordsSwitch, result.enabled);
      form.classList.add('hidden');
    } catch (err) {
      alert(errorMessage(err));
    } finally {
      confirmBtn.disabled = false;
    }
  });
}

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

/** Speichern-Button nur aktiv, wenn sich ein Feld gegenüber data-initial geändert hat */
function trackChanges(fields: Field[], saveBtn: HTMLButtonElement) {
  const changed = () => fields.filter((f) => f.value !== (f.dataset.initial ?? ''));
  const refresh = () => { saveBtn.disabled = changed().length === 0; };
  fields.forEach((f) => {
    f.addEventListener('input', refresh);
    f.addEventListener('change', refresh);
  });
  // Sofort einmal prüfen: Änderungen, die vor dem Verdrahten gemacht wurden (astro:page-load kommt erst
  // nach dem vollständigen Laden), hätten sonst kein Ereignis ausgelöst und der Button bliebe aus
  refresh();
  /** Gespeicherten Stand übernehmen (Werte vom Bot) */
  const commit = (values: Map<Field, string>) => {
    values.forEach((value, f) => { f.value = value; f.dataset.initial = value; });
    refresh();
  };
  return { changed, refresh, commit };
}

async function withBusyButton(btn: HTMLButtonElement, i18n: I18n, work: () => Promise<void>) {
  btn.disabled = true;
  btn.textContent = i18n.saving;
  try {
    await work();
  } catch (err) {
    alert(errorMessage(err));
  } finally {
    btn.textContent = i18n.save;
  }
}

/** Live-Vorschau eines Textfelds (Discord-Markdown). Rückgabe: Vorschau neu zeichnen — nach Änderungen per Code */
function bindPreview(textarea: HTMLTextAreaElement, previewEl: HTMLElement) {
  const update = () => {
    const val = textarea.value.trim();
    previewEl.innerHTML = val ? renderDiscordMarkdown(val) : '—';
  };
  textarea.addEventListener('input', update);
  update();   // Eingaben vor dem Verdrahten
  return update;
}

function setupHoneypot(api: DashboardApi, i18n: I18n) {
  const createBtn = byId<HTMLButtonElement>('create-honeypot-btn');
  const form = byId('honeypot-form');
  const nameInput = byId<HTMLInputElement>('honeypot-name-input');
  const newTitleInput = byId<HTMLInputElement>('honeypot-new-title-input');
  const warnTextInput = byId<HTMLTextAreaElement>('honeypot-warntext-input');
  const confirmBtn = byId<HTMLButtonElement>('confirm-honeypot-btn');
  const cancelBtn = byId<HTMLButtonElement>('cancel-honeypot-btn');
  const inactiveSection = byId('honeypot-inactive');
  const activeSection = byId('honeypot-active');
  const channelLabel = byId('honeypot-channel-label');
  const deleteBtn = byId<HTMLButtonElement>('delete-honeypot-btn');
  const titleInput = byId<HTMLInputElement>('honeypot-title-input');
  const textInput = byId<HTMLTextAreaElement>('honeypot-text-input');
  const saveTextBtn = byId<HTMLButtonElement>('save-honeypot-text-btn');
  const punishMembers = byId<HTMLSelectElement>('honeypot-punish-members');
  const punishBots = byId<HTMLSelectElement>('honeypot-punish-bots');
  const daysSelect = byId<HTMLSelectElement>('honeypot-days');
  const savePunishBtn = byId<HTMLButtonElement>('save-honeypot-punish-btn');
  const textPreview = byId('honeypot-text-preview');
  const warnTextPreview = byId('honeypot-warntext-preview');
  if (!createBtn || !form || !nameInput || !newTitleInput || !warnTextInput || !confirmBtn || !cancelBtn
    || !inactiveSection || !activeSection || !channelLabel || !deleteBtn || !titleInput || !textInput
    || !saveTextBtn || !punishMembers || !punishBots || !daysSelect || !savePunishBtn
    || !textPreview || !warnTextPreview) return;

  // Warn-Nachricht und Bestrafung gibt es nur bei einem vorhandenen Honeypot
  const detailSections = Array.from(document.querySelectorAll<HTMLElement>('[data-honeypot-detail]'));
  const showActive = (active: boolean) => {
    activeSection.classList.toggle('hidden', !active);
    inactiveSection.classList.toggle('hidden', active);
    detailSections.forEach((section) => section.classList.toggle('hidden', !active));
  };

  const texts = trackChanges([titleInput, textInput], saveTextBtn);
  const updateTextPreview = bindPreview(textInput, textPreview);
  bindPreview(warnTextInput, warnTextPreview);
  const punishment = trackChanges([punishMembers, punishBots, daysSelect], savePunishBtn);

  createBtn.addEventListener('click', () => form.classList.remove('hidden'));
  cancelBtn.addEventListener('click', () => form.classList.add('hidden'));

  confirmBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    const title = newTitleInput.value.trim();
    const warnText = warnTextInput.value.trim();
    if (!name || !warnText) {
      alert(i18n.alertHoneypotRequired);
      return;
    }

    confirmBtn.disabled = true;
    try {
      const result = await api.callModuleAction<{ channel_name: string; title?: string; text?: string }>(
        'automod', 'create-honeypot', { name, title, warn_text: warnText },
      );
      channelLabel.textContent = `#${result.channel_name}`;
      // Bearbeiten-Felder mit dem gespeicherten Stand füllen (Bot setzt bei leerem Titel den Standardtitel)
      texts.commit(new Map<Field, string>([[titleInput, result.title ?? title], [textInput, result.text ?? warnText]]));
      updateTextPreview();
      showActive(true);
      form.classList.add('hidden');
    } catch (err) {
      alert(errorMessage(err));
    } finally {
      confirmBtn.disabled = false;
    }
  });

  saveTextBtn.addEventListener('click', () => withBusyButton(saveTextBtn, i18n, async () => {
    if (!textInput.value.trim()) {
      alert(i18n.alertWarnTextRequired);
      return;
    }
    const result = await api.callModuleAction<{ title: string; text: string; status: string }>(
      'automod', 'set-honeypot-text', { title: titleInput.value.trim(), warn_text: textInput.value.trim() },
    );
    texts.commit(new Map<Field, string>([[titleInput, result.title], [textInput, result.text]]));
    updateTextPreview();
    if (result.status === 'reposted') alert(i18n.alertTextReposted);
    else if (result.status === 'saved_only') alert(i18n.alertTextSavedOnly);
  }).finally(texts.refresh));

  savePunishBtn.addEventListener('click', () => withBusyButton(savePunishBtn, i18n, async () => {
    // Nur Geändertes schicken; Dauer als Zahl (der Bot prüft strikt)
    const body: Record<string, unknown> = {};
    for (const field of punishment.changed()) {
      if (field === punishMembers) body.members = field.value;
      else if (field === punishBots) body.bots = field.value;
      else body.days = Number(field.value);
    }
    if (Object.keys(body).length === 0) return;
    const result = await api.callModuleAction<{ members: string; bots: string; days: number }>('automod', 'set-honeypot-punishment', body);
    punishment.commit(new Map<Field, string>([
      [punishMembers, result.members], [punishBots, result.bots], [daysSelect, String(result.days)],
    ]));
  }).finally(punishment.refresh));

  deleteBtn.addEventListener('click', async () => {
    if (!confirm(i18n.confirmDeleteHoneypot)) return;
    deleteBtn.disabled = true;
    try {
      await api.callModuleAction('automod', 'delete-honeypot');
      showActive(false);
    } catch (err) {
      alert(errorMessage(err));
    } finally {
      deleteBtn.disabled = false;
    }
  });
}

// ── AutoMod 2.0: Karten mit Einstellungen (src/components/automod/RuleCard.astro) ─────────────────

const fill = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (match, key) => (key in values ? String(values[key]) : match));

type FieldValue = string | number | boolean | string[];

/** Wert eines Feldes nach data-type: text, int, bool, lines (eine Zeile pro Eintrag), checks (angehakte Werte) */
function readField(el: HTMLElement): FieldValue {
  const type = el.dataset.type;
  if (type === 'checks') return [...el.querySelectorAll<HTMLInputElement>('input[type=checkbox]:checked')].map((c) => c.value);
  if (type === 'bool') return (el as HTMLInputElement).checked;
  const value = (el as HTMLInputElement).value;
  if (type === 'int') return Number(value);
  if (type === 'lines') return value.split('\n').map((l) => l.trim()).filter(Boolean);
  return value.trim();
}

function writeField(el: HTMLElement, value: FieldValue | undefined) {
  if (value === undefined) return;
  const type = el.dataset.type;
  if (type === 'checks') {
    const values = new Set(value as string[]);
    el.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach((c) => { c.checked = values.has(c.value); });
  } else if (type === 'bool') (el as HTMLInputElement).checked = Boolean(value);
  else if (type === 'lines') (el as HTMLTextAreaElement).value = (value as string[]).join('\n');
  else (el as HTMLInputElement).value = value === null ? '' : String(value);
}

const readForm = (form: HTMLElement) =>
  Object.fromEntries([...form.querySelectorAll<HTMLElement>('[data-field]')].map((el) => [el.dataset.field!, readField(el)]));

/** Antwort des Bots in Formularwerte übersetzen (Partnerlinks speichert der Bot als Codes) */
function formValues(data: Record<string, unknown>): Record<string, FieldValue> {
  const values = { ...data } as Record<string, FieldValue>;
  if (Array.isArray(data.partner_codes)) values.partner_links = (data.partner_codes as string[]).map(partnerLink);
  if (data.custom_message === null) values.custom_message = '';
  return values;
}

function setupRuleCards(root: HTMLElement, api: DashboardApi, config: AutomodConfig) {
  const { i18n, ruleTexts } = config;

  root.querySelectorAll<HTMLButtonElement>('[data-rule-expand]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const panel = byId(btn.getAttribute('aria-controls')!);
      const open = btn.getAttribute('aria-expanded') !== 'true';
      btn.setAttribute('aria-expanded', String(open));
      panel?.classList.toggle('hidden', !open);
      btn.querySelector('[data-rule-chevron]')?.classList.toggle('rotate-180', open);
    });
  });

  root.querySelectorAll<HTMLButtonElement>('[data-automod-adopt]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm(fill(i18n.confirmAdoptTemplate, { name: btn.dataset.name ?? '' }))) return;
      btn.disabled = true;
      try {
        await api.callModuleAction('automod', 'adopt-rule', { rule_key: btn.dataset.automodAdopt });
        window.location.reload();   // ab jetzt eine Nexus-Regel mit Schalter und Einstellungen
      } catch (err) {
        alert(errorMessage(err));
        btn.disabled = false;
      }
    });
  });

  root.querySelectorAll<HTMLElement>('[data-rule-card]').forEach((card) => {
    const kind = card.dataset.ruleCard as RuleKind;
    card.querySelectorAll<HTMLElement>('[data-rule-form]').forEach((form) => {
      const saveBtn = form.querySelector<HTMLButtonElement>('[data-rule-save]')!;
      const action = form.dataset.ruleForm === 'content' ? 'rule-content' : 'rule-settings';
      let initial = readForm(form);
      // Nur geänderte Felder — was seit dem Laden in Discord geändert wurde, bleibt sonst erhalten
      const changed = () => Object.fromEntries(
        Object.entries(readForm(form)).filter(([name, value]) => JSON.stringify(value) !== JSON.stringify(initial[name])),
      );
      // Speichern nur mit Änderung — auch für Eingaben, die vor dem Verdrahten gemacht wurden
      const refresh = () => { saveBtn.disabled = Object.keys(changed()).length === 0; };
      form.addEventListener('input', refresh);
      form.addEventListener('change', refresh);
      refresh();

      saveBtn.addEventListener('click', () => withBusyButton(saveBtn, i18n, async () => {
        const result = await api.callModuleAction<Record<string, unknown>>('automod', action, { rule_key: kind, ...changed() });
        // Stand des Bots übernehmen (bereinigte Wörter, Domains, Codes …)
        const values = formValues(result);
        form.querySelectorAll<HTMLElement>('[data-field]').forEach((el) => writeField(el, values[el.dataset.field!]));
        initial = readForm(form);
        const rule = { ...(JSON.parse(card.dataset.rule || '{}') as RuleData), ...(result as Partial<RuleData>) };
        card.dataset.rule = JSON.stringify(rule);
        const summary = card.querySelector<HTMLElement>('[data-rule-summary]');
        if (summary && ruleTexts) {
          summary.textContent = ruleSummary(kind, rule, ruleTexts);
          summary.classList.toggle('hidden', !summary.textContent);
        }
        const usage = form.querySelector<HTMLElement>('[data-links-usage]');
        if (usage && typeof result.allow_list_count === 'number') {
          usage.textContent = fill(i18n.allowListUsageTemplate, { count: result.allow_list_count, max: usage.dataset.max ?? '' });
        }
      }).finally(refresh));
    });
  });
}

function setupAutomodPage() {
  // Auf anderen Seiten (oder ohne Bot-Daten) gibt es das Element nicht — dann ist nichts zu tun
  const root = byId('automod-page');
  if (!root || root.dataset.bound === 'true') return;
  root.dataset.bound = 'true';

  // Konfiguration bei jedem Aufruf neu lesen: nach einem Serverwechsel gilt die neue guildId
  const config = readPageConfig<AutomodConfig>(root);
  const { guildId, i18n } = config;
  const api = createDashboardApi(guildId, i18n);

  setupTabs(root);
  setupMarkdownToolbars();
  setupSwitches(root, api, config.shieldCanDisable);
  setupKeywords(root, api, i18n);
  setupRuleCards(root, api, config);
  setupHoneypot(api, i18n);
  setupShieldWhitelist(api);
}

document.addEventListener('astro:page-load', setupAutomodPage);
