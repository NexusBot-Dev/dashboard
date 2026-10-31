// Browser-Logik der Moderations-Seite (/server/<id>/moderation/).
// Gebündeltes Modul: läuft einmal pro Seitenladen; bei Navigation über den ClientRouter
// sorgt astro:page-load dafür, dass die neue Seite neu verdrahtet wird.
import { byId, createDashboardApi, readPageConfig, type ApiMessages } from '../dashboard-api';
import { setupScrollFade } from '../scroll-fade';

interface ModerationConfig {
  guildId: string;
  i18n: ApiMessages & {
    confirmUnban: string;
    confirmRemoveTimeout: string;
    entrySingular: string;
    entryPlural: string;
  };
}

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

// Entbannen und Timeout aufheben laufen gleich ab: Rückfrage, Aktion, Zeile entfernen
const ROW_ACTIONS = [
  { attr: 'data-unban', action: 'unban', confirmKey: 'confirmUnban' },
  { attr: 'data-remove-timeout', action: 'remove-timeout', confirmKey: 'confirmRemoveTimeout' },
] as const;

/**
 * Zeigt Zähler, Leer-Hinweis und Suchergebnis passend zu den Zeilen, die gerade in der Liste stehen —
 * nach jeder Eingabe in der Suche und nach jedem Entfernen einer Zeile.
 */
function refreshList(root: HTMLElement, key: string, i18n: ModerationConfig['i18n']) {
  const list = root.querySelector<HTMLElement>(`[data-list="${key}"]`);
  if (!list) return;
  const input = root.querySelector<HTMLInputElement>(`[data-search="${key}"]`);
  const items = Array.from(list.querySelectorAll<HTMLElement>('[data-search-value]'));

  const query = input?.value.trim().toLowerCase() ?? '';
  let visibleCount = 0;
  items.forEach((item) => {
    const matches = item.dataset.searchValue!.includes(query);
    item.classList.toggle('hidden', !matches);
    if (matches) visibleCount++;
  });

  const count = root.querySelector(`[data-count="${key}"]`);
  if (count) count.textContent = `${items.length} ${items.length === 1 ? i18n.entrySingular : i18n.entryPlural}`;
  // Leere Liste: „keine Bans“ statt „keine Treffer“
  root.querySelector(`[data-empty-list="${key}"]`)?.classList.toggle('hidden', items.length > 0);
  root.querySelector(`[data-empty-search="${key}"]`)?.classList.toggle('hidden', items.length === 0 || visibleCount > 0);
}

function setupModerationPage() {
  // Auf anderen Seiten gibt es das Element nicht — dann ist nichts zu tun
  const root = byId('moderation-page');
  if (!root || root.dataset.bound === 'true') return;
  root.dataset.bound = 'true';

  // Konfiguration bei jedem Aufruf neu lesen: nach einem Serverwechsel gilt die neue guildId
  const { guildId, i18n } = readPageConfig<ModerationConfig>(root);
  const api = createDashboardApi(guildId, i18n);

  root.addEventListener('click', async (event) => {
    const target = event.target as HTMLElement;
    for (const { attr, action, confirmKey } of ROW_ACTIONS) {
      const btn = target.closest<HTMLButtonElement>(`[${attr}]`);
      if (!btn) continue;

      if (!confirm(i18n[confirmKey])) return;
      btn.disabled = true;
      try {
        await api.callModuleAction('moderation', action, { user_id: btn.getAttribute(attr) });
        const key = btn.closest<HTMLElement>('[data-list]')?.dataset.list;
        btn.closest('[data-search-value]')?.remove();
        if (key) refreshList(root, key, i18n);
      } catch (err) {
        alert(errorMessage(err));
        btn.disabled = false;
      }
      return;
    }
  });

  root.querySelectorAll<HTMLInputElement>('[data-search]').forEach((input) => {
    input.addEventListener('input', () => refreshList(root, input.dataset.search!, i18n));
  });
  root.querySelectorAll<HTMLElement>('[data-list]').forEach(setupScrollFade);
}

document.addEventListener('astro:page-load', setupModerationPage);
