// Verhalten der Nachrichtenlisten (Markup aus src/components/MessageListEditor.astro).
// Jede Liste trägt ihr eigenes data-config; mehrere Listen auf einer Seite stören sich nicht.
import { renderPreview } from '../lib/discordMarkdown';
import type { DashboardApi } from './dashboard-api';

interface EditorConfig {
  module: 'welcome' | 'boosts';
  limit: number;
  previewVars: Record<string, string>;
  i18n: {
    edit: string;
    delete: string;
    previewLabel: string;
    formAddTitle: string;
    formEditTitle: string;
    alertMessageRequired: string;
    confirmDeleteMessage: string;
  };
}

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

function setupEditor(root: HTMLElement, api: DashboardApi) {
  if (root.dataset.bound === 'true') return;
  root.dataset.bound = 'true';

  const { module, limit, previewVars, i18n } = JSON.parse(root.dataset.config ?? '{}') as EditorConfig;
  const el = <T extends HTMLElement = HTMLElement>(role: string) => root.querySelector<T>(`[data-role="${role}"]`)!;
  const addBtn = el<HTMLButtonElement>('add');
  const list = el('list');
  const form = el('form');
  const formTitle = el('form-title');
  const textarea = el<HTMLTextAreaElement>('textarea');
  const previewEl = el('preview');
  const confirmBtn = el<HTMLButtonElement>('confirm');
  const cancelBtn = el<HTMLButtonElement>('cancel');

  const preview = (text: string) => renderPreview(text, previewVars);
  let editingId: string | null = null;

  function updatePreview() {
    const val = textarea.value.trim();
    previewEl.innerHTML = val ? preview(val) : '—';
  }
  textarea.addEventListener('input', updatePreview);

  function openForm(row?: HTMLElement) {
    editingId = row ? row.dataset.messageRow! : null;
    formTitle.textContent = row ? i18n.formEditTitle : i18n.formAddTitle;
    textarea.value = row ? row.querySelector('[data-message-text]')!.textContent ?? '' : '';
    updatePreview();
    form.classList.remove('hidden');
    textarea.focus();
  }
  function closeForm() {
    form.classList.add('hidden');
    editingId = null;
  }

  addBtn.addEventListener('click', () => openForm());
  cancelBtn.addEventListener('click', closeForm);

  function buildRow(id: string, text: string) {
    const row = document.createElement('div');
    row.className = 'rounded-lg border border-slate-200 dark:border-slate-800 p-4';
    row.dataset.messageRow = id;
    row.innerHTML = `
      <div class="flex items-start justify-between gap-4">
        <p class="text-sm text-slate-700 dark:text-slate-300 flex-1" data-message-text></p>
        <div class="flex items-center gap-3 flex-shrink-0">
          <button type="button" data-edit-message class="text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-primary-600 dark:hover:text-primary-400 hover:underline">${i18n.edit}</button>
          <button type="button" data-remove-message class="text-xs font-medium text-red-600 dark:text-red-400 hover:underline">${i18n.delete}</button>
        </div>
      </div>
      <div class="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800/60">
        <p class="text-xs text-slate-400 mb-1">${i18n.previewLabel}</p>
        <p class="text-sm text-slate-600 dark:text-slate-400 italic" data-message-preview></p>
      </div>
    `;
    // Text per DOM-API setzen — so kann nichts davon Markup werden
    row.querySelector<HTMLElement>('[data-edit-message]')!.dataset.editMessage = id;
    row.querySelector<HTMLElement>('[data-remove-message]')!.dataset.removeMessage = id;
    row.querySelector('[data-message-text]')!.textContent = text;
    row.querySelector('[data-message-preview]')!.innerHTML = preview(text);
    return row;
  }

  confirmBtn.addEventListener('click', async () => {
    const text = textarea.value.trim();
    if (!text) { alert(i18n.alertMessageRequired); return; }

    confirmBtn.disabled = true;
    try {
      if (editingId) {
        await api.callModuleAction(module, 'edit-message', { message_id: editingId, message: text });
        const row = list.querySelector<HTMLElement>(`[data-message-row="${CSS.escape(editingId)}"]`);
        if (row) {
          row.querySelector('[data-message-text]')!.textContent = text;
          row.querySelector('[data-message-preview]')!.innerHTML = preview(text);
        }
      } else {
        const result = await api.callModuleAction<{ id: number }>(module, 'add-message', { message: text });
        list.appendChild(buildRow(String(result.id), text));
        addBtn.disabled = list.querySelectorAll('[data-message-row]').length >= limit;
      }
      closeForm();
    } catch (err) {
      alert(errorMessage(err));
    } finally {
      confirmBtn.disabled = false;
    }
  });

  // Delegiert, damit auch neu angelegte Zeilen funktionieren
  list.addEventListener('click', async (event) => {
    const target = event.target as HTMLElement;
    const row = target.closest<HTMLElement>('[data-message-row]');
    if (!row) return;

    if (target.closest('[data-edit-message]')) {
      openForm(row);
      return;
    }
    if (target.closest('[data-remove-message]')) {
      if (!confirm(i18n.confirmDeleteMessage)) return;
      try {
        await api.callModuleAction(module, 'delete-message', { message_id: row.dataset.messageRow });
        if (editingId === row.dataset.messageRow) closeForm();
        row.remove();
      } catch (err) {
        alert(errorMessage(err));
      }
    }
  });
}

export function setupMessageEditors(api: DashboardApi) {
  document.querySelectorAll<HTMLElement>('[data-message-editor]').forEach((root) => setupEditor(root, api));
}
