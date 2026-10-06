// Owner 10-06: ONE membership rule for the dugout boxes, shared by the coach-corner "N RES / N OUT" tab.
// Mirrors packages/ffb-pitch/src/renderer.ts drawDugouts (SECTION_DEFS + claimedDugoutStates + the 10-06 count):
//   - a team's OFF-PITCH players are its roster players whose base state is RESERVE or whose coordinate is off the pitch;
//   - OUT  = KO + Badly Hurt + Serious Injury + RIP (the INJURED box) + BANNED (sent off; the Java client's "Out" and the
//            owner's 10-06 dugout-label ruling — they stand on the corner apron but count with the injured);
//   - MNG (MISSING) is claimed by no box and counts in NEITHER;
//   - RES  = every other off-pitch player (RESERVES is the renderer's catch-all, e.g. SETUP_PREVENTED).
//   - before the first real setup the renderer PRESENTS up to 11 players per side on the pitch (preSetupPlacements,
//     its private preSetupCoords) and leaves them out of the dugout; the same pure helper excludes them here.
// The renderer still carries its own copy of these rules; if it is ever refactored to share this helper, delete that copy.
import type { GameJson } from '@fumbbl40k/ffb-protocol';
import { PlayerStateBase, baseState, isOnPitch, preSetupPlacements } from '@fumbbl40k/ffb-pitch';

/** Owner 10-06: the notice when a right-click on the coach-corner tab hides both tabs. */
export const COACH_CORNER_COUNTS_HIDDEN_NOTICE = 'Reserve / Out counts hidden — Settings > UI turns them back on';

export interface TeamBoxCounts { reserves: number; out: number }

export const OUT_STATES: readonly number[] = [
  PlayerStateBase.KNOCKED_OUT,
  PlayerStateBase.BADLY_HURT,
  PlayerStateBase.SERIOUS_INJURY,
  PlayerStateBase.RIP,
  PlayerStateBase.BANNED,
];
/** States the RESERVES catch-all never takes: the OUT states plus MNG (no box at all). */
const CLAIMED_NOT_RESERVE = new Set<number>([...OUT_STATES, PlayerStateBase.MISSING]);

export function teamBoxCounts(game: GameJson | null | undefined, side: 'home' | 'away'): TeamBoxCounts {
  const counts: TeamBoxCounts = { reserves: 0, out: 0 };
  if (!game) return counts;
  const team = side === 'home' ? game.teamHome : game.teamAway;
  const roster = new Set((team?.playerArray ?? []).map((p) => p.playerId));
  // renderer.ts drawDugouts: `!this.preSetupCoords.has(d.playerId)` (preSetupCoords = preSetupPlacements(game)).
  const presented = game.fieldModel && game.teamHome && game.teamAway ? preSetupPlacements(game) : new Map<string, unknown>();
  for (const d of game.fieldModel?.playerDataArray ?? []) {
    if (!roster.has(d.playerId) || presented.has(d.playerId)) continue;
    const b = baseState(d.playerState ?? 0);
    if (b !== PlayerStateBase.RESERVE && isOnPitch(d.playerCoordinate)) continue;
    if (OUT_STATES.includes(b)) counts.out++;
    else if (!CLAIMED_NOT_RESERVE.has(b)) counts.reserves++;
  }
  return counts;
}
