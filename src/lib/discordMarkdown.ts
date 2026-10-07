export function renderDiscordMarkdown(text: string): string {
  let out = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Codeblöcke zuerst herauslösen, damit ihr Inhalt nicht weiter formatiert wird
  const codeBlocks: string[] = [];
  out = out.replace(/```([\s\S]*?)```/g, (_m, code) => {
    codeBlocks.push(code);
    return `%%CB${codeBlocks.length - 1}%%`;
  });

  out = out.replace(/`([^`\n]+)`/g, '<code class="px-1 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-xs">$1</code>');

  // Kombinierte Formatierungen vor den einfachen, sonst greifen die falschen Regeln zuerst
  out = out.replace(/__\*\*\*(.+?)\*\*\*__/g, '<u><strong><em>$1</em></strong></u>');
  out = out.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  out = out.replace(/__\*\*(.+?)\*\*__/g, '<u><strong>$1</strong></u>');
  out = out.replace(/__\*(.+?)\*__/g, '<u><em>$1</em></u>');
  out = out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/__(.+?)__/g, '<u>$1</u>');
  out = out.replace(/\*(.+?)\*/g, '<em>$1</em>');
  out = out.replace(/(?<!\w)_(.+?)_(?!\w)/g, '<em>$1</em>');
  out = out.replace(/~~(.+?)~~/g, '<del>$1</del>');

  // Überschriften und Listen zeilenweise
  out = out
    .split('\n')
    .map((line) => {
      if (/^### (.+)/.test(line)) return line.replace(/^### (.+)/, '<span class="text-sm font-bold">$1</span>');
      if (/^## (.+)/.test(line)) return line.replace(/^## (.+)/, '<span class="text-base font-bold">$1</span>');
      if (/^# (.+)/.test(line)) return line.replace(/^# (.+)/, '<span class="text-lg font-bold">$1</span>');
      if (/^\s{0,2}[-*] (.+)/.test(line)) return line.replace(/^\s{0,2}[-*] (.+)/, '• $1');
      return line;
    })
    .join('\n');

  // Codeblöcke wieder einsetzen
  out = out.replace(
    /%%CB(\d+)%%/g,
    (_m, i) =>
      `<pre class="bg-slate-200 dark:bg-slate-700 rounded p-2 text-xs overflow-x-auto my-1"><code>${codeBlocks[Number(i)]}</code></pre>`,
  );

  return out.replace(/\n/g, '<br>');
}

/**
 * Vorschau mit Platzhaltern. Jede Seite übergibt nur die Variablen, die sie kennt:
 *   embeds:  { user, username, server }
 *   boosts:  { user, username, server, count }
 *   welcome: { user, username, server, membercount }
 *   tickets: keine
 */
export function renderPreview(text: string, vars: Record<string, string | number> = {}): string {
  let out = text;
  for (const [key, value] of Object.entries(vars)) {
    out = out.replaceAll(`{${key}}`, String(value));
  }
  return renderDiscordMarkdown(out);
}