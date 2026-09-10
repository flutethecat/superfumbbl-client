import type { GameJson } from '@fumbbl40k/ffb-protocol';

/** Owner audit 08-17 (P1 — Iron Man/Knuckle Dusters cannot reach every offered reserve):
 *  shared helpers behind the roster-list picker used by both ClassicView and SpectateView.
 *  Resolves a server `playerPick.eligibleIds` array — the EXACT upstream candidate IDs,
 *  never substituted or re-derived — into display rows, and detects when a candidate has
 *  no on-pitch coordinate (so a pitch/dugout crosshair surface may not visibly reach it). */

export interface RosterPickCandidate {
  id: string;
  nr: number | null;
  name: string;
  pos: string;
}

function isOnPitch(coordinate: readonly number[] | null | undefined): boolean {
  return !!coordinate
    && coordinate[0]! >= 0 && coordinate[0]! <= 25
    && coordinate[1]! >= 0 && coordinate[1]! <= 14;
}

type LooseGame = {
  teamHome?: { playerArray?: { playerId: string; playerNr?: number; playerName?: string; positionId?: string; positionName?: string }[]; roster?: { positionArray?: { positionId: string; positionName?: string }[] } };
  teamAway?: { playerArray?: { playerId: string; playerNr?: number; playerName?: string; positionId?: string; positionName?: string }[]; roster?: { positionArray?: { positionId: string; positionName?: string }[] } };
} | null;

/** Resolve eligibleIds (verbatim, in server order) into {id,nr,name,pos} rows for the list UI.
 *  Ported from ClassicView's mvpNomination `resolve` (owner 2026-07-16, audit G2a) so both the
 *  MVP nomination modal and the generic roster picker share one lookup. */
export function resolveRosterPickCandidates(game: GameJson | null, eligibleIds: readonly string[]): RosterPickCandidate[] {
  const g = game as LooseGame;
  const resolve = (id: string): RosterPickCandidate => {
    for (const team of [g?.teamHome, g?.teamAway]) {
      const raw = (team?.playerArray ?? []).find((p) => p.playerId === id);
      if (raw) {
        const pos = raw.positionName
          ?? (team?.roster?.positionArray ?? []).find((q) => q.positionId === raw.positionId)?.positionName ?? '';
        return { id, nr: raw.playerNr ?? null, name: raw.playerName ?? 'Player', pos };
      }
    }
    return { id, nr: null, name: 'Player', pos: '' };
  };
  return eligibleIds.map(resolve);
}

/** True when at least one offered candidate currently has no on-pitch coordinate — e.g. a
 *  reserve displaced by Stars or beyond the synthetic pre-setup formation's eleven placements
 *  (packages/ffb-pitch/src/preSetupFormation.ts). Modern's dugout hit-test (renderer.ts
 *  onPlayerPick tap handler) can still reach such a candidate; Classic has no dugout surface
 *  at all, so callers there show the list unconditionally rather than consulting this. */
export function hasOffPitchCandidate(game: GameJson | null, eligibleIds: readonly string[]): boolean {
  if (!game || eligibleIds.length === 0) return false;
  const dataById = new Map(game.fieldModel.playerDataArray.map((d) => [d.playerId, d]));
  return eligibleIds.some((id) => !isOnPitch(dataById.get(id)?.playerCoordinate));
}
