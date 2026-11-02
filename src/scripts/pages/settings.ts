// Browser-Logik der Settings-Seite (/server/<id>/settings/).
// Gebündeltes Modul: läuft einmal pro Seitenladen; bei Navigation über den ClientRouter
// sorgt astro:page-load dafür, dass die neue Seite neu verdrahtet wird.
import { byId, createDashboardApi, readPageConfig, type ApiMessages } from '../dashboard-api';
import { setSwitch } from '../switch';

interface SettingsConfig {
  guildId: string;
  i18n: {
    save: string;
    saving: string;
    saveErrorPrefix: string;
    unknown: string;
    saved: string;
    botUnreachable: string;
  };
}

type FieldElement = HTMLInputElement | HTMLSelectElement | HTMLButtonElement;

const isSwitch = (el: FieldElement) => el.getAttribute('role') === 'switch';
const fieldValue = (el: FieldElement) => (isSwitch(el) ? el.getAttribute('aria-checked') : el.value);

// Eigener Request statt api.saveSettings: die Seite hat eigene Fehlertexte und zeigt Warnungen des Bots an
async function postSettings(guildId: string, fields: Record<string, unknown>) {
  const res = await fetch(`/api/server/${guildId}/settings/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
  return (await res.json()) as { ok: boolean; error?: string; warnings?: string[]; data?: { warnings?: string[] } };
}

function setupSettingsPage() {
  // Auf anderen Seiten gibt es das Element nicht — dann ist nichts zu tun
  const form = byId('settings-form');
  const saveBar = byId('save-bar');
  const saveBtn = byId<HTMLButtonElement>('save-btn');
  const discardBtn = byId<HTMLButtonElement>('discard-btn');
  if (!form || !saveBar || !saveBtn || !discardBtn) return;
  if (form.dataset.bound === 'true') return;
  form.dataset.bound = 'true';

  // Konfiguration bei jedem Aufruf neu lesen: nach einem Serverwechsel gilt die neue guildId
  const { guildId, i18n } = readPageConfig<SettingsConfig>(form);
  const announcementsToggle = byId<HTMLButtonElement>('announcements-toggle');
  const colorInput = byId<HTMLInputElement>('accent-color-input');
  const colorHex = byId('accent-color-hex');
  const saveStatus = byId('save-status')!;

  const fields = () => Array.from(form.querySelectorAll<FieldElement>('[data-field]'));
  const isDirty = () => fields().some((el) => fieldValue(el) !== el.dataset.initial);
  const refreshSaveBar = () => saveBar.classList.toggle('hidden', !isDirty());
  const syncColorLabel = () => {
    if (colorInput && colorHex) colorHex.textContent = colorInput.value.toUpperCase();
  };

  form.querySelectorAll<FieldElement>('input[data-field], select[data-field]').forEach((el) => {
    el.addEventListener('input', refreshSaveBar);
    el.addEventListener('change', refreshSaveBar);
  });

  colorInput?.addEventListener('input', syncColorLabel);
  // Sofort einmal prüfen: Änderungen vor dem Verdrahten (astro:page-load kommt erst nach dem Laden) lösen kein Ereignis aus
  syncColorLabel();
  refreshSaveBar();

  announcementsToggle?.addEventListener('click', () => {
    setSwitch(announcementsToggle, announcementsToggle.getAttribute('aria-checked') !== 'true');
    refreshSaveBar();
  });

  discardBtn.addEventListener('click', () => {
    fields().forEach((el) => {
      if (isSwitch(el)) setSwitch(el, el.dataset.initial === 'true');
      else el.value = el.dataset.initial ?? '';
    });
    syncColorLabel();
    refreshSaveBar();
  });

  saveBtn.addEventListener('click', async () => {
    // Nur geänderte Felder schicken; Schalter als echtes Boolean (der Bot prüft strikt)
    const changed: Record<string, string | boolean> = {};
    fields().forEach((el) => {
      const current = fieldValue(el);
      if (current !== el.dataset.initial) {
        changed[el.getAttribute('name')!] = isSwitch(el) ? current === 'true' : current!;
      }
    });
    if (Object.keys(changed).length === 0) return;

    saveBtn.disabled = true;
    saveBtn.textContent = i18n.saving;

    try {
      const data = await postSettings(guildId, changed);
      if (!data.ok) {
        alert(i18n.saveErrorPrefix + (data.error || i18n.unknown));
        return;
      }

      const warnings = data.data?.warnings ?? data.warnings ?? [];
      if (warnings.length > 0) alert(warnings.join('\n'));

      // Gespeicherter Stand ist der neue Ausgangswert
      fields().forEach((el) => {
        el.dataset.initial = fieldValue(el) ?? '';
      });

      const originalText = saveStatus.textContent;
      saveStatus.textContent = i18n.saved;
      saveStatus.classList.add('text-primary-600', 'dark:text-primary-400');
      setTimeout(() => {
        refreshSaveBar();
        saveStatus.textContent = originalText;
        saveStatus.classList.remove('text-primary-600', 'dark:text-primary-400');
      }, 1200);
    } catch (err) {
      console.error(err);
      alert(i18n.botUnreachable);
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = i18n.save;
    }
  });
}

interface DangerZoneConfig {
  guildId: string;
  confirmWord: string;
  i18n: ApiMessages & {
    leaveTitle: string;
    leaveText: string;
    leaveConfirm: string;
    deleteTitle: string;
    deleteText: string;
    deleteConfirm: string;
    working: string;
    deleteFailed: string;
  };
}

// Danger Zone: "Nexus entfernen" (wie ein Kick, 7 Tage Wiederherstellung) und dasselbe mit
// sofortigem Löschen — beides ist guild/leave, nur delete_now unterscheidet sich.
function setupDangerZone() {
  const root = byId('danger-zone');
  const dialog = byId<HTMLDialogElement>('danger-dialog');
  const form = byId<HTMLFormElement>('danger-form');
  const title = byId('danger-dialog-title');
  const text = byId('danger-dialog-text');
  const input = byId<HTMLInputElement>('danger-confirm-input');
  const error = byId('danger-dialog-error');
  const cancelBtn = byId<HTMLButtonElement>('danger-cancel-btn');
  const confirmBtn = byId<HTMLButtonElement>('danger-confirm-btn');
  if (!root || !dialog || !form || !title || !text || !input || !error || !cancelBtn || !confirmBtn) return;
  if (root.dataset.bound === 'true') return;
  root.dataset.bound = 'true';

  const { guildId, confirmWord, i18n } = readPageConfig<DangerZoneConfig>(root);
  const api = createDashboardApi(guildId, i18n);
  let deleteNow = false;
  let busy = false;

  // Groß-/Kleinschreibung egal: "entfernen" zählt wie "ENTFERNEN"
  const wordMatches = () => input.value.trim().toUpperCase() === confirmWord.toUpperCase();
  const confirmLabel = () => (deleteNow ? i18n.deleteConfirm : i18n.leaveConfirm);
  const showError = (message: string | null) => {
    error.textContent = message ?? '';
    error.classList.toggle('hidden', !message);
  };

  root.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-danger-action]');
    if (!button || button.disabled) return;
    deleteNow = button.dataset.dangerAction === 'delete';
    title.textContent = deleteNow ? i18n.deleteTitle : i18n.leaveTitle;
    text.textContent = deleteNow ? i18n.deleteText : i18n.leaveText;
    confirmBtn.textContent = confirmLabel();
    confirmBtn.disabled = true;
    input.value = '';
    showError(null);
    dialog.showModal();
    input.focus();
  });

  input.addEventListener('input', () => {
    confirmBtn.disabled = busy || !wordMatches();
  });

  cancelBtn.addEventListener('click', () => dialog.close());

  // Während der Bot arbeitet, darf der Dialog nicht per Escape verschwinden
  dialog.addEventListener('cancel', (event) => {
    if (busy) event.preventDefault();
  });

  // Bestätigen-Button ist der Submit-Button: Enter im Eingabefeld löst ihn aus, aber nur, wenn er aktiv ist
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy || !wordMatches()) return;
    busy = true;
    confirmBtn.disabled = true;
    cancelBtn.disabled = true;
    input.disabled = true;
    confirmBtn.textContent = i18n.working;
    showError(null);

    try {
      const result = await api.callModuleAction<{ left: boolean; deleted: boolean }>('guild', 'leave', {
        delete_now: deleteNow,
      });
      if (deleteNow && !result.deleted) alert(i18n.deleteFailed);
      // Komplett neu laden: die Serverliste zeigt den Server danach mit Einladungs-Link
      window.location.assign('/server/');
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
      busy = false;
      cancelBtn.disabled = false;
      input.disabled = false;
      confirmBtn.textContent = confirmLabel();
      confirmBtn.disabled = !wordMatches();
    }
  });
}

document.addEventListener('astro:page-load', setupSettingsPage);
document.addEventListener('astro:page-load', setupDangerZone);
