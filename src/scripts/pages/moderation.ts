// Browser-Logik der Moderations-Seite (/server/<id>/moderation/).
// Gebündeltes Modul: läuft einmal pro Seitenladen; bei Navigation über den ClientRouter
// sorgt astro:page-load dafür, dass die neue Seite neu verdrahtet wird.
import { byId, createDashboardApi, readPageConfig, type ApiMessages } from '../dashboard-api';

interface ModerationConfig {
  guildId: string;
  i18n: ApiMessages & {
    confirmUnban: string;
    confirmRemoveTimeout: string;
  };
}

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

// Entbannen und Timeout aufheben laufen gleich ab: Rückfrage, Aktion, Zeile entfernen
const ROW_ACTIONS = [
  { attr: 'data-unban', action: 'unban', confirmKey: 'confirmUnban' },
  { attr: 'data-remove-timeout', action: 'remove-timeout', confirmKey: 'confirmRemoveTimeout' },
] as const;

function setupSearch(root: HTMLElement, input: HTMLInputElement) {
  const key = input.dataset.search!;
  const list = root.querySelector<HTMLElement>(`[data-list="${key}"]`);
  const emptyState = root.querySelector<HTMLElement>(`[data-empty-search="${key}"]`);
  if (!list) return;

  const items = Array.from(list.querySelectorAll<HTMLElement>('[data-search-value]'));

  input.addEventListener('input', () => {
    const query = input.value.trim().toLowerCase();
    let visibleCount = 0;
    items.forEach((item) => {
      const matches = item.dataset.searchValue!.includes(query);
      item.classList.toggle('hidden', !matches);
      if (matches) visibleCount++;
    });
    emptyState?.classList.toggle('hidden', visibleCount > 0);
  });
}

// Schatten am unteren Rand, solange die Liste noch weiter scrollt
function setupScrollFade(list: HTMLElement) {
  const updateFade = () => {
    const hasOverflow = list.scrollHeight > list.clientHeight + 4;
    const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 4;
    list.classList.toggle('scroll-fade', hasOverflow && !atBottom);
  };
  updateFade();
  list.addEventListener('scroll', updateFade);
  new ResizeObserver(updateFade).observe(list);
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
        btn.closest('[data-search-value]')?.remove();
      } catch (err) {
        alert(errorMessage(err));
        btn.disabled = false;
      }
      return;
    }
  });

  root.querySelectorAll<HTMLInputElement>('[data-search]').forEach((input) => setupSearch(root, input));
  root.querySelectorAll<HTMLElement>('[data-list]').forEach(setupScrollFade);
}

document.addEventListener('astro:page-load', setupModerationPage);
