import type { RailDiagnostic } from './railDiagnostics';

/** Structured rail telemetry shares the per-game JSONL with inbound/outbound wire records so bug reports retain
 * the exact diagnostic occurrence. It deliberately carries no command payload or credentials. */
export function railDiagnosticWireRecord(seq: number, t: number, diagnostic: Readonly<RailDiagnostic>) {
  return {
    seq,
    t,
    dir: 'diagnostic' as const,
    category: 'rail' as const,
    diagnostic: { ...diagnostic },
  };
}

/** Owner 09-27 (game 1947111: a Taunt decision "never resolved" — the log could not tell a slow opponent from a
 *  stalled socket): CONNECTION records ride the same per-game JSONL. Events: `state` (session state change),
 *  `close` (code + reason), `error`, `pong` (round-trip + gap since the previous pong) and `pong-overdue` (no pong
 *  for longer than expected — logging only, nothing reconnects). No payloads, no credentials. */
export type ConnectionWireEvent = 'state' | 'close' | 'error' | 'pong' | 'pong-overdue' | 'join-start' | 'join-error';
/** Owner 09-27: a join that never reaches a game has no per-game wire file — its connection records go to a dated
 *  connection log instead, so a failed rejoin leaves evidence. */
export function connectionLogFileName(now: Date): string {
  return `connection-${now.toISOString().slice(0, 10)}.jsonl`;
}
export function connectionWireRecord(seq: number, t: number, event: ConnectionWireEvent, detail: Readonly<Record<string, string | number | boolean | null>> = {}) {
  return { seq, t, dir: 'connection' as const, event, ...detail };
}
/** The pong-overdue ladder: a line when the silence first passes 20 s, again at 60 s, then once per further minute.
 *  Returns the stage reached for `silenceMs` (0 = not overdue); a caller logs when the stage rises. */
export function pongOverdueStage(silenceMs: number): number {
  if (!(silenceMs >= 20_000)) return 0;
  if (silenceMs < 60_000) return 1;
  return 1 + Math.floor(silenceMs / 60_000);
}
