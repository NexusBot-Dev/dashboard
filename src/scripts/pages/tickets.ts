// Browser-Logik der Ticket-Seite (/server/<id>/tickets/).
// Gebündeltes Modul: läuft einmal pro Seitenladen; bei Navigation über den ClientRouter
// sorgt astro:page-load dafür, dass die neue Seite neu verdrahtet wird.
import { renderDiscordMarkdown } from '../../lib/discordMarkdown';
import { byId, createDashboardApi, readPageConfig, type ApiMessages, type DashboardApi } from '../dashboard-api';
import { setupMarkdownToolbars } from '../markdown-toolbar';

interface TicketsConfig {
  guildId: string;
  tabActive: string;
  tabInactive: string;
  i18n: ApiMessages & {
    saving: string;
    save: string;
    categoryFormAddTitle: string;
    categoryFormEditTitle: string;
    alertNameRequired: string;
    confirmDeleteCategory: string;
    alertTitleDescRequired: string;
    confirmPostPanelTemplate: string; // enthält "{channel}"
    confirmMovePanelTemplate: string; // enthält "{channel}"
    alertPanelPosted: string;
    alertPanelUpdated: string;
    alertImportLinkRequired: string;
    alertPanelImported: string;
  };
}

type I18n = TicketsConfig['i18n'];
const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

// ─── Tabs ────────────────────────────────────────────────────────────────────
function setupTabs(root: HTMLElement, config: TicketsConfig) {
  if (root.dataset.bound === 'true') return;
  root.dataset.bound = 'true';

  const tabs = Array.from(root.querySelectorAll<HTMLElement>('[role="tab"]'));
  const panels = new Map(
    Array.from(root.querySelectorAll<HTMLElement>('[data-tab-panel]')).map((p) => [p.dataset.tabPanel!, p])
  );

  function activate(name: string, { updateHash = true, focus = false } = {}) {
    if (!panels.has(name)) name = tabs[0].dataset.tab!;
    tabs.forEach((tab) => {
      const active = tab.dataset.tab === name;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      tab.classList.remove(...(active ? config.tabInactive : config.tabActive).split(' '));
      tab.classList.add(...(active ? config.tabActive : config.tabInactive).split(' '));
      if (active && focus) tab.focus();
    });
    panels.forEach((panel, key) => panel.classList.toggle('hidden', key !== name));
    if (updateHash) history.replaceState(history.state, '', `#${name}`);
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activate(tab.dataset.tab!));
    tab.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      event.preventDefault();
      const next = (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      activate(tabs[next].dataset.tab!, { focus: true });
    });
  });

  activate(location.hash.slice(1), { updateHash: false });
}

// ─── Live-Vorschau der Panel-Beschreibung ────────────────────────────────────
function setupPreview() {
  const textarea = byId<HTMLTextAreaElement>('tickets-textarea');
  const previewEl = byId('tickets-preview');
  if (!textarea || !previewEl || textarea.dataset.previewBound === 'true') return;
  textarea.dataset.previewBound = 'true';
  textarea.addEventListener('input', () => {
    const val = textarea.value.trim();
    previewEl.innerHTML = val ? renderDiscordMarkdown(val) : '—';
  });
}

// ─── Kategorien ──────────────────────────────────────────────────────────────
// Nach jeder Änderung wird neu geladen: Zähler, Limit und Panel-Hinweise kommen so immer
// frisch vom Server, und es gibt keinen selbst gebauten HTML-Code mit Nutzereingaben.
function setupCategories(api: DashboardApi, i18n: I18n) {
  const addBtn = byId<HTMLButtonElement>('add-category-btn');
  const form = byId('category-form');
  if (!addBtn || !form || addBtn.dataset.bound === 'true') return;
  addBtn.dataset.bound = 'true';

  const formTitle = byId('category-form-title')!;
  const nameInput = byId<HTMLInputElement>('category-name-input')!;
  const confirmBtn = byId<HTMLButtonElement>('confirm-category-btn')!;
  const cancelBtn = byId<HTMLButtonElement>('cancel-category-btn')!;
  const list = byId('categories-list')!;
  const roleCheckboxes = () => Array.from(form.querySelectorAll<HTMLInputElement>('[data-role-checkbox]'));

  let editingId: string | null = null;
  let editingName = '';

  function openForm(row: HTMLElement | null) {
    editingId = row ? row.dataset.categoryRow ?? null : null;
    editingName = row ? row.dataset.categoryName ?? '' : '';
    formTitle.textContent = row ? i18n.categoryFormEditTitle : i18n.categoryFormAddTitle;
    nameInput.value = editingName;
    const checkedIds: string[] = row ? JSON.parse(row.dataset.roleIds || '[]') : [];
    roleCheckboxes().forEach((cb) => { cb.checked = checkedIds.includes(cb.value); });
    form!.classList.remove('hidden');
    nameInput.focus();
  }
  function closeForm() { form!.classList.add('hidden'); editingId = null; }

  addBtn.addEventListener('click', () => openForm(null));
  cancelBtn.addEventListener('click', closeForm);

  list.querySelectorAll<HTMLButtonElement>('[data-edit-category]').forEach((btn) => {
    btn.addEventListener('click', () => openForm(btn.closest<HTMLElement>('[data-category-row]')));
  });

  list.querySelectorAll<HTMLButtonElement>('[data-remove-category]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm(i18n.confirmDeleteCategory)) return;
      const row = btn.closest<HTMLElement>('[data-category-row]')!;
      btn.disabled = true;
      try {
        await api.callModuleAction('tickets', 'delete-category', { category_id: Number(row.dataset.categoryRow) });
        location.reload();
      } catch (err) {
        alert(errorMessage(err));
        btn.disabled = false;
      }
    });
  });

  confirmBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    if (!name) { alert(i18n.alertNameRequired); return; }
    const roleIds = roleCheckboxes().filter((cb) => cb.checked).map((cb) => cb.value);

    confirmBtn.disabled = true;
    try {
      if (editingId) {
        const id = Number(editingId);
        if (name !== editingName) await api.callModuleAction('tickets', 'rename-category', { category_id: id, name });
        await api.callModuleAction('tickets', 'set-category-roles', { category_id: id, role_ids: roleIds });
      } else {
        await api.callModuleAction('tickets', 'create-category', { name, role_ids: roleIds });
      }
      location.reload();
    } catch (err) {
      alert(errorMessage(err));
      confirmBtn.disabled = false;
    }
  });
}

// ─── Panel ───────────────────────────────────────────────────────────────────
function setupPanel(api: DashboardApi, i18n: I18n) {
  const btn = byId<HTMLButtonElement>('post-panel-btn');
  const form = byId('panel-form');
  if (!btn || !form || btn.dataset.bound === 'true') return;
  btn.dataset.bound = 'true';

  const channelSelect = byId<HTMLSelectElement>('panel-channel-select');
  const titleInput = byId<HTMLInputElement>('panel-title-input')!;
  const descInput = byId<HTMLTextAreaElement>('tickets-textarea')!;

  btn.addEventListener('click', async () => {
    const title = titleInput.value.trim();
    const description = descInput.value.trim();
    if (!title || !description) { alert(i18n.alertTitleDescRequired); return; }

    const hasPanel = form.dataset.hasPanel === 'true';
    const currentChannel = form.dataset.panelChannelId || '';
    const selected = channelSelect ? channelSelect.value : '';
    const option = channelSelect ? channelSelect.selectedOptions[0] : null;
    const channelName = option?.textContent?.replace('#', '') ?? '';

    if (!hasPanel) {
      if (!confirm(i18n.confirmPostPanelTemplate.replace('{channel}', () => channelName))) return;
    } else if (selected && currentChannel && selected !== currentChannel) {
      if (!confirm(i18n.confirmMovePanelTemplate.replace('{channel}', () => channelName))) return;
    }

    btn.disabled = true;
    try {
      const body: Record<string, unknown> = { title, description };
      if (selected) body.channel_id = selected;
      const result = await api.callModuleAction<{ edited: boolean }>('tickets', 'post-panel', body);
      alert(result.edited ? i18n.alertPanelUpdated : i18n.alertPanelPosted);
      location.reload();
    } catch (err) {
      alert(errorMessage(err));
      btn.disabled = false;
    }
  });
}

function setupImport(api: DashboardApi, i18n: I18n) {
  const btn = byId<HTMLButtonElement>('import-panel-btn');
  const input = byId<HTMLInputElement>('import-panel-input');
  if (!btn || !input || btn.dataset.bound === 'true') return;
  btn.dataset.bound = 'true';

  btn.addEventListener('click', async () => {
    const link = input.value.trim();
    if (!link) { alert(i18n.alertImportLinkRequired); return; }
    btn.disabled = true;
    try {
      await api.callModuleAction('tickets', 'import-panel', { link });
      alert(i18n.alertPanelImported);
      location.reload();
    } catch (err) {
      alert(errorMessage(err));
      btn.disabled = false;
    }
  });
}

// ─── Fristen ─────────────────────────────────────────────────────────────────
function setupTimeouts(api: DashboardApi, i18n: I18n) {
  const closure = byId<HTMLSelectElement>('closure-select');
  const deletion = byId<HTMLSelectElement>('deletion-select');
  const saveBtn = byId<HTMLButtonElement>('save-timeouts-btn');
  if (!closure || !deletion || !saveBtn || saveBtn.dataset.bound === 'true') return;
  saveBtn.dataset.bound = 'true';

  const closureChanged = () => closure.value !== closure.dataset.initial;
  const deletionChanged = () => deletion.value !== deletion.dataset.initial;
  const refresh = () => { saveBtn.disabled = !(closureChanged() || deletionChanged()); };
  closure.addEventListener('change', refresh);
  deletion.addEventListener('change', refresh);

  saveBtn.addEventListener('click', async () => {
    // Nur geänderte Werte schicken — der Bot akzeptiert ausschließlich die festen Auswahlwerte
    const body: Record<string, number> = {};
    if (closureChanged()) body.closure_timeout_hours = Number(closure.value);
    if (deletionChanged()) body.deletion_delay_hours = Number(deletion.value);

    saveBtn.disabled = true;
    saveBtn.textContent = i18n.saving;
    try {
      const result = await api.callModuleAction<{ closure_timeout_hours: number; deletion_delay_hours: number }>(
        'tickets', 'set-timeouts', body
      );
      closure.dataset.initial = String(result.closure_timeout_hours);
      deletion.dataset.initial = String(result.deletion_delay_hours);
    } catch (err) {
      alert(errorMessage(err));
    } finally {
      saveBtn.textContent = i18n.save;
      refresh();
    }
  });
}

// ─── Ticket-Log-Channel ("editable in both places") ──────────────────────────
function setupLogChannel(api: DashboardApi, i18n: I18n) {
  const select = byId<HTMLSelectElement>('log-channel-select');
  const saveBtn = byId<HTMLButtonElement>('save-log-channel-btn');
  if (!select || !saveBtn || saveBtn.dataset.bound === 'true') return;
  saveBtn.dataset.bound = 'true';

  select.addEventListener('change', () => { saveBtn.disabled = select.value === select.dataset.initial; });

  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    saveBtn.textContent = i18n.saving;
    try {
      await api.saveSettings({ ticket_log_channel_id: select.value }); // '' = kein eigener Channel
      select.dataset.initial = select.value;
    } catch (err) {
      alert(errorMessage(err));
    } finally {
      saveBtn.textContent = i18n.save;
      saveBtn.disabled = select.value === select.dataset.initial;
    }
  });
}

function setupTicketsPage() {
  // Auf anderen Seiten gibt es das Element nicht — dann ist nichts zu tun
  const root = byId('tickets-tabs');
  if (!root) return;

  // Konfiguration bei jedem Aufruf neu lesen: nach einem Serverwechsel gilt die neue guildId
  const config = readPageConfig<TicketsConfig>(root);
  const api = createDashboardApi(config.guildId, config.i18n);

  setupTabs(root, config);
  setupMarkdownToolbars();
  setupPreview();
  setupCategories(api, config.i18n);
  setupPanel(api, config.i18n);
  setupImport(api, config.i18n);
  setupTimeouts(api, config.i18n);
  setupLogChannel(api, config.i18n);
}

// Feuert beim ersten Laden und nach jeder Navigation über den ClientRouter.
// Das Modul selbst läuft nur einmal, daher wird der Listener genau einmal registriert.
document.addEventListener('astro:page-load', setupTicketsPage);
