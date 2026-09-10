/**
 * BB2025 passing range ruler, mirrored from the server
 * (mechanics/bb2025/PassMechanic.throwingRangeTable): quarter-circle grid
 * indexed by (|Δx|, |Δy|). T = thrower's square, Q(uick) mod 0, S(hort) −1,
 * L(ong) −2, B(omb) −3; blank = out of range. See activation_logic.md C9.
 */

export type PassRange = 'T' | 'Q' | 'S' | 'L' | 'B';

const RANGE_TABLE = [
  'TQQQSSSLLLLBBB',
  'QQQQSSSLLLLBBB',
  'QQQSSSSLLLLBBB',
  'QQSSSSSLLLBBB ',
  'SSSSSSLLLLBBB ',
  'SSSSSLLLLBBB  ',
  'SSSSLLLLLBBB  ',
  'LLLLLLLLBBB   ',
  'LLLLLLLBBBB   ',
  'LLLLLBBBBB    ',
  'LLLBBBBBB     ',
  'BBBBBBB       ',
  'BBBBB         ',
  'BBB           ',
];

export const PASS_MODIFIERS: Record<PassRange, number> = { T: 0, Q: 0, S: -1, L: -2, B: -3 };

/** Range band for a throw of (Δx, Δy) squares, or null when out of range. */
export function passRange(deltaX: number, deltaY: number): PassRange | null {
  const dx = Math.abs(deltaX);
  const dy = Math.abs(deltaY);
  if (dx >= 14 || dy >= 14) return null;
  const cell = RANGE_TABLE[dy]![dx]!;
  return cell === ' ' ? null : (cell as PassRange);
}
