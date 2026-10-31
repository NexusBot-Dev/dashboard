// Browser-Logik der Giveaway-Seite (/server/<id>/giveaways/).
// Gebündeltes Modul: läuft einmal pro Seitenladen; bei Navigation über den ClientRouter
// sorgt astro:page-load dafür, dass die neue Seite neu verdrahtet wird.
import { byId, createDashboardApi, readPageConfig, type ApiMessages, type DashboardApi } from '../dashboard-api';
import { renderDiscordMarkdown } from '../../lib/discordMarkdown';
import { setupMarkdownToolbars } from '../markdown-toolbar';
import { setupScrollFade } from '../scroll-fade';

interface GiveawaysConfig {
  guildId: string;
  i18n: ApiMessages & {
    confirmCancel: string;
  };
}

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

function setupDescriptionPreview() {
  const input = byId<HTMLTextAreaElement>('gw-description');
  const previewEl = byId('gw-description-preview');
  if (!input || !previewEl) return;
  input.addEventListener('input', () => {
    const val = input.value.trim();
    previewEl.innerHTML = val ? renderDiscordMarkdown(val) : '—';
  });
}

function setupCreateForm(root: HTMLElement, api: DashboardApi) {
  const form = root.querySelector<HTMLFormElement>('[data-giveaway-form]');
  const errorEl = form?.querySelector<HTMLElement>('[data-form-error]');
  const submitBtn = form?.querySelector<HTMLButtonElement>('[type="submit"]');
  if (!form || !errorEl || !submitBtn) return;

  // Pflichtfelder prüft der Browser selbst (required/min/max) — submit kommt erst danach
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorEl.classList.add('hidden');
    submitBtn.disabled = true;

    const fd = new FormData(form);
    try {
      await api.callModuleAction('giveaways', 'create', {
        prize: fd.get('prize'),
        description: fd.get('description'),
        channel_id: fd.get('channel_id'),
        end_time: `${fd.get('end_date')}T${fd.get('end_clock')}`,
        winners_count: fd.get('winners_count'),
      });
      window.location.reload();
    } catch (err) {
      errorEl.textContent = errorMessage(err);
      errorEl.classList.remove('hidden');
      submitBtn.disabled = false;
    }
  });
}

function setupCancelButtons(root: HTMLElement, api: DashboardApi, i18n: GiveawaysConfig['i18n']) {
  root.addEventListener('click', async (event) => {
    const btn = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-cancel-giveaway]');
    if (!btn) return;
    if (!confirm(i18n.confirmCancel)) return;
    btn.disabled = true;
    try {
      await api.callModuleAction('giveaways', 'cancel', { id: Number(btn.dataset.cancelGiveaway) });
      window.location.reload();
    } catch (err) {
      alert(errorMessage(err));
      btn.disabled = false;
    }
  });
}

function setupGiveawaysPage() {
  // Auf anderen Seiten gibt es das Element nicht — dann ist nichts zu tun
  const root = byId('giveaways-page');
  if (!root || root.dataset.bound === 'true') return;
  root.dataset.bound = 'true';

  // Konfiguration bei jedem Aufruf neu lesen: nach einem Serverwechsel gilt die neue guildId
  const { guildId, i18n } = readPageConfig<GiveawaysConfig>(root);
  const api = createDashboardApi(guildId, i18n);

  setupMarkdownToolbars();
  setupDescriptionPreview();
  setupCreateForm(root, api);
  setupCancelButtons(root, api, i18n);
  root.querySelectorAll<HTMLElement>('[data-list]').forEach(setupScrollFade);
}

document.addEventListener('astro:page-load', setupGiveawaysPage);
