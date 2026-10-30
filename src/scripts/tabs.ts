// Tabs (Markup aus src/components/Tabs.astro): Klick, Pfeiltasten links/rechts und #hash in der URL.
// root ist das Element, das Tab-Leiste und Panels umschließt.

export function setupTabs(root: HTMLElement) {
  if (root.dataset.tabsBound === 'true') return;
  root.dataset.tabsBound = 'true';

  const tablist = root.querySelector<HTMLElement>('[role="tablist"]');
  if (!tablist) return;
  const activeClasses = (tablist.dataset.tabActive ?? '').split(' ');
  const inactiveClasses = (tablist.dataset.tabInactive ?? '').split(' ');

  const tabs = Array.from(tablist.querySelectorAll<HTMLElement>('[role="tab"]'));
  const panels = new Map(
    Array.from(root.querySelectorAll<HTMLElement>('[data-tab-panel]')).map((p) => [p.dataset.tabPanel!, p])
  );

  function activate(name: string, { updateHash = true, focus = false } = {}) {
    if (!panels.has(name)) name = tabs[0].dataset.tab!;
    tabs.forEach((tab) => {
      const active = tab.dataset.tab === name;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      tab.classList.remove(...(active ? inactiveClasses : activeClasses));
      tab.classList.add(...(active ? activeClasses : inactiveClasses));
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
