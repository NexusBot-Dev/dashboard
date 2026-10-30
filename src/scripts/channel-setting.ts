// Einzelne Channel-Einstellung mit eigenem Speichern-Button (Welcome-, Boost-Channel, ...).
// Markup: <div data-channel-setting="<settings-feld>"> mit <select data-initial="..."> und <button data-role="save">.
import type { DashboardApi } from './dashboard-api';

export function setupChannelSettings(api: DashboardApi, saveLabels: { save: string; saving: string }) {
  document.querySelectorAll<HTMLElement>('[data-channel-setting]').forEach((root) => {
    if (root.dataset.bound === 'true') return;
    root.dataset.bound = 'true';

    const field = root.dataset.channelSetting!;
    const select = root.querySelector<HTMLSelectElement>('select')!;
    const saveBtn = root.querySelector<HTMLButtonElement>('[data-role="save"]')!;
    const refresh = () => { saveBtn.disabled = select.value === select.dataset.initial; };

    select.addEventListener('change', refresh);
    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true;
      saveBtn.textContent = saveLabels.saving;
      try {
        await api.saveSettings({ [field]: select.value });
        select.dataset.initial = select.value;
      } catch (err) {
        alert(err instanceof Error ? err.message : String(err));
      } finally {
        saveBtn.textContent = saveLabels.save;
        refresh();
      }
    });
  });
}
