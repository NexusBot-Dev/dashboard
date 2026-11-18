// Zeichenzähler unter Textfeldern (src/components/CharCounter.astro): <span data-char-counter="<feld-id>">.
// Das Limit kommt aus dem maxlength des Felds. Werte, die ein Skript setzt, lösen kein input aus:
// danach refreshCharCounters() aufrufen.

function update(counter: HTMLElement) {
  const field = document.getElementById(counter.dataset.charCounter ?? '') as HTMLInputElement | HTMLTextAreaElement | null;
  if (!field || field.maxLength <= 0) return;
  const length = field.value.length;
  const max = field.maxLength;
  counter.textContent = `${length} / ${max}`;
  if (length >= max) counter.dataset.level = 'full';
  else if (length >= max * 0.9) counter.dataset.level = 'warn';
  else delete counter.dataset.level;
}

export function refreshCharCounters(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>('[data-char-counter]').forEach(update);
}

export function setupCharCounters(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>('[data-char-counter]').forEach((counter) => {
    if (counter.dataset.bound === 'true') return;
    counter.dataset.bound = 'true';
    const field = document.getElementById(counter.dataset.charCounter ?? '');
    field?.addEventListener('input', () => update(counter));
    update(counter);   // Eingaben vor dem Verdrahten
  });
}
