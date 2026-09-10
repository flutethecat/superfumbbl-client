/** Owner 08-19: split a chat 'talk' line ("coach: message") so the view can colour the
 *  COACH NAME by seat (same logNameColor mapping as log player names) while the message
 *  stays plain (--ui-text). The store builds talk text as `${coach}: ${words}` (store.ts
 *  session.on('talk')), so the FIRST ": " is the boundary; a line without one renders
 *  whole (fail-soft). Pure so the view and its tests read the same table. */
export function chatLineParts(text: string): { name: string; rest: string } {
  const i = text.indexOf(': ');
  if (i <= 0) return { name: '', rest: text };
  return { name: text.slice(0, i), rest: text.slice(i + 2) };
}
