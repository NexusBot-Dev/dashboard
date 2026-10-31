// Browser-Logik des Levelsystems (/server/<id>/modules/levels/).
// Gebündeltes Modul: läuft einmal pro Seitenladen; bei Navigation über den ClientRouter
// sorgt astro:page-load dafür, dass die neue Seite neu verdrahtet wird.
import { byId, createDashboardApi, readPageConfig, type ApiMessages, type DashboardApi } from '../dashboard-api';

interface ExcludeTarget {
  id: string;
  name: string;
  type: 'category' | 'channel';
  category: string | null;
}

interface LevelsConfig {
  guildId: string;
  botOnline: boolean;
  exclude: { ids: string[]; targets: ExcludeTarget[]; limit: number };
  i18n: Omit<ApiMessages, 'unexpectedResponseTemplate'> & {
    save: string;
    saving: string;
    remove: string;
    roleFormAddTitle: string;
    roleFormEditTitleTemplate: string;  // enthält "{level}"
    levelBadgeTemplate: string;         // enthält "{level}"
    alertInvalidXp: string;
    alertMinGtMax: string;
    alertInvalidLevel: string;
    alertNoRole: string;
    confirmRemoveRoleTemplate: string;  // enthält "{level}"
    excludeSelectPlaceholder: string;
    excludeGroupCategories: string;
    excludeGroupChannels: string;
    excludeCountTemplate: string;       // enthält "{count}" und "{limit}"
  };
}

type I18n = LevelsConfig['i18n'];
const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

function setupXpSettings(api: DashboardApi, i18n: I18n) {
  const minInput = byId<HTMLInputElement>('xp-min-input');
  const maxInput = byId<HTMLInputElement>('xp-max-input');
  const saveBtn = byId<HTMLButtonElement>('save-xp-btn');
  if (!minInput || !maxInput || !saveBtn) return;

  const isDirty = () => minInput.value !== minInput.dataset.initial || maxInput.value !== maxInput.dataset.initial;
  const refresh = () => { saveBtn.disabled = !isDirty(); };
  minInput.addEventListener('input', refresh);
  maxInput.addEventListener('input', refresh);

  saveBtn.addEventListener('click', async () => {
    // Number statt parseInt: aus „12.5“ würde sonst still 12
    const xpMin = Number(minInput.value);
    const xpMax = Number(maxInput.value);
    if (!Number.isInteger(xpMin) || !Number.isInteger(xpMax)) { alert(i18n.alertInvalidXp); return; }
    if (xpMin < 1 || xpMin > 1000 || xpMax < 1 || xpMax > 1000) { alert(i18n.alertInvalidXp); return; }
    if (xpMin > xpMax) { alert(i18n.alertMinGtMax); return; }

    saveBtn.disabled = true;
    saveBtn.textContent = i18n.saving;
    try {
      await api.callModuleAction('leveling', 'set-xp-settings', { xp_min: xpMin, xp_max: xpMax });
      minInput.dataset.initial = minInput.value;
      maxInput.dataset.initial = maxInput.value;
    } catch (err) {
      alert(errorMessage(err));
    } finally {
      saveBtn.textContent = i18n.save;
      refresh();
    }
  });
}

function setupLevelUpChannel(api: DashboardApi, i18n: I18n) {
  const select = byId<HTMLSelectElement>('levelup-channel-select');
  const saveBtn = byId<HTMLButtonElement>('save-levelup-btn');
  if (!select || !saveBtn) return;

  const refresh = () => { saveBtn.disabled = select.value === select.dataset.initial; };
  select.addEventListener('change', refresh);

  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    saveBtn.textContent = i18n.saving;
    try {
      await api.callModuleAction('leveling', 'set-levelup-channel', { channel_id: select.value || null });
      select.dataset.initial = select.value;
    } catch (err) {
      alert(errorMessage(err));
    } finally {
      saveBtn.textContent = i18n.save;
      refresh();
    }
  });
}

const CHIP_CLASS = 'inline-flex items-center gap-1.5 pl-3 pr-1.5 py-1 rounded-full text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700';
const CHIP_REMOVE_CLASS = 'w-5 h-5 inline-flex items-center justify-center rounded-full text-slate-500 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-40';

function setupXpExclude(api: DashboardApi, config: LevelsConfig) {
  const select = byId<HTMLSelectElement>('xp-exclude-select');
  const addBtn = byId<HTMLButtonElement>('add-xp-exclude-btn');
  const list = byId('xp-excluded-list');
  const emptyNote = byId('xp-excluded-empty');
  const countNote = byId('xp-exclude-count');
  if (!select || !addBtn || !list || !emptyNote || !countNote) return;

  const { i18n, botOnline } = config;
  const { targets, limit } = config.exclude;
  let ids = config.exclude.ids;
  const targetById = new Map(targets.map((item) => [item.id, item]));
  let busy = false;

  const chipText = (item: ExcludeTarget) => (item.type === 'category' ? '📁 ' : '#') + item.name;
  const optionText = (item: ExcludeTarget) =>
    item.type === 'category' ? item.name : `#${item.name}${item.category ? ` · ${item.category}` : ''}`;

  function refreshControls() {
    const full = ids.length >= limit;
    select!.disabled = !botOnline || busy || full || select!.options.length <= 1;
    addBtn!.disabled = select!.disabled || !select!.value;
    countNote!.textContent = i18n.excludeCountTemplate.replace('{count}', String(ids.length)).replace('{limit}', String(limit));
  }

  function renderChips() {
    list!.replaceChildren();
    ids.forEach((id) => {
      const item = targetById.get(id);
      if (!item) return;
      const chip = document.createElement('span');
      chip.className = CHIP_CLASS;
      const label = document.createElement('span');
      label.textContent = chipText(item);
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.textContent = '×';
      removeBtn.setAttribute('aria-label', `${i18n.remove}: ${label.textContent}`);
      removeBtn.disabled = !botOnline;
      removeBtn.className = CHIP_REMOVE_CLASS;
      removeBtn.addEventListener('click', () => save(ids.filter((x) => x !== id)));
      chip.append(label, removeBtn);
      list!.appendChild(chip);
    });
    emptyNote!.classList.toggle('hidden', ids.length > 0);
  }

  function renderSelect() {
    select!.replaceChildren(new Option(i18n.excludeSelectPlaceholder, ''));
    ([['category', i18n.excludeGroupCategories], ['channel', i18n.excludeGroupChannels]] as const).forEach(([type, groupLabel]) => {
      const items = targets.filter((item) => item.type === type && !ids.includes(item.id));
      if (items.length === 0) return;
      const group = document.createElement('optgroup');
      group.label = groupLabel;
      items.forEach((item) => group.appendChild(new Option(optionText(item), item.id)));
      select!.appendChild(group);
    });
    refreshControls();
  }

  async function save(nextIds: string[]) {
    if (busy || !botOnline) return;
    busy = true;
    refreshControls();
    try {
      const result = await api.callModuleAction<{ excluded_ids: string[] }>('leveling', 'set-excluded', { channel_ids: nextIds });
      ids = result.excluded_ids;
    } catch (err) {
      alert(errorMessage(err));
    } finally {
      busy = false;
      renderChips();
      renderSelect();
    }
  }

  select.addEventListener('change', refreshControls);
  addBtn.addEventListener('click', () => { if (select.value) save([...ids, select.value]); });

  renderChips();
  renderSelect();
}

function setupLevelRoles(api: DashboardApi, i18n: I18n) {
  const addBtn = byId<HTMLButtonElement>('add-level-role-btn');
  const form = byId('level-role-form');
  const formTitle = byId('level-role-form-title');
  const confirmBtn = byId<HTMLButtonElement>('confirm-level-role-btn');
  const cancelBtn = byId<HTMLButtonElement>('cancel-level-role-btn');
  const levelInput = byId<HTMLInputElement>('new-level-input');
  const roleSelect = byId<HTMLSelectElement>('new-role-select');
  const list = byId('level-roles-list');
  const template = byId<HTMLTemplateElement>('level-role-template');
  const emptyNote = byId('level-roles-empty');
  if (!addBtn || !form || !formTitle || !confirmBtn || !cancelBtn || !levelInput || !roleSelect || !list || !template || !emptyNote) return;

  const refreshEmptyNote = () => emptyNote.classList.toggle('hidden', list.querySelector('[data-level-role-row]') !== null);

  function openForm(row?: HTMLElement) {
    const level = row?.dataset.levelRoleRow;
    formTitle!.textContent = level ? i18n.roleFormEditTitleTemplate.replace('{level}', level) : i18n.roleFormAddTitle;
    levelInput!.value = level ?? '';
    levelInput!.disabled = Boolean(level);
    roleSelect!.value = row?.dataset.roleId ?? '';
    form!.classList.remove('hidden');
    levelInput!.focus();
  }

  function closeForm() {
    form!.classList.add('hidden');
    levelInput!.disabled = false;
  }

  function buildRoleRow(level: number, result: { role_id: string; role_name: string; role_color: string }) {
    const row = (template!.content.firstElementChild as HTMLElement).cloneNode(true) as HTMLElement;
    row.dataset.levelRoleRow = String(level);
    row.dataset.roleId = result.role_id;
    row.querySelector('[data-field="badge"]')!.textContent = i18n.levelBadgeTemplate.replace('{level}', String(level));
    row.querySelector<HTMLElement>('[data-field="color"]')!.style.backgroundColor = result.role_color;
    row.querySelector('[data-field="name"]')!.textContent = result.role_name;
    return row;
  }

  addBtn.addEventListener('click', () => openForm());
  cancelBtn.addEventListener('click', closeForm);

  confirmBtn.addEventListener('click', async () => {
    const level = Number(levelInput.value);
    if (!Number.isInteger(level) || level < 1 || level > 1000) { alert(i18n.alertInvalidLevel); return; }
    if (!roleSelect.value) { alert(i18n.alertNoRole); return; }

    confirmBtn.disabled = true;
    try {
      const result = await api.callModuleAction('leveling', 'set-role', { level, role_id: roleSelect.value });

      const newRow = buildRoleRow(level, result);
      const existing = list.querySelector(`[data-level-role-row="${level}"]`);
      if (existing) existing.replaceWith(newRow);
      else list.appendChild(newRow);

      // Nach Level sortiert halten
      Array.from(list.querySelectorAll<HTMLElement>('[data-level-role-row]'))
        .sort((a, b) => Number(a.dataset.levelRoleRow) - Number(b.dataset.levelRoleRow))
        .forEach((r) => list.appendChild(r));

      refreshEmptyNote();
      closeForm();
    } catch (err) {
      alert(errorMessage(err));
    } finally {
      confirmBtn.disabled = false;
    }
  });

  // Ein Klick-Handler für alle Zeilen — auch für neu angelegte
  list.addEventListener('click', async (event) => {
    const target = event.target as HTMLElement;
    const row = target.closest<HTMLElement>('[data-level-role-row]');
    if (!row) return;

    if (target.closest('[data-edit-level-role]')) {
      openForm(row);
      return;
    }
    if (target.closest('[data-remove-level-role]')) {
      const level = row.dataset.levelRoleRow!;
      if (!confirm(i18n.confirmRemoveRoleTemplate.replace('{level}', level))) return;
      try {
        await api.callModuleAction('leveling', 'remove-role', { level: Number(level) });
        row.remove();
        refreshEmptyNote();
      } catch (err) {
        alert(errorMessage(err));
      }
    }
  });
}

function setupLevelsPage() {
  // Auf anderen Seiten gibt es das Element nicht — dann ist nichts zu tun
  const root = byId('levels-page');
  if (!root || root.dataset.bound === 'true') return;
  root.dataset.bound = 'true';

  // Konfiguration bei jedem Aufruf neu lesen: nach einem Serverwechsel gilt die neue guildId
  const config = readPageConfig<LevelsConfig>(root);
  // Die Seite hatte nie einen eigenen Text für unlesbare Antworten — wie bisher den Server-Fehler zeigen
  const api = createDashboardApi(config.guildId, { ...config.i18n, unexpectedResponseTemplate: config.i18n.errorServerTemplate });

  setupXpSettings(api, config.i18n);
  setupLevelUpChannel(api, config.i18n);
  setupXpExclude(api, config);
  setupLevelRoles(api, config.i18n);
}

document.addEventListener('astro:page-load', setupLevelsPage);
