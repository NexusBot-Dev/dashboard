// Schatten am unteren Rand einer scrollbaren Liste, solange sie noch weiter scrollt (Klasse .scroll-fade in global.css).

export function setupScrollFade(list: HTMLElement) {
  const updateFade = () => {
    const hasOverflow = list.scrollHeight > list.clientHeight + 4;
    const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 4;
    list.classList.toggle('scroll-fade', hasOverflow && !atBottom);
  };
  updateFade();
  list.addEventListener('scroll', updateFade);
  new ResizeObserver(updateFade).observe(list);
}
