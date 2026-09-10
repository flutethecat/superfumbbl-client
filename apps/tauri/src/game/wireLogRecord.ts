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
