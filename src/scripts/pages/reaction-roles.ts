// Browser-Logik der Reaction-Roles-Seite (/server/<id>/modules/reaction-roles/).
// Gebündeltes Modul: läuft einmal pro Seitenladen; bei Navigation über den ClientRouter
// sorgt astro:page-load dafür, dass die neue Seite neu verdrahtet wird.
import { renderDiscordMarkdown } from '../../lib/discordMarkdown';
import { byId, createDashboardApi, readPageConfig, type ApiMessages, type DashboardApi } from '../dashboard-api';
import { setupMarkdownToolbars } from '../markdown-toolbar';

interface ReactionRolesConfig {
  guildId: string;
  i18n: ApiMessages & {
    remove: string;
    roleCountTemplate: string;        // enthält "{count}"
    uniqueGroupBadgeTemplate: string; // enthält "{group}"
    toggleOption: string;
    uniqueOption: string;
    addEntryBtn: string;
    deleteMessageBtn: string;
    noEntries: string;
    alertGroupNameRequired: string;
    alertTitleDescRequired: string;
    alertEmojiRequired: string;
    alertInvalidEmoji: string;
    confirmDeleteEntry: string;
    confirmDeleteMessage: string;
    displayModeReactionOption: string;
    displayModeDropdownOption: string;
    editBtn: string;
    saveBtn: string;
    createBtn: string;
    newMessageFormTitle: string;
    editMessageFormTitle: string;
    editStatusSavedOnly: string;
    editStatusNotOwn: string;
    editStatusFailed: string;
  };
}

type I18n = ReactionRolesConfig['i18n'];
const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

const EMOJI_REGEX = /^(\p{Extended_Pictographic}|\p{Emoji_Presentation}|[‍️⃣])+$/u;
const CUSTOM_EMOJI_REGEX = /^<a?:\w+:\d+>$/;
const isValidEmojiInput = (value: string) => CUSTOM_EMOJI_REGEX.test(value) || EMOJI_REGEX.test(value);

const BADGE_PRIMARY = 'bg-primary-100 dark:bg-primary-900/30 text-primary-800 dark:text-primary-300 border border-primary-200 dark:border-primary-800';
const BADGE_NEUTRAL = 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700';
const BADGE_BASE = 'inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold tracking-wide uppercase';

// ─── Beschreibungs-Vorschau ──────────────────────────────────────────────────
function setupDescPreview() {
  const descInput = byId<HTMLTextAreaElement>('new-msg-desc');
  const previewEl = byId('new-msg-desc-preview');
  if (!descInput || !previewEl || descInput.dataset.previewBound === 'true') return;
  descInput.dataset.previewBound = 'true';
  descInput.addEventListener('input', () => {
    const val = descInput.value.trim();
    previewEl.innerHTML = val ? renderDiscordMarkdown(val) : '—';
  });
}

// ─── Gruppen ─────────────────────────────────────────────────────────────────
function setupGroups(api: DashboardApi, i18n: I18n) {
  const addGroupBtn = byId<HTMLButtonElement>('add-group-btn');
  const groupForm = byId('group-form')!;
  const nameInput = byId<HTMLInputElement>('new-group-name-input')!;
  const confirmBtn = byId<HTMLButtonElement>('confirm-group-btn')!;
  const cancelBtn = byId<HTMLButtonElement>('cancel-group-btn')!;
  const groupsList = byId('groups-list')!;
  const entryGroupSelect = byId<HTMLSelectElement>('entry-group-select')!;

  if (!addGroupBtn || addGroupBtn.dataset.bound === 'true') return;
  addGroupBtn.dataset.bound = 'true';

  addGroupBtn.addEventListener('click', () => { groupForm.classList.remove('hidden'); nameInput.focus(); });
  cancelBtn.addEventListener('click', () => { groupForm.classList.add('hidden'); nameInput.value = ''; });

  confirmBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    if (!name) { alert(i18n.alertGroupNameRequired); return; }

    confirmBtn.disabled = true;
    try {
      const result = await api.callModuleAction<{ id: number }>('reaction_roles', 'create-group', { name });
      const row = document.createElement('div');
      row.className = 'flex items-center justify-between p-3 rounded-lg border border-slate-200 dark:border-slate-800';
      row.dataset.groupRow = String(result.id);
      row.innerHTML = `
        <div class="flex items-center gap-2">
          <span class="text-sm font-medium text-slate-900 dark:text-white"></span>
          <span class="${BADGE_BASE} ${BADGE_PRIMARY}">${i18n.uniqueOption}</span>
        </div>
        <span class="text-xs text-slate-400" data-group-role-count>${i18n.roleCountTemplate.replace('{count}', '0')}</span>
      `;
      row.querySelector('span.text-sm')!.textContent = name;
      groupsList.appendChild(row);

      const opt = document.createElement('option');
      opt.value = String(result.id);
      opt.textContent = name;
      entryGroupSelect.appendChild(opt);

      groupForm.classList.add('hidden');
      nameInput.value = '';
    } catch (err) {
      alert(errorMessage(err));
    } finally {
      confirmBtn.disabled = false;
    }
  });
}

// ─── Neue Nachricht / Nachricht bearbeiten ───────────────────────────────────
// Ein gemeinsames Formular für beide Fälle (wie auf der Embeds-Seite): im Edit-Modus sind
// Channel und Anzeige-Modus ausgeblendet, weil die Bot-Action update-message nur Titel/Text ändert.
function setupNewMessage(api: DashboardApi, i18n: I18n) {
  const newMsgBtn = byId<HTMLButtonElement>('new-message-btn');
  const form = byId('new-message-form')!;
  const formTitle = byId('message-form-title')!;
  const channelWrap = byId('new-msg-channel-wrap')!;
  const displayWrap = byId('new-msg-display-wrap')!;
  const channelSelect = byId<HTMLSelectElement>('new-msg-channel')!;
  const titleInput = byId<HTMLInputElement>('new-msg-title')!;
  const descInput = byId<HTMLTextAreaElement>('new-msg-desc')!;
  const displayModeSelect = byId<HTMLSelectElement>('new-msg-display-mode')!;
  const confirmBtn = byId<HTMLButtonElement>('confirm-new-message-btn')!;
  const cancelBtn = byId<HTMLButtonElement>('cancel-new-message-btn')!;
  const list = byId('messages-list')!;
  const descPreview = byId('new-msg-desc-preview');

  if (!newMsgBtn || newMsgBtn.dataset.bound === 'true') return;
  newMsgBtn.dataset.bound = 'true';

  let editingId: string | null = null;

  const updatePreview = () => {
    const val = descInput.value.trim();
    if (descPreview) descPreview.innerHTML = val ? renderDiscordMarkdown(val) : '—';
  };

  function openForm(mode: 'create' | 'edit', block?: HTMLElement) {
    editingId = mode === 'edit' && block ? block.dataset.messageBlock! : null;
    const isEdit = editingId !== null;
    formTitle.textContent = isEdit ? i18n.editMessageFormTitle : i18n.newMessageFormTitle;
    confirmBtn.textContent = isEdit ? i18n.saveBtn : i18n.createBtn;
    channelWrap.classList.toggle('hidden', isEdit);
    displayWrap.classList.toggle('hidden', isEdit);
    titleInput.value = isEdit ? block!.dataset.title ?? '' : '';
    descInput.value = isEdit ? block!.dataset.description ?? '' : '';
    updatePreview();
    form.classList.remove('hidden');
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    titleInput.focus();
  }

  function closeForm() {
    form.classList.add('hidden');
    editingId = null;
  }

  newMsgBtn.addEventListener('click', () => openForm('create'));
  cancelBtn.addEventListener('click', closeForm);

  // Delegiert, damit auch Buttons neu angelegter Nachrichten funktionieren
  list.addEventListener('click', (event) => {
    const editBtn = (event.target as HTMLElement).closest<HTMLElement>('[data-edit-message]');
    if (!editBtn) return;
    const block = editBtn.closest<HTMLElement>('[data-message-block]');
    if (block) openForm('edit', block);
  });

  async function saveEdit(messageId: string, title: string, description: string) {
    const result = await api.callModuleAction<{ status: string }>('reaction_roles', 'update-message', {
      message_id: messageId, title, description,
    });

    const block = list.querySelector<HTMLElement>(`[data-message-block="${CSS.escape(messageId)}"]`);
    if (block) {
      block.dataset.title = title;
      block.dataset.description = description;
      block.querySelector<HTMLElement>('[data-msg-title]')!.textContent = title;
      block.querySelector<HTMLElement>('[data-msg-desc]')!.innerHTML = renderDiscordMarkdown(description);
    }
    closeForm();

    // Der Text ist in jedem Fall gespeichert; der Status sagt, ob Discord nachgezogen wurde
    const hint = ({ saved_only: i18n.editStatusSavedOnly, not_own: i18n.editStatusNotOwn, failed: i18n.editStatusFailed } as Record<string, string>)[result.status];
    if (hint) alert(hint);
  }

  async function createMessage(title: string, description: string) {
    const channelId = channelSelect.value;
    const channelName = channelSelect.selectedOptions[0]?.dataset.channelName ?? '';
    const displayMode = displayModeSelect.value;
    const result = await api.callModuleAction<{ message_id: string }>('reaction_roles', 'create-message', {
      channel_id: channelId, title, description, display_mode: displayMode,
    });

    const modeLabel = displayMode === 'dropdown' ? i18n.displayModeDropdownOption : i18n.displayModeReactionOption;
    const modeBadgeClass = displayMode === 'dropdown' ? BADGE_PRIMARY : BADGE_NEUTRAL;

    const block = document.createElement('div');
    block.className = 'mb-5 last:mb-0';
    block.dataset.messageBlock = result.message_id;
    block.dataset.title = title;
    block.dataset.description = description;
    block.innerHTML = `
      <div class="flex items-center justify-between mb-2">
        <div class="flex items-center gap-2">
          <span class="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400" data-channel-label></span>
          <span class="text-xs text-slate-400 font-mono" data-message-id-label></span>
          <span class="${BADGE_BASE} ${modeBadgeClass}">${modeLabel}</span>
        </div>
        <div class="flex items-center gap-3">
          <button type="button" data-edit-message class="text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-primary-600 dark:hover:text-primary-400 hover:underline">${i18n.editBtn}</button>
          <button type="button" data-add-entry-to class="text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline">+ ${i18n.addEntryBtn}</button>
          <button type="button" data-delete-message class="text-xs font-medium text-red-600 dark:text-red-400 hover:underline">${i18n.deleteMessageBtn}</button>
        </div>
      </div>
      <div class="mb-2">
        <p class="text-sm font-semibold text-slate-900 dark:text-white truncate" data-msg-title></p>
        <p class="text-xs text-slate-500 dark:text-slate-400 italic" data-msg-desc></p>
      </div>
      <div class="space-y-2" data-entries-list></div>
      <p class="text-sm text-slate-400 py-2">${i18n.noEntries}</p>
    `;
    // IDs und Namen per DOM-API setzen statt in den HTML-String — so kann nichts davon Markup werden
    block.querySelector<HTMLElement>('[data-channel-label]')!.textContent = `#${channelName}`;
    block.querySelector<HTMLElement>('[data-message-id-label]')!.textContent = result.message_id;
    block.querySelector<HTMLElement>('[data-edit-message]')!.dataset.editMessage = result.message_id;
    const addBtn = block.querySelector<HTMLElement>('[data-add-entry-to]')!;
    addBtn.dataset.addEntryTo = result.message_id;
    addBtn.dataset.channelId = channelId;
    const deleteBtn = block.querySelector<HTMLElement>('[data-delete-message]')!;
    deleteBtn.dataset.deleteMessage = result.message_id;
    deleteBtn.dataset.channelId = channelId;
    block.querySelector<HTMLElement>('[data-entries-list]')!.dataset.entriesList = result.message_id;
    block.querySelector<HTMLElement>('[data-msg-title]')!.textContent = title;
    block.querySelector<HTMLElement>('[data-msg-desc]')!.innerHTML = renderDiscordMarkdown(description);
    list.appendChild(block);

    closeForm();
  }

  confirmBtn.addEventListener('click', async () => {
    const title = titleInput.value.trim();
    const description = descInput.value.trim();
    if (!title || !description) { alert(i18n.alertTitleDescRequired); return; }

    confirmBtn.disabled = true;
    try {
      if (editingId) await saveEdit(editingId, title, description);
      else await createMessage(title, description);
    } catch (err) {
      alert(errorMessage(err));
    } finally {
      confirmBtn.disabled = false;
    }
  });
}

// ─── Zuordnungen hinzufügen ──────────────────────────────────────────────────
function setupEntryForm(api: DashboardApi, i18n: I18n) {
  const entryForm = byId('entry-form');
  const list = byId('messages-list')!;
  const roleSelect = byId<HTMLSelectElement>('entry-role-select')!;
  const emojiInput = byId<HTMLInputElement>('entry-emoji-input')!;
  const modeSelect = byId<HTMLSelectElement>('entry-mode-select')!;
  const groupWrap = byId('entry-group-wrap')!;
  const groupSelect = byId<HTMLSelectElement>('entry-group-select')!;
  const confirmBtn = byId<HTMLButtonElement>('confirm-entry-btn')!;
  const cancelBtn = byId<HTMLButtonElement>('cancel-entry-btn')!;

  if (!entryForm || entryForm.dataset.bound === 'true') return;
  entryForm.dataset.bound = 'true';

  let target: { messageId: string; channelId: string } | null = null;

  modeSelect.addEventListener('change', () => {
    groupWrap.classList.toggle('hidden', modeSelect.value !== 'unique');
  });

  document.querySelectorAll<HTMLButtonElement>('[data-custom-emoji]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      emojiInput.value = btn.dataset.customEmoji ?? '';
    });
  });

  // Delegiert, damit auch Buttons neu angelegter Nachrichten funktionieren
  list.addEventListener('click', (event) => {
    const addBtn = (event.target as HTMLElement).closest<HTMLElement>('[data-add-entry-to]');
    if (!addBtn) return;
    target = { messageId: addBtn.dataset.addEntryTo!, channelId: addBtn.dataset.channelId! };
    emojiInput.value = '';
    modeSelect.value = 'toggle';
    groupWrap.classList.add('hidden');
    entryForm.classList.remove('hidden');
    entryForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  cancelBtn.addEventListener('click', () => { entryForm.classList.add('hidden'); target = null; });

  confirmBtn.addEventListener('click', async () => {
    if (!target) return;
    const emoji = emojiInput.value.trim();
    if (!emoji) { alert(i18n.alertEmojiRequired); return; }
    if (!isValidEmojiInput(emoji)) { alert(i18n.alertInvalidEmoji); return; }

    const mode = modeSelect.value;
    const groupId = mode === 'unique' ? groupSelect.value || null : null;
    const { messageId, channelId } = target;

    confirmBtn.disabled = true;
    try {
      const result = await api.callModuleAction<{ entry_id?: number; role_name: string }>('reaction_roles', 'add-entry', {
        channel_id: channelId,
        message_id: messageId,
        role_id: roleSelect.value,
        emoji, mode, group_id: groupId,
      });

      const block = list.querySelector<HTMLElement>(`[data-message-block="${CSS.escape(messageId)}"]`);
      const entriesList = block?.querySelector<HTMLElement>('[data-entries-list]');
      if (entriesList) {
        const emptyMsg = entriesList.nextElementSibling;
        if (emptyMsg && emptyMsg.tagName === 'P') emptyMsg.remove();

        const groupName = groupSelect.selectedOptions[0]?.textContent ?? '?';
        const row = document.createElement('div');
        row.className = 'flex items-center gap-4 p-3 rounded-lg border border-slate-200 dark:border-slate-800';
        row.dataset.entryRow = String(result.entry_id ?? Date.now());
        row.dataset.emoji = emoji;
        // emoji ist durch isValidEmojiInput auf Emoji-Zeichen bzw. <:name:id> beschränkt
        row.innerHTML = `
          <span class="text-lg flex-shrink-0 w-8 text-center">${emoji.startsWith('<') ? '🔹' : emoji}</span>
          <div class="flex items-center gap-2 flex-1 min-w-0">
            <span class="text-sm font-medium text-slate-900 dark:text-white truncate" data-role-name></span>
          </div>
          <span data-mode-label class="${BADGE_BASE} ${mode === 'unique' ? BADGE_PRIMARY : BADGE_NEUTRAL}"></span>
          <button type="button" data-remove-entry class="text-xs font-medium text-red-600 dark:text-red-400 hover:underline flex-shrink-0">${i18n.remove}</button>
        `;
        row.querySelector<HTMLElement>('[data-role-name]')!.textContent = result.role_name;
        row.querySelector<HTMLElement>('[data-mode-label]')!.textContent =
          mode === 'unique' ? i18n.uniqueGroupBadgeTemplate.replace('{group}', () => groupName) : i18n.toggleOption;
        const removeBtn = row.querySelector<HTMLElement>('[data-remove-entry]')!;
        removeBtn.dataset.messageId = messageId;
        removeBtn.dataset.channelId = channelId;
        entriesList.appendChild(row);
      }

      entryForm.classList.add('hidden');
      target = null;
    } catch (err) {
      alert(errorMessage(err));
    } finally {
      confirmBtn.disabled = false;
    }
  });
}

// ─── Zuordnungen und Nachrichten löschen ─────────────────────────────────────
function setupDeletes(api: DashboardApi, i18n: I18n) {
  const list = byId('messages-list');
  if (!list || list.dataset.deletesBound === 'true') return;
  list.dataset.deletesBound = 'true';

  // Ein delegierter Listener für vom Server gerenderte und neu angelegte Einträge
  list.addEventListener('click', async (event) => {
    const el = event.target as HTMLElement;

    const removeBtn = el.closest<HTMLElement>('[data-remove-entry]');
    if (removeBtn) {
      const row = removeBtn.closest<HTMLElement>('[data-entry-row]')!;
      if (!confirm(i18n.confirmDeleteEntry)) return;
      try {
        await api.callModuleAction('reaction_roles', 'delete-entry', {
          entry_id: row.dataset.entryRow,
          message_id: removeBtn.dataset.messageId,
          channel_id: removeBtn.dataset.channelId,
          emoji: row.dataset.emoji,
        });
        row.remove();
      } catch (err) {
        alert(errorMessage(err));
      }
      return;
    }

    const deleteBtn = el.closest<HTMLElement>('[data-delete-message]');
    if (deleteBtn) {
      const block = deleteBtn.closest<HTMLElement>('[data-message-block]')!;
      if (!confirm(i18n.confirmDeleteMessage)) return;
      try {
        await api.callModuleAction('reaction_roles', 'delete-message', {
          message_id: deleteBtn.dataset.deleteMessage,
          channel_id: deleteBtn.dataset.channelId,
        });
        block.remove();
      } catch (err) {
        alert(errorMessage(err));
      }
    }
  });
}

// ─── Einstieg ────────────────────────────────────────────────────────────────
function setupReactionRolesPage() {
  const root = byId('reaction-roles-page');
  if (!root) return;

  // Konfiguration bei jedem Aufruf neu lesen: nach einem Serverwechsel gilt die neue guildId
  const config = readPageConfig<ReactionRolesConfig>(root);
  const api = createDashboardApi(config.guildId, config.i18n);

  setupMarkdownToolbars();
  setupDescPreview();
  setupGroups(api, config.i18n);
  setupNewMessage(api, config.i18n);
  setupEntryForm(api, config.i18n);
  setupDeletes(api, config.i18n);
}

document.addEventListener('astro:page-load', setupReactionRolesPage);
