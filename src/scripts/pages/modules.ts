// Browser-Logik der Modul-Übersicht (/server/<id>/modules/).
// Gebündeltes Modul: läuft einmal pro Seitenladen; bei Navigation über den ClientRouter
// sorgt astro:page-load dafür, dass die neue Seite neu verdrahtet wird.
import { byId, readPageConfig } from '../dashboard-api';
import { isSwitchOn, setSwitch } from '../switch';

interface ModulesConfig {
  guildId: string;
  i18n: {
    saving: string;
    saveChangesBtn: string;
    saved: string;
    changesCountSingularTemplate: string;   // enthält "{count}"
    changesCountPluralTemplate: string;     // enthält "{count}"
    unexpectedResponseFullTemplate: string; // enthält "{status}"
    serverErrorPrefix: string;
    serverErrorStatusTemplate: string;      // enthält "{status}"
  };
}

type I18n = ModulesConfig['i18n'];
const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

// Eigener Request statt api.callModuleAction: die Seite hat eigene Fehlertexte (Präfix „Serverfehler: “)
async function postToggle(guildId: string, changes: Record<string, boolean>, i18n: I18n) {
  const res = await fetch(`/api/server/${guildId}/module/modules/toggle/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ changes }),
  });
  let data: { ok?: boolean; error?: string };
  try {
    data = await res.json();
  } catch {
    throw new Error(i18n.unexpectedResponseFullTemplate.replace('{status}', String(res.status)));
  }
  if (!res.ok || !data.ok) {
    throw new Error(
      data.error
        ? `${i18n.serverErrorPrefix}${data.error}`
        : i18n.serverErrorStatusTemplate.replace('{status}', String(res.status))
    );
  }
}

function setupModulesPage() {
  // Auf anderen Seiten gibt es das Element nicht — dann ist nichts zu tun
  const grid = byId('modules-grid');
  const saveBar = byId('save-bar');
  const saveStatus = byId('save-status');
  const saveBtn = byId<HTMLButtonElement>('save-btn');
  const discardBtn = byId<HTMLButtonElement>('discard-btn');
  if (!grid || !saveBar || !saveStatus || !saveBtn || !discardBtn) return;
  if (grid.dataset.bound === 'true') return;
  grid.dataset.bound = 'true';

  // Konfiguration bei jedem Aufruf neu lesen: nach einem Serverwechsel gilt die neue guildId
  const { guildId, i18n } = readPageConfig<ModulesConfig>(grid);

  const cards = () => Array.from(grid.querySelectorAll<HTMLElement>('[data-module-card]'));
  const toggleOf = (card: HTMLElement) => card.querySelector<HTMLButtonElement>('[data-module-toggle]')!;

  function getPendingChanges() {
    const changes: Record<string, boolean> = {};
    cards().forEach((card) => {
      const current = isSwitchOn(toggleOf(card));
      if (current !== (card.dataset.initialEnabled === 'true')) changes[card.dataset.moduleCard!] = current;
    });
    return changes;
  }

  function refreshSaveBar() {
    const changes = getPendingChanges();
    const count = Object.keys(changes).length;
    cards().forEach((card) => {
      const key = card.dataset.moduleCard!;
      card.classList.remove('ring-2', 'ring-primary-500', 'ring-amber-500');
      if (key in changes) card.classList.add('ring-2', changes[key] ? 'ring-primary-500' : 'ring-amber-500');
    });
    saveBar!.classList.toggle('hidden', count === 0);
    saveStatus!.textContent = (count === 1 ? i18n.changesCountSingularTemplate : i18n.changesCountPluralTemplate)
      .replace('{count}', String(count));
  }

  cards().forEach((card) => {
    const btn = toggleOf(card);
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      setSwitch(btn, !isSwitchOn(btn));
      refreshSaveBar();
    });
  });

  discardBtn.addEventListener('click', () => {
    cards().forEach((card) => setSwitch(toggleOf(card), card.dataset.initialEnabled === 'true'));
    refreshSaveBar();
  });

  saveBtn.addEventListener('click', async () => {
    const changes = getPendingChanges();
    if (Object.keys(changes).length === 0) return;

    saveBtn.disabled = true;
    saveBtn.textContent = i18n.saving;

    try {
      await postToggle(guildId, changes, i18n);

      // Gespeicherter Stand ist der neue Ausgangswert — und das Badge zeigt ihn an
      cards().forEach((card) => {
        const enabled = isSwitchOn(toggleOf(card));
        card.dataset.initialEnabled = String(enabled);
        card.querySelector('[data-badge-state="on"]')?.classList.toggle('hidden', !enabled);
        card.querySelector('[data-badge-state="off"]')?.classList.toggle('hidden', enabled);
      });

      saveStatus.textContent = i18n.saved;
      setTimeout(refreshSaveBar, 1200);
    } catch (err) {
      alert(errorMessage(err));
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = i18n.saveChangesBtn;
    }
  });
}

document.addEventListener('astro:page-load', setupModulesPage);
