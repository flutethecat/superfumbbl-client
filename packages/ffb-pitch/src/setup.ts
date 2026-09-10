/**
 * Team-setup rules (owner 2026-07-04). All coordinates are HOME-RELATIVE (game
 * x = long axis 0..25, y = across 0..14) — the server transforms the away team,
 * so both coaches set up in the same frame: own half x 0..12, line of scrimmage
 * at x = 12 (front row of the own half).
 *
 * Column nomenclature (see docs/pitch-coordinates.md): A–O = y 0..14. The wide
 * zones are the 4 columns at each flank — LEFT A–D (y 0..3), RIGHT L–O (y 11..14);
 * the CENTRE is E–K (y 4..10). Setup limits count only squares on the OWN half.
 */
import { PITCH_ROWS } from './geometry';

/** Home-relative line-of-scrimmage row (front of the own half). */
export const SETUP_LOS_X = 12;
/** Own half spans x 0..12 (inclusive of the LOS). */
export const SETUP_OWN_HALF_MAX_X = 12;
/** Each wide zone is 4 columns wide. */
export const WIDE_ZONE_WIDTH = 4;
/** Standard Blood Bowl: at least 3 on the LOS, at most 2 in each wide zone. */
export const MIN_ON_LOS = 3;
export const MAX_PER_WIDE_ZONE = 2;
/** Max players a coach may field. */
export const MAX_ON_PITCH = 11;
/** Fewer than three players available at drive start → the coach may legally concede. */
export const CONCEDE_THRESHOLD = 2;

export function isOwnHalf(x: number): boolean {
  return x >= 0 && x <= SETUP_OWN_HALF_MAX_X;
}
export function isOnLos(x: number): boolean {
  return x === SETUP_LOS_X;
}
export function isLeftWideColumn(y: number): boolean {
  return y >= 0 && y < WIDE_ZONE_WIDTH;
}
export function isRightWideColumn(y: number): boolean {
  return y >= PITCH_ROWS - WIDE_ZONE_WIDTH && y < PITCH_ROWS;
}
/** A wide-zone SQUARE = a wide column on the own half. */
export function isWideZoneSquare(x: number, y: number): boolean {
  return isOwnHalf(x) && (isLeftWideColumn(y) || isRightWideColumn(y));
}

export interface SetupValidation {
  /** Players standing on the LOS row (own half). */
  onLos: number;
  /** Players in the left wide zone (own half). */
  leftWide: number;
  /** Players in the right wide zone (own half). */
  rightWide: number;
  /** Players placed on the own half. */
  placed: number;
  /** Players available to place (on-pitch max is min(11, available)). */
  available: number;
  /** Number that must be placed = min(11, available). */
  required: number;
  losOk: boolean;
  leftOk: boolean;
  rightOk: boolean;
  countOk: boolean;
  /** All constraints satisfied → setup may be submitted. */
  valid: boolean;
  /** Fewer than three players available → a legal concession is offered. */
  canConcede: boolean;
}

/**
 * Validate a proposed setup: `placedCoords` are the home-relative squares of the
 * coach's placed players; `available` is how many players they have to place.
 */
export function validateSetup(placedCoords: readonly [number, number][], available: number): SetupValidation {
  const own = placedCoords.filter((c) => isOwnHalf(c[0]));
  // Owner 08-05 (rules): the 3 must be on the LoS in the CENTER field — wide-zone columns do NOT count.
  // Upstream-exact: FieldCoordinateBounds.LOS_HOME = (12,4)..(12,10) (center 7 columns only; SetupMechanic
  // counts playersOnLos against THAT bounds). Our old whole-column count let a wide-zone LoS square
  // falsely satisfy the checklist while the server would reject the setup.
  const onLos = own.filter((c) => isOnLos(c[0]) && !isLeftWideColumn(c[1]) && !isRightWideColumn(c[1])).length;
  const leftWide = own.filter((c) => isLeftWideColumn(c[1])).length;
  const rightWide = own.filter((c) => isRightWideColumn(c[1])).length;
  const placed = own.length;
  const required = Math.min(MAX_ON_PITCH, available);
  const losOk = onLos >= Math.min(MIN_ON_LOS, available);
  const leftOk = leftWide <= MAX_PER_WIDE_ZONE;
  const rightOk = rightWide <= MAX_PER_WIDE_ZONE;
  const countOk = placed === required;
  return {
    onLos,
    leftWide,
    rightWide,
    placed,
    available,
    required,
    losOk,
    leftOk,
    rightOk,
    countOk,
    valid: losOk && leftOk && rightOk && countOk,
    canConcede: available <= CONCEDE_THRESHOLD,
  };
}
