// Browser-Logik der Settings-Seite (/server/<id>/settings/).
// Gebündeltes Modul: läuft einmal pro Seitenladen; bei Navigation über den ClientRouter
// sorgt astro:page-load dafür, dass die neue Seite neu verdrahtet wird.
import { byId, readPageConfig } from '../dashboard-api';
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

document.addEventListener('astro:page-load', setupSettingsPage);
