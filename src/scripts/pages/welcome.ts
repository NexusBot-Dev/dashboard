// Browser-Logik der Seite Welcome & Boosts (/server/<id>/modules/welcome/).
// Gebündeltes Modul: läuft einmal pro Seitenladen; bei Navigation über den ClientRouter
// sorgt astro:page-load dafür, dass die neue Seite neu verdrahtet wird.
import { byId, createDashboardApi, readPageConfig, type ApiMessages, type DashboardApi } from '../dashboard-api';
import { setupChannelSettings } from '../channel-setting';
import { setupMarkdownToolbars } from '../markdown-toolbar';
import { setupMessageEditors } from '../message-editor';
import { isSwitchOn, setSwitch } from '../switch';
import { setupTabs } from '../tabs';

interface WelcomeConfig {
  guildId: string;
  i18n: ApiMessages & { save: string; saving: string };
}

type I18n = WelcomeConfig['i18n'];
const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

// ─── Goodbye: Schalter + Channel, gemeinsam gespeichert ──────────────────────
function setupGoodbye(api: DashboardApi, i18n: I18n) {
  const toggle = byId<HTMLButtonElement>('goodbye-toggle');
  const channelSelect = byId<HTMLSelectElement>('goodbye-channel-select');
  const saveBtn = byId<HTMLButtonElement>('save-goodbye-btn');
  if (!toggle || !channelSelect || !saveBtn || saveBtn.dataset.bound === 'true') return;
  saveBtn.dataset.bound = 'true';

  const isDirty = () =>
    String(isSwitchOn(toggle)) !== toggle.dataset.initial || channelSelect.value !== channelSelect.dataset.initial;
  const refresh = () => { saveBtn.disabled = !isDirty(); };

  toggle.addEventListener('click', () => {
    setSwitch(toggle, !isSwitchOn(toggle));
    refresh();
  });
  channelSelect.addEventListener('change', refresh);

  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    saveBtn.textContent = i18n.saving;
    try {
      await api.saveSettings({ goodbye_enabled: isSwitchOn(toggle), goodbye_channel_id: channelSelect.value });
      toggle.dataset.initial = String(isSwitchOn(toggle));
      channelSelect.dataset.initial = channelSelect.value;
    } catch (err) {
      alert(errorMessage(err));
    } finally {
      saveBtn.textContent = i18n.save;
      refresh();
    }
  });
}

function setupWelcomePage() {
  // Auf anderen Seiten gibt es das Element nicht — dann ist nichts zu tun
  const root = byId('welcome-page');
  if (!root) return;

  // Konfiguration bei jedem Aufruf neu lesen: nach einem Serverwechsel gilt die neue guildId
  const { guildId, i18n } = readPageConfig<WelcomeConfig>(root);
  const api = createDashboardApi(guildId, i18n);

  setupTabs(root);
  setupMarkdownToolbars();
  setupMessageEditors(api);
  setupChannelSettings(api, i18n);
  setupGoodbye(api, i18n);
}

document.addEventListener('astro:page-load', setupWelcomePage);
