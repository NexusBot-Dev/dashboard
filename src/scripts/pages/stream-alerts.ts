// Browser-Logik der Stream-Alerts (/server/<id>/modules/stream-alerts/).
// Gebündeltes Modul: läuft einmal pro Seitenladen; bei Navigation über den ClientRouter
// sorgt astro:page-load dafür, dass die neue Seite neu verdrahtet wird.
import { byId, createDashboardApi, readPageConfig, type ApiMessages, type DashboardApi } from '../dashboard-api';

interface StreamAlertsConfig {
  guildId: string;
  botOnline: boolean;
  limits: Record<string, number>;   // aktuelles Limit je Plattform
  i18n: ApiMessages & {
    save: string;
    saving: string;
    subFormAddTitle: string;
    subFormEditTitle: string;
    alertUsernameRequired: string;
    confirmRemoveSub: string;
    alertBothChannels: string;
    alertDifferentChannels: string;
    confirmRemoveLink: string;
  };
}

type I18n = StreamAlertsConfig['i18n'];
const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

const cloneTemplate = (id: string) =>
  (byId<HTMLTemplateElement>(id)!.content.firstElementChild as HTMLElement).cloneNode(true) as HTMLElement;

const targetText = (channelName: string | undefined, message: string) =>
  `→ #${channelName}${message ? ` · "${message}"` : ''}`;

function setupPingRoles(root: HTMLElement, api: DashboardApi, i18n: I18n) {
  const saveBtn = byId<HTMLButtonElement>('save-ping-roles-btn');
  const selects = Array.from(root.querySelectorAll<HTMLSelectElement>('[data-ping-role]'));
  if (!saveBtn || selects.length === 0) return;

  const isDirty = () => selects.some((s) => s.value !== s.dataset.initial);
  selects.forEach((s) => s.addEventListener('change', () => { saveBtn.disabled = !isDirty(); }));

  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    saveBtn.textContent = i18n.saving;
    try {
      // Nacheinander, nur die geänderten — bei einem Fehler bleiben die übrigen als ungespeichert markiert
      for (const s of selects) {
        if (s.value === s.dataset.initial) continue;
        await api.callModuleAction('stream_alerts', 'set-ping-role', { platform: s.dataset.pingRole, role_id: s.value || null });
        s.dataset.initial = s.value;
      }
    } catch (err) {
      alert(errorMessage(err));
    } finally {
      saveBtn.textContent = i18n.save;
      saveBtn.disabled = !isDirty();
    }
  });
}

/** Zähler je Plattform, Sperre des Hinzufügen-Buttons und Leer-Hinweis passend zu den Zeilen auf der Seite */
function refreshSubscriptions(config: StreamAlertsConfig) {
  let total = 0;
  let capacity = 0;
  Object.entries(config.limits).forEach(([platform, limit]) => {
    const count = document.querySelectorAll(`[data-platform-group="${platform}"] [data-sub-row]`).length;
    const counter = document.querySelector(`[data-count="${platform}"]`);
    if (counter) counter.textContent = String(count);
    total += count;
    capacity += limit;
  });
  const addBtn = byId<HTMLButtonElement>('add-sub-btn');
  if (addBtn) addBtn.disabled = !config.botOnline || total >= capacity;
  byId('no-subs-msg')?.classList.toggle('hidden', total > 0);
}

/** Auswahllisten für Verknüpfungen: Kanal hinzufügen bzw. entfernen */
function addLinkOption(subscriptionId: string, platform: string, name: string) {
  ['link-sub-a', 'link-sub-b'].forEach((id) => {
    const option = new Option(name, subscriptionId);
    option.dataset.platform = platform;
    byId<HTMLSelectElement>(id)?.appendChild(option);
  });
}

/** Kanal entfernt: raus aus den Auswahllisten, seine Verknüpfungen verschwinden (der Bot listet sie nicht mehr) */
function forgetSubscription(subscriptionId: string) {
  document.querySelectorAll(`#link-sub-a option[value="${subscriptionId}"], #link-sub-b option[value="${subscriptionId}"]`)
    .forEach((option) => option.remove());
  document.querySelectorAll<HTMLElement>('[data-link-row]').forEach((row) => {
    if (row.dataset.subscriptionIds?.split(',').includes(subscriptionId)) row.remove();
  });
  refreshLinks();
}

function refreshLinks() {
  byId('no-links-msg')?.classList.toggle('hidden', document.querySelector('#links-list [data-link-row]') !== null);
}

function setupSubscriptions(api: DashboardApi, config: StreamAlertsConfig) {
  const { i18n } = config;
  const addBtn = byId<HTMLButtonElement>('add-sub-btn');
  const list = byId('subs-list');
  const form = byId('sub-form');
  const formTitle = byId('sub-form-title');
  const platformSelect = byId<HTMLSelectElement>('new-sub-platform');
  const usernameInput = byId<HTMLInputElement>('new-sub-username');
  const channelSelect = byId<HTMLSelectElement>('new-sub-channel');
  const messageInput = byId<HTMLInputElement>('new-sub-message');
  const confirmBtn = byId<HTMLButtonElement>('confirm-sub-btn');
  const cancelBtn = byId<HTMLButtonElement>('cancel-sub-btn');
  if (!addBtn || !list || !form || !formTitle || !platformSelect || !usernameInput || !channelSelect
    || !messageInput || !confirmBtn || !cancelBtn) return;

  let editingRow: HTMLElement | null = null;

  function openForm(row?: HTMLElement) {
    editingRow = row ?? null;
    formTitle!.textContent = row ? i18n.subFormEditTitle : i18n.subFormAddTitle;
    if (row) platformSelect!.value = row.dataset.platform!;
    platformSelect!.disabled = Boolean(row);
    usernameInput!.value = row?.querySelector('[data-field="name"]')?.textContent ?? '';
    usernameInput!.disabled = Boolean(row);
    channelSelect!.value = row ? row.dataset.channelId! : channelSelect!.options[0]?.value ?? '';
    messageInput!.value = row?.dataset.message ?? '';
    form!.classList.remove('hidden');
    if (!row) usernameInput!.focus();
  }

  function closeForm() {
    form!.classList.add('hidden');
    platformSelect!.disabled = false;
    usernameInput!.disabled = false;
  }

  addBtn.addEventListener('click', () => openForm());
  cancelBtn.addEventListener('click', closeForm);

  confirmBtn.addEventListener('click', async () => {
    const channelId = channelSelect.value;
    const channelName = channelSelect.selectedOptions[0]?.dataset.channelName;
    const message = messageInput.value.trim();

    if (!editingRow && !usernameInput.value.trim()) {
      alert(i18n.alertUsernameRequired);
      return;
    }

    confirmBtn.disabled = true;
    try {
      if (editingRow) {
        await api.callModuleAction('stream_alerts', 'edit', {
          monitored_channel_id: editingRow.dataset.subRow, channel_id: channelId, message: message || null,
        });
        editingRow.dataset.channelId = channelId;
        editingRow.dataset.message = message;
        editingRow.querySelector('[data-field="target"]')!.textContent = targetText(channelName, message);
      } else {
        const platform = platformSelect.value;
        const result = await api.callModuleAction<{ monitored_channel_id: number; subscription_id?: number; streamer_name: string }>('stream_alerts', 'add', {
          platform, username: usernameInput.value.trim(), channel_id: channelId, message: message || null,
        });

        const row = cloneTemplate('sub-row-template');
        row.dataset.subRow = String(result.monitored_channel_id);
        row.dataset.subscriptionId = result.subscription_id ? String(result.subscription_id) : '';
        row.dataset.platform = platform;
        row.dataset.channelId = channelId;
        row.dataset.message = message;
        row.querySelector('[data-field="name"]')!.textContent = result.streamer_name;
        row.querySelector('[data-field="target"]')!.textContent = targetText(channelName, message);
        list.querySelector(`[data-platform-group="${platform}"]`)!.appendChild(row);
        list.querySelector<HTMLElement>(`[data-platform-section="${platform}"]`)!.style.display = '';
        // Ältere Bot-Versionen liefern keine Abo-ID — dann ist der Kanal erst nach dem Neuladen verknüpfbar
        if (result.subscription_id) addLinkOption(String(result.subscription_id), platform, result.streamer_name);
        refreshSubscriptions(config);
      }
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
    const row = target.closest<HTMLElement>('[data-sub-row]');
    if (!row) return;

    if (target.closest('[data-edit-sub]')) {
      openForm(row);
      return;
    }
    if (target.closest('[data-remove-sub]')) {
      if (!confirm(i18n.confirmRemoveSub)) return;
      try {
        await api.callModuleAction('stream_alerts', 'remove', { monitored_channel_id: row.dataset.subRow });
        const section = row.closest<HTMLElement>('[data-platform-section]');
        row.remove();
        if (section && !section.querySelector('[data-sub-row]')) section.style.display = 'none';
        if (row.dataset.subscriptionId) forgetSubscription(row.dataset.subscriptionId);
        refreshSubscriptions(config);
      } catch (err) {
        alert(errorMessage(err));
      }
    }
  });
}

function setupLinks(api: DashboardApi, i18n: I18n) {
  const addLinkBtn = byId<HTMLButtonElement>('add-link-btn');
  const linkForm = byId('link-form');
  const subASelect = byId<HTMLSelectElement>('link-sub-a');
  const subBSelect = byId<HTMLSelectElement>('link-sub-b');
  const confirmLinkBtn = byId<HTMLButtonElement>('confirm-link-btn');
  const cancelLinkBtn = byId<HTMLButtonElement>('cancel-link-btn');
  const linksList = byId('links-list');
  if (!addLinkBtn || !linkForm || !subASelect || !subBSelect || !confirmLinkBtn || !cancelLinkBtn || !linksList) return;

  addLinkBtn.addEventListener('click', () => linkForm.classList.remove('hidden'));
  cancelLinkBtn.addEventListener('click', () => linkForm.classList.add('hidden'));

  function fillSide(row: HTMLElement, side: 'a' | 'b', option: HTMLOptionElement) {
    const el = row.querySelector(`[data-side="${side}"]`)!;
    el.querySelectorAll<HTMLElement>('[data-platform-icon]').forEach((icon) => {
      icon.classList.toggle('hidden', icon.dataset.platformIcon !== option.dataset.platform);
    });
    el.querySelector('[data-field="name"]')!.textContent = option.textContent;
  }

  confirmLinkBtn.addEventListener('click', async () => {
    const subA = subASelect.value;
    const subB = subBSelect.value;
    if (!subA || !subB) { alert(i18n.alertBothChannels); return; }
    if (subA === subB) { alert(i18n.alertDifferentChannels); return; }

    confirmLinkBtn.disabled = true;
    try {
      const result = await api.callModuleAction<{ id: number }>('stream_alerts', 'create-link', {
        subscription_a_id: subA,
        subscription_b_id: subB,
      });

      const row = cloneTemplate('link-row-template');
      row.dataset.linkRow = String(result.id);
      row.dataset.subscriptionIds = `${subA},${subB}`;
      fillSide(row, 'a', subASelect.selectedOptions[0]);
      fillSide(row, 'b', subBSelect.selectedOptions[0]);
      linksList.appendChild(row);
      refreshLinks();

      linkForm.classList.add('hidden');
    } catch (err) {
      alert(errorMessage(err));
    } finally {
      confirmLinkBtn.disabled = false;
    }
  });

  linksList.addEventListener('click', async (event) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>('[data-link-row]');
    if (!row || !(event.target as HTMLElement).closest('[data-remove-link]')) return;
    if (!confirm(i18n.confirmRemoveLink)) return;
    try {
      await api.callModuleAction('stream_alerts', 'delete-link', { link_id: row.dataset.linkRow });
      row.remove();
      refreshLinks();
    } catch (err) {
      alert(errorMessage(err));
    }
  });
}

function setupStreamAlertsPage() {
  // Auf anderen Seiten gibt es das Element nicht — dann ist nichts zu tun
  const root = byId('stream-alerts-page');
  if (!root || root.dataset.bound === 'true') return;
  root.dataset.bound = 'true';

  // Konfiguration bei jedem Aufruf neu lesen: nach einem Serverwechsel gilt die neue guildId
  const config = readPageConfig<StreamAlertsConfig>(root);
  const { i18n } = config;
  const api = createDashboardApi(config.guildId, i18n);

  setupPingRoles(root, api, i18n);
  setupSubscriptions(api, config);
  setupLinks(api, i18n);
}

document.addEventListener('astro:page-load', setupStreamAlertsPage);
