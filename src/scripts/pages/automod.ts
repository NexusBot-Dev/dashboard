// Browser-Logik der AutoMod-Seite (/server/<id>/modules/automod/).
// Gebündeltes Modul: läuft einmal pro Seitenladen; bei Navigation über den ClientRouter
// sorgt astro:page-load dafür, dass die neue Seite neu verdrahtet wird.
import { byId, createDashboardApi, readPageConfig, type ApiMessages, type DashboardApi } from '../dashboard-api';
import { isSwitchOn, setSwitch } from '../switch';

interface AutomodConfig {
  guildId: string;
  i18n: ApiMessages & {
    noKeywords: string;
    alertHoneypotRequired: string;
    confirmDeleteHoneypot: string;
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

function setupHoneypot(api: DashboardApi, i18n: I18n) {
  const createBtn = byId<HTMLButtonElement>('create-honeypot-btn');
  const form = byId('honeypot-form');
  const nameInput = byId<HTMLInputElement>('honeypot-name-input');
  const warnTextInput = byId<HTMLTextAreaElement>('honeypot-warntext-input');
  const confirmBtn = byId<HTMLButtonElement>('confirm-honeypot-btn');
  const cancelBtn = byId<HTMLButtonElement>('cancel-honeypot-btn');
  const inactiveSection = byId('honeypot-inactive');
  const activeSection = byId('honeypot-active');
  const channelLabel = byId('honeypot-channel-label');
  const deleteBtn = byId<HTMLButtonElement>('delete-honeypot-btn');
  if (!createBtn || !form || !nameInput || !warnTextInput || !confirmBtn || !cancelBtn
    || !inactiveSection || !activeSection || !channelLabel || !deleteBtn) return;

  createBtn.addEventListener('click', () => form.classList.remove('hidden'));
  cancelBtn.addEventListener('click', () => form.classList.add('hidden'));

  confirmBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    const warnText = warnTextInput.value.trim();
    if (!name || !warnText) {
      alert(i18n.alertHoneypotRequired);
      return;
    }

    confirmBtn.disabled = true;
    try {
      const result = await api.callModuleAction<{ channel_name: string }>('automod', 'create-honeypot', { name, warn_text: warnText });
      channelLabel.textContent = `#${result.channel_name}`;
      inactiveSection.classList.add('hidden');
      activeSection.classList.remove('hidden');
      form.classList.add('hidden');
    } catch (err) {
      alert(errorMessage(err));
    } finally {
      confirmBtn.disabled = false;
    }
  });

  deleteBtn.addEventListener('click', async () => {
    if (!confirm(i18n.confirmDeleteHoneypot)) return;
    deleteBtn.disabled = true;
    try {
      await api.callModuleAction('automod', 'delete-honeypot');
      activeSection.classList.add('hidden');
      inactiveSection.classList.remove('hidden');
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

  setupSwitches(root, api);
  setupKeywords(root, api, i18n);
  setupHoneypot(api, i18n);
}

document.addEventListener('astro:page-load', setupAutomodPage);
