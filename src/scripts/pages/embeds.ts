// Browser-Logik der Embeds-Seite (/server/<id>/embeds/).
// Gebündeltes Modul: läuft einmal pro Seitenladen; bei Navigation über den ClientRouter
// sorgt astro:page-load dafür, dass die neue Seite neu verdrahtet wird.
import { renderPreview } from '../../lib/discordMarkdown';
import { byId, createDashboardApi, readPageConfig, type ApiMessages, type DashboardApi } from '../dashboard-api';
import { setupMarkdownToolbars } from '../markdown-toolbar';

interface EmbedsConfig {
  guildId: string;
  previewVars: Record<string, string>;
  i18n: ApiMessages & {
    embedFormAddTitle: string;
    embedFormEditTitle: string;
    noChannelInline: string;
    alertNameContentRequired: string;
    alertChannelRequired: string;
    alertDateTimeRequired: string;
    confirmPostNow: string;
    alertPosted: string;
    confirmDeleteEmbed: string;
  };
}

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Textfelder einer Zeile (Markup aus src/components/EmbedRow.astro) */
const field = (row: HTMLElement, name: string) => row.querySelector<HTMLElement>(`[data-field="${name}"]`)!;

function setupEmbeds(list: HTMLElement, api: DashboardApi, config: EmbedsConfig) {
  const { i18n, previewVars } = config;
  const addBtn = byId<HTMLButtonElement>('add-embed-btn')!;
  const form = byId('embed-form')!;
  const formTitle = byId('embed-form-title')!;
  const nameInput = byId<HTMLInputElement>('embed-name-input')!;
  const channelSelect = byId<HTMLSelectElement>('embed-channel-select')!;
  const titleInput = byId<HTMLInputElement>('embed-title-input')!;
  const descInput = byId<HTMLTextAreaElement>('embed-description-input')!;
  const previewEl = byId('embed-preview')!;
  const confirmBtn = byId<HTMLButtonElement>('confirm-embed-btn')!;
  const cancelBtn = byId<HTMLButtonElement>('cancel-embed-btn')!;
  const rowTemplate = byId<HTMLTemplateElement>('embed-row-template')!;

  let editingId: string | null = null;

  function updatePreview() {
    const val = descInput.value.trim();
    previewEl.innerHTML = val ? renderPreview(val, previewVars) : '—';
  }
  descInput.addEventListener('input', updatePreview);

  function openForm(row?: HTMLElement) {
    editingId = row ? row.dataset.embedRow! : null;
    formTitle.textContent = row ? i18n.embedFormEditTitle : i18n.embedFormAddTitle;
    byId('schedule-form')!.classList.add('hidden');
    nameInput.value = row ? field(row, 'name').textContent ?? '' : '';
    titleInput.value = row?.dataset.title ?? '';
    descInput.value = row?.dataset.description ?? '';
    channelSelect.value = row?.dataset.channelId ?? '';
    updatePreview();
    form.classList.remove('hidden');
    nameInput.focus();
  }
  function closeForm() {
    form.classList.add('hidden');
    editingId = null;
  }

  /** Schreibt die Werte in eine Zeile — alles per textContent, damit nichts davon Markup wird */
  function fillRow(row: HTMLElement, values: { name: string; title: string; description: string; channelId: string; channelName: string }) {
    row.dataset.title = values.title;
    row.dataset.description = values.description;
    row.dataset.channelId = values.channelId;
    field(row, 'name').textContent = values.name;
    field(row, 'title').textContent = values.title;
    field(row, 'description').textContent = values.description;
    field(row, 'channel').textContent = values.channelId ? `#${values.channelName}` : i18n.noChannelInline;
  }

  addBtn.addEventListener('click', () => openForm());
  cancelBtn.addEventListener('click', closeForm);

  confirmBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    const description = descInput.value.trim();
    if (!name || !description) { alert(i18n.alertNameContentRequired); return; }

    const channelId = channelSelect.value;
    const title = titleInput.value.trim();
    const channelName = channelSelect.selectedOptions[0]?.textContent?.replace('#', '') ?? '';

    if (!editingId && !channelId) { alert(i18n.alertChannelRequired); return; }

    confirmBtn.disabled = true;
    try {
      if (editingId) {
        await api.callModuleAction('embeds', 'edit', { embed_id: editingId, title, description, channel_id: channelId || null });
        const row = list.querySelector<HTMLElement>(`[data-embed-row="${CSS.escape(editingId)}"]`);
        if (row) fillRow(row, { name, title, description, channelId, channelName });
      } else {
        const result = await api.callModuleAction<{ id: number }>('embeds', 'add', { name, title, description, channel_id: channelId });
        const row = (rowTemplate.content.firstElementChild as HTMLElement).cloneNode(true) as HTMLElement;
        const id = String(result.id);
        row.dataset.embedRow = id;
        row.querySelector<HTMLElement>('[data-post-now]')!.dataset.postNow = id;
        row.querySelector<HTMLElement>('[data-schedule-btn]')!.dataset.scheduleBtn = id;
        row.querySelector<HTMLElement>('[data-edit-embed]')!.dataset.editEmbed = id;
        row.querySelector<HTMLElement>('[data-remove-embed]')!.dataset.removeEmbed = id;
        fillRow(row, { name, title, description, channelId, channelName });
        list.appendChild(row);
      }
      closeForm();
    } catch (err) {
      alert(errorMessage(err));
    } finally {
      confirmBtn.disabled = false;
    }
  });

  // ─── Zeitplan ──────────────────────────────────────────────────────────────
  const scheduleForm = byId('schedule-form')!;
  const scheduleDateInput = byId<HTMLInputElement>('schedule-date-input');   // nur mit Premium vorhanden
  const scheduleTimeInput = byId<HTMLInputElement>('schedule-time-input');
  const confirmScheduleBtn = byId<HTMLButtonElement>('confirm-schedule-btn');
  const cancelScheduleBtn = byId<HTMLButtonElement>('cancel-schedule-btn');
  let schedulingId: string | null = null;

  cancelScheduleBtn?.addEventListener('click', () => { scheduleForm.classList.add('hidden'); schedulingId = null; });

  confirmScheduleBtn?.addEventListener('click', async () => {
    const date = scheduleDateInput!.value;
    const time = scheduleTimeInput!.value;
    if (!date || !time) { alert(i18n.alertDateTimeRequired); return; }

    confirmScheduleBtn.disabled = true;
    try {
      // Der Bot rechnet Datum/Uhrzeit in der Zeitzone des Servers um
      await api.callModuleAction('embeds', 'schedule', { embed_id: schedulingId, scheduled_at: `${date}T${time}` });
      location.reload(); // einfachste zuverlässige Art, die neue Badge korrekt anzuzeigen
    } catch (err) {
      alert(errorMessage(err));
    } finally {
      confirmScheduleBtn.disabled = false;
    }
  });

  // ─── Buttons in den Zeilen (delegiert, gilt auch für neu angelegte) ───────
  list.addEventListener('click', async (event) => {
    const target = event.target as HTMLElement;
    const row = target.closest<HTMLElement>('[data-embed-row]');
    if (!row) return;
    const id = row.dataset.embedRow!;

    if (target.closest('[data-edit-embed]')) {
      openForm(row);
    } else if (target.closest('[data-schedule-btn]')) {
      schedulingId = id;
      form.classList.add('hidden');
      scheduleForm.classList.remove('hidden');
    } else if (target.closest('[data-post-now]')) {
      if (!confirm(i18n.confirmPostNow)) return;
      try {
        await api.callModuleAction('embeds', 'post-now', { embed_id: id });
        alert(i18n.alertPosted);
      } catch (err) {
        alert(errorMessage(err));
      }
    } else if (target.closest('[data-remove-embed]')) {
      if (!confirm(i18n.confirmDeleteEmbed)) return;
      try {
        await api.callModuleAction('embeds', 'delete', { embed_id: id });
        row.remove();
      } catch (err) {
        alert(errorMessage(err));
      }
    } else if (target.closest('[data-unschedule]')) {
      try {
        await api.callModuleAction('embeds', 'unschedule', { embed_id: id });
        location.reload();
      } catch (err) {
        alert(errorMessage(err));
      }
    }
  });
}

function setupEmbedsPage() {
  // Auf anderen Seiten gibt es das Element nicht — dann ist nichts zu tun
  const list = byId('embeds-list');
  if (!list || list.dataset.bound === 'true') return;
  list.dataset.bound = 'true';

  // Konfiguration bei jedem Aufruf neu lesen: nach einem Serverwechsel gilt die neue guildId
  const config = readPageConfig<EmbedsConfig>(list);
  const api = createDashboardApi(config.guildId, config.i18n);

  setupMarkdownToolbars();
  setupEmbeds(list, api, config);
}

document.addEventListener('astro:page-load', setupEmbedsPage);
