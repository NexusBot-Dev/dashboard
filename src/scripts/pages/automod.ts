// Browser-Logik der AutoMod-Seite (/server/<id>/modules/automod/).
// Gebündeltes Modul: läuft einmal pro Seitenladen; bei Navigation über den ClientRouter
// sorgt astro:page-load dafür, dass die neue Seite neu verdrahtet wird.
import { byId, createDashboardApi, readPageConfig, type ApiMessages, type DashboardApi } from '../dashboard-api';
import { isSwitchOn, setSwitch } from '../switch';
import { setupTabs } from '../tabs';

interface AutomodConfig {
  guildId: string;
  i18n: ApiMessages & {
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

const KEYWORD_CLASS = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800 text-xs font-mono text-slate-700 dark:text-slate-300';

function setupSwitches(root: HTMLElement, api: DashboardApi) {
  root.querySelectorAll<HTMLButtonElement>('[data-automod-toggle]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const previous = isSwitchOn(btn);
      btn.disabled = true;
      try {
        const result = await api.callModuleAction<{ enabled?: boolean }>('automod', 'toggle-rule', { rule_key: btn.dataset.automodToggle });
        // Neuer Bot meldet den Zustand mit (die Regel kann inzwischen in Discord geändert worden sein);
        // ältere Bot-Versionen nicht — dann die Anzeige umdrehen
        setSwitch(btn, result?.enabled ?? !previous);
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
    try {
      const result = await api.callModuleAction<{ shield_enabled: boolean }>('automod', 'toggle-shield');
      setSwitch(shieldToggle, result.shield_enabled);
    } catch (err) {
      alert(errorMessage(err));
    } finally {
      shieldToggle.disabled = false;
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
  if (!createBtn || !form || !nameInput || !newTitleInput || !warnTextInput || !confirmBtn || !cancelBtn
    || !inactiveSection || !activeSection || !channelLabel || !deleteBtn || !titleInput || !textInput
    || !saveTextBtn || !punishMembers || !punishBots || !daysSelect || !savePunishBtn) return;

  // Warn-Nachricht und Bestrafung gibt es nur bei einem vorhandenen Honeypot
  const detailSections = Array.from(document.querySelectorAll<HTMLElement>('[data-honeypot-detail]'));
  const showActive = (active: boolean) => {
    activeSection.classList.toggle('hidden', !active);
    inactiveSection.classList.toggle('hidden', active);
    detailSections.forEach((section) => section.classList.toggle('hidden', !active));
  };

  const texts = trackChanges([titleInput, textInput], saveTextBtn);
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

function setupAutomodPage() {
  // Auf anderen Seiten (oder ohne Bot-Daten) gibt es das Element nicht — dann ist nichts zu tun
  const root = byId('automod-page');
  if (!root || root.dataset.bound === 'true') return;
  root.dataset.bound = 'true';

  // Konfiguration bei jedem Aufruf neu lesen: nach einem Serverwechsel gilt die neue guildId
  const { guildId, i18n } = readPageConfig<AutomodConfig>(root);
  const api = createDashboardApi(guildId, i18n);

  setupTabs(root);
  setupSwitches(root, api);
  setupKeywords(root, api, i18n);
  setupHoneypot(api, i18n);
}

document.addEventListener('astro:page-load', setupAutomodPage);
