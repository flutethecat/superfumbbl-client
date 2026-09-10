/** Owner 08-18 (+08-19): log-panel timestamps are MILITARY time — fixed-width 24h HH:MM,
 *  no AM/PM and no locale drift (toLocaleTimeString gave "1:05:09 PM" width swings).
 *  08-19: seconds DROPPED — HH:MM only; the copied text is this same string. */
export function logTimestamp(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}
