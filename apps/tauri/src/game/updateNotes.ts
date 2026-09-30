/** Owner 09-30 (first app patch, live): release notes arrive as markdown (`## Super FUMBBL 1.0.32`, `- item`) and
 *  the update prompt showed them raw. Plain-text rendering: the version heading goes (the prompt title carries
 *  the version), list markers become bullets, emphasis markers drop, blank runs collapse. No HTML. */
export function updateNotesText(notes: string | undefined | null): string {
  if (!notes) return '';
  const lines: string[] = [];
  for (const raw of notes.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    if (/^#{1,6}\s/.test(line)) continue; // headings: the prompt already names the version
    const item = /^\s*[-*+]\s+(.*)$/.exec(line);
    const text = (item ? `• ${item[1]}` : line).replace(/\*\*(.+?)\*\*/g, '$1').replace(/`(.+?)`/g, '$1');
    if (text.trim() === '' && (lines.length === 0 || lines[lines.length - 1] === '')) continue;
    lines.push(text.trim() === '' ? '' : text);
  }
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n');
}
