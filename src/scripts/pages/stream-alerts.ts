// Browser-Logik der Stream-Alerts (/server/<id>/stream-alerts/).
// Gebündeltes Modul: läuft einmal pro Seitenladen; bei Navigation über den ClientRouter
// sorgt astro:page-load dafür, dass die neue Seite neu verdrahtet wird.
import { byId, createDashboardApi, readPageConfig, type ApiMessages, type DashboardApi } from '../dashboard-api';
import { PLATFORM_META, channelLabel, subscriptionLabel } from '../../lib/streamPlatforms';
import {
  SCHEDULE_IMAGE_HEIGHT, SCHEDULE_IMAGE_MAX_BASE64, SCHEDULE_IMAGE_QUALITIES, SCHEDULE_IMAGE_WIDTH, SCHEDULE_MAX_TEXT_LENGTH, renderScheduleText, scheduleCanToggle, scheduleCropRect,
  scheduleCustomEditable, scheduleImageOptions, scheduleImageSelectable, scheduleLimitNote, scheduleRowText,
  type ScheduleEntry, type ScheduleOverview, type ScheduleTexts,
} from '../../lib/streamSchedule';
import { renderPreview } from '../../lib/discordMarkdown';
import { setupMarkdownToolbars } from '../markdown-toolbar';
import { isSwitchOn, setSwitch } from '../switch';
import { setupTabs } from '../tabs';

interface StreamAlertsConfig {
  guildId: string;
  botOnline: boolean;
  limits: Record<string, number>;   // aktuelles Limit je Plattform
  schedulePremium: boolean;         // Premium laut letzter Antwort des Bots (Streamplan)
  scheduleEntries: ScheduleEntry[]; // Streamplan beim Laden der Seite (danach aus jeder Antwort des Bots)
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
    channelDeleted: string;
    schedule: ScheduleTexts;
    scheduleCustom: ScheduleCustomTexts;
  };
}

interface ScheduleCustomTexts {
  title: string;            // enthält "{streamer}"
  count: string;            // enthält "{count}" und "{max}"
  sampleTitle: string;
  sampleCategory: string;
  defaultSource: string;    // enthält "{streamer}"
  imageNone: string;
  imageBanner: string;
  imageOffline: string;
  imageLoading: string;
  storedHint: string;
  errFileType: string;
  errFileSize: string;      // enthält "{mb}"
  errFileRead: string;
  errImageLoad: string;
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
  const refresh = () => { saveBtn.disabled = !isDirty(); };
  selects.forEach((s) => s.addEventListener('change', refresh));
  // Sofort einmal prüfen: Änderungen vor dem Verdrahten (astro:page-load kommt erst nach dem Laden) lösen kein Ereignis aus
  refresh();

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

/** Gruppe der Plattform in einer Verknüpfungs-Auswahl — fehlt sie, wird sie in Plattform-Reihenfolge angelegt */
function linkGroup(select: HTMLSelectElement, platform: string): HTMLOptGroupElement {
  const existing = select.querySelector<HTMLOptGroupElement>(`optgroup[data-platform="${platform}"]`);
  if (existing) return existing;
  const group = document.createElement('optgroup');
  group.label = PLATFORM_META[platform]?.label ?? platform;
  group.dataset.platform = platform;
  const order = Object.keys(PLATFORM_META);
  const next = Array.from(select.querySelectorAll<HTMLOptGroupElement>('optgroup'))
    .find((g) => order.indexOf(g.dataset.platform!) > order.indexOf(platform));
  select.insertBefore(group, next ?? null);
  return group;
}

/** Auswahllisten für Verknüpfungen: Kanal hinzufügen bzw. entfernen */
function addLinkOption(subscriptionId: string, platform: string, name: string, channel: string) {
  ['link-sub-a', 'link-sub-b'].forEach((id) => {
    const select = byId<HTMLSelectElement>(id);
    if (!select) return;
    const option = new Option(subscriptionLabel(name, platform, channel), subscriptionId);
    option.dataset.platform = platform;
    option.dataset.name = name;
    option.dataset.channel = channel;
    linkGroup(select, platform).appendChild(option);
  });
}

/** Ziel-Channel eines Kanals geändert: Auswahllisten und bestehende Verknüpfungen zeigen den neuen */
function updateLinkTarget(subscriptionId: string, channel: string) {
  document.querySelectorAll<HTMLOptionElement>(`#link-sub-a option[value="${subscriptionId}"], #link-sub-b option[value="${subscriptionId}"]`)
    .forEach((option) => {
      option.dataset.channel = channel;
      option.textContent = subscriptionLabel(option.dataset.name!, option.dataset.platform!, channel);
    });
  document.querySelectorAll<HTMLElement>('[data-link-row]').forEach((row) => {
    row.dataset.subscriptionIds?.split(',').forEach((id, i) => {
      if (id !== subscriptionId) return;
      row.querySelector(`[data-side="${i === 0 ? 'a' : 'b'}"] [data-field="target"]`)!.textContent = `→ ${channel}`;
    });
  });
}

/** Kanal entfernt: raus aus den Auswahllisten, seine Verknüpfungen verschwinden (der Bot listet sie nicht mehr) */
function forgetSubscription(subscriptionId: string) {
  document.querySelectorAll(`#link-sub-a option[value="${subscriptionId}"], #link-sub-b option[value="${subscriptionId}"]`)
    .forEach((option) => {
      const group = option.parentElement;
      option.remove();
      if (group instanceof HTMLOptGroupElement && group.children.length === 0) group.remove();   // keine leere Überschrift
    });
  document.querySelectorAll<HTMLElement>('[data-link-row]').forEach((row) => {
    if (row.dataset.subscriptionIds?.split(',').includes(subscriptionId)) row.remove();
  });
  refreshLinks();
}

function refreshLinks() {
  byId('no-links-msg')?.classList.toggle('hidden', document.querySelector('#links-list [data-link-row]') !== null);
}

// ── Tab „Streamplan“ ─────────────────────────────────────────────────────────────────────────────

// Einträge laut letzter Antwort des Bots — für den Editor „Text & Bild“
let scheduleEntries = new Map<string, ScheduleEntry>();
// Nach jedem Neuaufbau der Liste: offenen Editor schließen, wenn sein Kanal weg oder ausgeschaltet ist
let onScheduleRendered: (() => void) | null = null;

/** Liste, Limit-Hinweis und Leer-Hinweis aus der Antwort des Bots neu aufbauen */
function renderSchedule(overview: ScheduleOverview, config: StreamAlertsConfig) {
  const list = byId('schedule-list');
  if (!list) return;   // Streamplan nicht geladen (Hinweis statt Liste)
  const texts = config.i18n.schedule;
  config.schedulePremium = overview.premium_active;
  scheduleEntries = new Map(overview.entries.map((e) => [String(e.monitored_channel_id), e]));
  list.replaceChildren(...overview.entries.map((entry) => {
    const row = cloneTemplate('schedule-row-template');
    const { status, error } = scheduleRowText(entry, texts, overview.premium_active);
    row.dataset.scheduleRow = String(entry.monitored_channel_id);
    row.querySelector('[data-field="name"]')!.textContent = entry.streamer_name;
    row.querySelector('[data-field="status"]')!.textContent = status;
    const errorEl = row.querySelector('[data-field="error"]')!;
    errorEl.textContent = error;
    errorEl.classList.toggle('hidden', !error);
    const toggle = row.querySelector<HTMLButtonElement>('[data-schedule-toggle]')!;
    setSwitch(toggle, entry.enabled);
    toggle.disabled = !config.botOnline || !scheduleCanToggle(entry, overview);
    const image = row.querySelector<HTMLSelectElement>('[data-schedule-image]')!;
    image.classList.toggle('hidden', !scheduleImageSelectable(entry));
    const allowed = new Set(scheduleImageOptions(entry, overview.premium_active));
    image.querySelectorAll('option').forEach((option) => { if (!allowed.has(option.value as never)) option.remove(); });
    if (entry.image_source) image.value = entry.image_source;
    row.querySelector('[data-schedule-custom]')!.classList.toggle('hidden', !scheduleCustomEditable(entry));
    image.dataset.initial = image.value;
    return row;
  }));
  const note = scheduleLimitNote(overview, texts);
  const noteEl = byId('schedule-limit-note');
  if (noteEl) {
    noteEl.textContent = note;
    noteEl.classList.toggle('hidden', !note);
  }
  byId('no-schedule-msg')?.classList.toggle('hidden', overview.entries.length > 0);
  onScheduleRendered?.();
}

function setupSchedule(api: DashboardApi, config: StreamAlertsConfig) {
  const list = byId('schedule-list');
  if (!list) return;
  list.addEventListener('click', async (event) => {
    const toggle = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-schedule-toggle]');
    const row = toggle?.closest<HTMLElement>('[data-schedule-row]');
    if (!toggle || !row || toggle.disabled) return;
    toggle.disabled = true;
    try {
      // Der Bot gleicht sofort ab (Events anlegen oder löschen) und schickt die neue Übersicht zurück
      const overview = await api.callModuleAction<ScheduleOverview>('stream_alerts', 'schedule-toggle', {
        monitored_channel_id: row.dataset.scheduleRow, enabled: !isSwitchOn(toggle),
      });
      renderSchedule(overview, config);
    } catch (err) {
      alert(errorMessage(err));
      toggle.disabled = false;
    }
  });

  // Bildquelle: Der Bot gleicht sofort ab (kommende Events bekommen das neue Bild)
  list.addEventListener('change', async (event) => {
    const image = (event.target as HTMLElement).closest<HTMLSelectElement>('[data-schedule-image]');
    const row = image?.closest<HTMLElement>('[data-schedule-row]');
    if (!image || !row) return;
    image.disabled = true;
    try {
      const overview = await api.callModuleAction<ScheduleOverview>('stream_alerts', 'schedule-image', {
        monitored_channel_id: row.dataset.scheduleRow, source: image.value,
      });
      renderSchedule(overview, config);
    } catch (err) {
      alert(errorMessage(err));
      image.value = image.dataset.initial ?? image.value;   // zurück auf die gespeicherte Quelle
      image.disabled = false;
    }
  });
}

// ── Editor „Text & Bild“ (Premium) ──────────────────────────────────────────────────────────────

const MAX_SOURCE_FILE_MB = 20;   // Das Bild wird hier im Browser verkleinert — hochgeladen werden nur ~100–200 KB
const SOURCE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const IMAGE_BACKGROUND = '#111214';   // wie der Bot (schedule_images.BACKGROUND) hinter durchsichtigen Stellen

function setupScheduleCustom(api: DashboardApi, config: StreamAlertsConfig) {
  const form = byId('schedule-custom-form');
  const list = byId('schedule-list');
  if (!form || !list) return;
  const texts = config.i18n.scheduleCustom;
  const el = <T extends HTMLElement>(id: string) => byId<T>(id)!;
  const textarea = el<HTMLTextAreaElement>('schedule-custom-text');
  const fileInput = el<HTMLInputElement>('schedule-custom-file');
  const position = el<HTMLInputElement>('schedule-custom-position');
  const canvas = el<HTMLCanvasElement>('schedule-custom-canvas');
  const storedImage = el<HTMLImageElement>('schedule-custom-stored-image');
  const saveBtn = el<HTMLButtonElement>('schedule-custom-save');

  let entry: ScheduleEntry | null = null;
  let picked: ImageBitmap | null = null;   // neu gewähltes Bild (noch nicht gespeichert)
  let removeStored = false;                // gespeichertes Bild beim Speichern entfernen
  let storedState: 'none' | 'loading' | 'loaded' | 'failed' = 'none';
  let opened = 0;                          // verwirft Antworten zu einem inzwischen anders geöffneten Editor

  const sample = () => {
    const login = entry!.streamer_name.toLowerCase();
    return { title: texts.sampleTitle, category: texts.sampleCategory, link: `https://twitch.tv/${login}`, streamer: entry!.streamer_name, login };
  };

  function drawPicked() {
    if (!picked) return;
    const rect = scheduleCropRect(picked.width, picked.height, Number(position.value) / 100);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = IMAGE_BACKGROUND;
    ctx.fillRect(0, 0, SCHEDULE_IMAGE_WIDTH, SCHEDULE_IMAGE_HEIGHT);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';   // Standard „low“ macht verkleinerte Bilder weich
    ctx.drawImage(picked, rect.x, rect.y, rect.width, rect.height, 0, 0, SCHEDULE_IMAGE_WIDTH, SCHEDULE_IMAGE_HEIGHT);
  }

  /** Canvas als JPEG (Base64) in der besten Qualität, die unter die Größengrenze des Bots passt */
  function encodeCanvas(): string {
    let data = '';
    for (const quality of SCHEDULE_IMAGE_QUALITIES) {
      data = canvas.toDataURL('image/jpeg', quality).split(',', 2)[1];
      if (data.length <= SCHEDULE_IMAGE_MAX_BASE64) break;
    }
    return data;
  }

  function renderImage() {
    const hasStored = Boolean(entry?.custom_image_hash);
    const showStored = !picked && hasStored && !removeStored;
    canvas.classList.toggle('hidden', !picked);
    storedImage.classList.toggle('hidden', !(showStored && storedState === 'loaded'));
    const note = el('schedule-custom-image-note');
    let noteText = '';
    if (showStored && storedState === 'loading') noteText = texts.imageLoading;
    else if (showStored && storedState === 'failed') noteText = texts.errImageLoad;
    else if (!picked && !showStored) {
      // Ohne eigenes Bild gilt die gewählte Quelle (nach dem Entfernen wieder das Spiel-Banner)
      const source = entry?.image_source === 'custom' ? 'banner' : entry?.image_source;
      noteText = source === 'none' ? texts.imageNone : source === 'offline' ? texts.imageOffline : texts.imageBanner;
    }
    note.textContent = noteText;
    note.classList.toggle('hidden', !noteText);
    el('schedule-custom-remove').classList.toggle('hidden', !(picked || showStored));
    el('schedule-custom-restore').classList.toggle('hidden', !(removeStored && hasStored && !picked));
    const overflow = picked ? Math.abs(picked.width / picked.height - SCHEDULE_IMAGE_WIDTH / SCHEDULE_IMAGE_HEIGHT) > 0.01 : false;
    el('schedule-custom-position-wrap').classList.toggle('hidden', !overflow);
    drawPicked();
  }

  function renderText() {
    const value = textarea.value;
    el('schedule-custom-count').textContent = texts.count.replace('{count}', String(value.length)).replace('{max}', String(SCHEDULE_MAX_TEXT_LENGTH));
    const values = sample();
    const description = value.trim()
      ? renderScheduleText(value.trim(), values)
      : `🎮 ${values.category}\ntwitch.tv/${values.login}\n\n${texts.defaultSource.replace('{streamer}', values.streamer)}`;
    el('schedule-custom-preview-title').textContent = values.title;
    el('schedule-custom-preview-text').innerHTML = renderPreview(description);   // escaped
  }

  async function loadStored(token: number, monitoredChannelId: number) {
    storedState = 'loading';
    renderImage();
    try {
      const { image } = await api.callModuleAction<{ image: string | null }>('stream_alerts', 'schedule-custom-image', {
        monitored_channel_id: String(monitoredChannelId),
      });
      if (token !== opened) return;
      if (!image) throw new Error('no image');
      storedImage.src = `data:image/jpeg;base64,${image}`;
      storedState = 'loaded';
    } catch {
      if (token !== opened) return;
      storedState = 'failed';
    }
    renderImage();
  }

  function open(target: ScheduleEntry) {
    entry = target;
    opened += 1;
    picked?.close();
    picked = null;
    removeStored = false;
    storedState = 'none';
    storedImage.removeAttribute('src');
    fileInput.value = '';
    position.value = '50';
    form!.dataset.editing = String(target.monitored_channel_id);
    el('schedule-custom-title').textContent = texts.title.replace('{streamer}', target.streamer_name);

    const premium = config.schedulePremium;
    el('schedule-custom-premium').classList.toggle('hidden', premium);
    el('schedule-custom-fields').classList.toggle('hidden', !premium);
    saveBtn.classList.toggle('hidden', !premium);
    const stored = el('schedule-custom-stored');
    const hasStored = Boolean(target.custom_text || target.custom_image_hash);
    stored.textContent = texts.storedHint;
    stored.classList.toggle('hidden', premium || !hasStored);

    textarea.value = target.custom_text ?? '';
    form!.classList.remove('hidden');
    renderText();
    renderImage();
    if (premium && target.custom_image_hash) void loadStored(opened, target.monitored_channel_id);
    form!.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function close() {
    opened += 1;
    entry = null;
    picked?.close();
    picked = null;
    delete form!.dataset.editing;
    form!.classList.add('hidden');
  }

  onScheduleRendered = () => {
    if (!entry) return;
    const current = scheduleEntries.get(String(entry.monitored_channel_id));
    if (!current || !scheduleCustomEditable(current)) close();
  };

  list.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-schedule-custom]');
    const row = button?.closest<HTMLElement>('[data-schedule-row]');
    const target = row ? scheduleEntries.get(row.dataset.scheduleRow ?? '') : undefined;
    if (button && !button.disabled && target) open(target);
  });

  textarea.addEventListener('input', renderText);
  form.querySelectorAll<HTMLButtonElement>('[data-insert-placeholder]').forEach((button) => {
    button.addEventListener('click', () => {
      textarea.focus();
      textarea.setRangeText(`{${button.dataset.insertPlaceholder}}`, textarea.selectionStart, textarea.selectionEnd, 'end');
      renderText();
    });
  });

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';   // dieselbe Datei noch einmal wählbar
    if (!file || !entry) return;
    if (!SOURCE_TYPES.includes(file.type)) {
      alert(texts.errFileType);
      return;
    }
    if (file.size > MAX_SOURCE_FILE_MB * 1024 * 1024) {
      alert(texts.errFileSize.replace('{mb}', String(MAX_SOURCE_FILE_MB)));
      return;
    }
    const token = opened;
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });   // Handyfotos richtig herum
    } catch {
      alert(texts.errFileRead);
      return;
    }
    if (token !== opened) {
      bitmap.close();
      return;
    }
    picked?.close();
    picked = bitmap;
    removeStored = false;
    position.value = '50';
    renderImage();
  });

  position.addEventListener('input', drawPicked);
  el('schedule-custom-remove').addEventListener('click', () => {
    if (picked) {
      picked.close();
      picked = null;   // neues Bild verwerfen — das gespeicherte bleibt
    } else {
      removeStored = true;
    }
    renderImage();
  });
  el('schedule-custom-restore').addEventListener('click', () => {
    removeStored = false;
    renderImage();
  });
  el('schedule-custom-cancel').addEventListener('click', close);

  saveBtn.addEventListener('click', async () => {
    if (!entry || saveBtn.disabled) return;
    const payload: Record<string, unknown> = { monitored_channel_id: String(entry.monitored_channel_id), text: textarea.value };
    if (picked) {
      drawPicked();
      payload.image = encodeCanvas();
    } else if (removeStored) {
      payload.image = null;
    }
    saveBtn.disabled = true;
    try {
      const overview = await api.callModuleAction<ScheduleOverview>('stream_alerts', 'schedule-custom', payload);
      close();
      renderSchedule(overview, config);
    } catch (err) {
      alert(errorMessage(err));
    } finally {
      saveBtn.disabled = false;
    }
  });
}

/** Nach dem Hinzufügen oder Entfernen eines Kanals: Twitch-Kanäle im Tab „Streamplan“ auf Stand bringen */
async function refreshSchedule(api: DashboardApi, config: StreamAlertsConfig) {
  if (!byId('schedule-list')) return;
  try {
    renderSchedule(await api.callModuleAction<ScheduleOverview>('stream_alerts', 'schedule'), config);
  } catch {
    // Nicht schlimm: nach dem Neuladen stimmt die Liste wieder
  }
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
    // Hinweis vom Bot (z. B. fehlende Rechte im Kanal) — gespeichert ist trotzdem
    let warning: string | null | undefined;
    try {
      if (editingRow) {
        ({ warning } = await api.callModuleAction<{ warning?: string | null }>('stream_alerts', 'edit', {
          monitored_channel_id: editingRow.dataset.subRow, channel_id: channelId, message: message || null,
        }));
        editingRow.dataset.channelId = channelId;
        editingRow.dataset.message = message;
        editingRow.querySelector('[data-field="target"]')!.textContent = targetText(channelName, message);
        if (editingRow.dataset.subscriptionId) updateLinkTarget(editingRow.dataset.subscriptionId, channelLabel(channelName, i18n.channelDeleted));
      } else {
        const platform = platformSelect.value;
        const result = await api.callModuleAction<{ monitored_channel_id: number; subscription_id?: number; streamer_name: string; warning?: string | null }>('stream_alerts', 'add', {
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
        if (result.subscription_id) {
          addLinkOption(String(result.subscription_id), platform, result.streamer_name, channelLabel(channelName, i18n.channelDeleted));
        }
        refreshSubscriptions(config);
        if (platform === 'twitch') void refreshSchedule(api, config);
        warning = result.warning;
      }
      closeForm();
      if (warning) alert(warning);
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
        if (row.dataset.platform === 'twitch') void refreshSchedule(api, config);
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
    // Nur hidden oder inline-flex — beide zugleich gesetzt, gewinnt inline-flex und alle Icons wären sichtbar
    el.querySelectorAll<HTMLElement>('[data-platform-icon]').forEach((icon) => {
      const match = icon.dataset.platformIcon === option.dataset.platform;
      icon.classList.toggle('hidden', !match);
      icon.classList.toggle('inline-flex', match);
    });
    el.querySelector('[data-field="name"]')!.textContent = option.dataset.name ?? '';
    el.querySelector('[data-field="target"]')!.textContent = option.dataset.channel ? `→ ${option.dataset.channel}` : '';
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
  scheduleEntries = new Map(config.scheduleEntries.map((e) => [String(e.monitored_channel_id), e]));
  onScheduleRendered = null;

  setupTabs(root);
  setupPingRoles(root, api, i18n);
  setupSubscriptions(api, config);
  setupLinks(api, i18n);
  setupSchedule(api, config);
  setupScheduleCustom(api, config);
  setupMarkdownToolbars();
}

document.addEventListener('astro:page-load', setupStreamAlertsPage);
