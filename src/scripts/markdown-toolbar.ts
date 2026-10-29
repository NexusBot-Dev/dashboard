// Markdown-Toolbar über Textfeldern (fett, kursiv, Überschriften, Listen, Code).
// Markup: <div data-md-toolbar="<textarea-id>"> mit Buttons <button data-md="bold|italic|…">.

function wrapSelection(ta: HTMLTextAreaElement, before: string, after = before) {
  const start = ta.selectionStart, end = ta.selectionEnd;
  const val = ta.value;
  const selected = val.slice(start, end);
  ta.value = val.slice(0, start) + before + selected + after + val.slice(end);
  ta.selectionStart = start + before.length;
  ta.selectionEnd = start + before.length + selected.length;
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  ta.focus();
}

function prefixLines(ta: HTMLTextAreaElement, prefix: string) {
  const start = ta.selectionStart, end = ta.selectionEnd;
  const val = ta.value;
  const lineStart = val.lastIndexOf('\n', start - 1) + 1;
  let lineEnd = val.indexOf('\n', end);
  if (lineEnd === -1) lineEnd = val.length;
  const block = val.slice(lineStart, lineEnd);
  const newBlock = block.split('\n').map((l) => prefix + l).join('\n');
  ta.value = val.slice(0, lineStart) + newBlock + val.slice(lineEnd);
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  ta.focus();
}

export function setupMarkdownToolbars() {
  document.querySelectorAll<HTMLElement>('[data-md-toolbar]').forEach((toolbar) => {
    if (toolbar.dataset.bound === 'true') return;
    toolbar.dataset.bound = 'true';
    const ta = document.getElementById(toolbar.dataset.mdToolbar ?? '') as HTMLTextAreaElement | null;
    if (!ta) return;
    toolbar.querySelectorAll<HTMLElement>('[data-md]').forEach((btn) => {
      btn.addEventListener('click', () => {
        switch (btn.dataset.md) {
          case 'bold': wrapSelection(ta, '**'); break;
          case 'italic': wrapSelection(ta, '*'); break;
          case 'underline': wrapSelection(ta, '__'); break;
          case 'strike': wrapSelection(ta, '~~'); break;
          case 'code': wrapSelection(ta, '`'); break;
          case 'codeblock': wrapSelection(ta, '```\n', '\n```'); break;
          case 'h1': prefixLines(ta, '# '); break;
          case 'h2': prefixLines(ta, '## '); break;
          case 'h3': prefixLines(ta, '### '); break;
          case 'list': prefixLines(ta, '- '); break;
        }
      });
    });
  });
}
