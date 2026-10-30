// Ein/Aus-Schalter (<button role="switch">) — gemeinsam für Settings, Modul-Übersicht und weitere Seiten.
// Markup: Button mit aria-checked und einem <span> als Knopf, Farben wie in den .astro-Dateien.

export const isSwitchOn = (el: Element) => el.getAttribute('aria-checked') === 'true';

export function setSwitch(el: HTMLElement, enabled: boolean) {
  el.setAttribute('aria-checked', String(enabled));
  el.classList.toggle('bg-primary-500', enabled);
  el.classList.toggle('bg-slate-300', !enabled);
  el.classList.toggle('dark:bg-slate-700', !enabled);
  const knob = el.querySelector('span');
  knob?.classList.toggle('translate-x-6', enabled);
  knob?.classList.toggle('translate-x-1', !enabled);
}
