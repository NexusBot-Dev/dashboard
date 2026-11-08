// Ein/Aus-Schalter eines Moduls auf seiner Seite (src/components/ModuleToggle.astro).
// Speichert sofort über die Bot-Schnittstelle modules/toggle; schlägt das fehl, springt der Schalter zurück.
import { createDashboardApi, readPageConfig, type ApiMessages } from './dashboard-api';
import { isSwitchOn, setSwitch } from './switch';

interface ModuleToggleConfig {
  guildId: string;
  moduleKey: string;
  i18n: ApiMessages & { stateOn: string; stateOff: string };
}

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

function setupToggle(root: HTMLElement) {
  if (root.dataset.bound === 'true') return;
  root.dataset.bound = 'true';

  const { guildId, moduleKey, i18n } = readPageConfig<ModuleToggleConfig>(root);
  const api = createDashboardApi(guildId, i18n);
  const toggle = root.querySelector<HTMLButtonElement>('[data-module-switch]')!;
  const state = root.querySelector<HTMLElement>('[data-module-state]')!;
  const note = root.querySelector<HTMLElement>('[data-module-off-note]')!;
  const enableBtn = root.querySelector<HTMLButtonElement>('[data-module-enable]')!;

  const show = (enabled: boolean) => {
    setSwitch(toggle, enabled);
    state.textContent = enabled ? i18n.stateOn : i18n.stateOff;
    note.classList.toggle('hidden', enabled);
  };

  async function save(enabled: boolean) {
    const before = isSwitchOn(toggle);
    show(enabled);
    toggle.disabled = enableBtn.disabled = true;
    try {
      await api.callModuleAction('modules', 'toggle', { changes: { [moduleKey]: enabled } });
    } catch (err) {
      show(before);
      alert(errorMessage(err));
    } finally {
      toggle.disabled = enableBtn.disabled = false;
    }
  }

  toggle.addEventListener('click', () => save(!isSwitchOn(toggle)));
  enableBtn.addEventListener('click', () => save(true));
}

function setupAll() {
  document.querySelectorAll<HTMLElement>('[data-module-toggle-root]').forEach(setupToggle);
}

document.addEventListener('astro:page-load', setupAll);
