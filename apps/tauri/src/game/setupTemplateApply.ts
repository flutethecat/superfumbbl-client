import { NetCommandId, type GameJson } from '@fumbbl40k/ffb-protocol';
import {
  legalityOptionsFromGameOptions,
  mirrorTemplate,
  resolveTemplate,
  type ResolvedPlacement,
  type SetupTemplate,
  type SetupValidation,
  type TemplatePlayer,
} from '@fumbbl40k/ffb-pitch';
import { ringTypeForName } from '../../../../packages/ffb-pitch/src/positionTypes';

interface PlayerLike {
  playerId: string;
  playerNr?: number;
  positionId?: string;
  positionName?: string;
  movement?: number;
  strength?: number;
  agility?: number;
  passing?: number;
  armour?: number;
  cost?: number;
  skillArray?: string[];
}

interface PositionLike {
  positionId: string;
  positionName?: string;
  movement?: number;
  strength?: number;
  agility?: number;
  passing?: number;
  armour?: number;
  cost?: number;
  skillArray?: string[];
}

export interface TeamLike {
  playerArray?: PlayerLike[];
  roster?: { positionArray?: PositionLike[] };
}

export interface FieldModelLike {
  playerDataArray?: { playerId: string; playerState?: number; playerCoordinate?: [number, number] | null }[];
}

export interface SetupTemplateApplyDeps {
  game: () => GameJson | null;
  armed: () => boolean;
  myTeam: () => TeamLike | null;
  send: (command: unknown) => void;
  freeReserveCoordinate: (g: GameJson) => [number, number];
  canFieldInSetup: (stateBase: number) => boolean;
}

export type ApplyResult =
  | { applied: false; placements: readonly []; validation: null }
  | { applied: true; placements: readonly ResolvedPlacement[]; validation: SetupValidation };

function numberOr(value: unknown, fallback: unknown): number {
  if (Number.isFinite(Number(value))) return Number(value);
  return Number.isFinite(Number(fallback)) ? Number(fallback) : 0;
}

/** Mirrors computeSetupPhase's player -> roster-position projection. */
export function templatePlayersFromTeam(team: TeamLike, _fieldModel: FieldModelLike): TemplatePlayer[] {
  const positions = team.roster?.positionArray ?? [];
  return (team.playerArray ?? []).map((player) => {
    const position = positions.find((candidate) => candidate.positionId === player.positionId);
    const positionName = player.positionName ?? position?.positionName ?? '';
    return {
      playerId: player.playerId,
      nr: player.playerNr ?? 0,
      positionName,
      ringType: ringTypeForName(positionName) ?? undefined,
      strength: numberOr(player.strength, position?.strength),
      armour: numberOr(player.armour, position?.armour),
      movement: numberOr(player.movement, position?.movement),
      cost: numberOr(position?.cost, 0),
      skills: player.skillArray ?? position?.skillArray ?? [],
    };
  });
}

function isOnPitch(coordinate: [number, number] | null | undefined): coordinate is [number, number] {
  return !!coordinate
    && coordinate[0] >= 0 && coordinate[0] <= 25
    && coordinate[1] >= 0 && coordinate[1] <= 14;
}

export function applySetupTemplate(
  deps: SetupTemplateApplyDeps,
  template: SetupTemplate,
  opts: { mirrored?: boolean } = {},
): ApplyResult {
  if (!deps.armed()) return { applied: false, placements: [], validation: null };
  const game = deps.game();
  if (!game) return { applied: false, placements: [], validation: null };
  const team = deps.myTeam();
  if (!team) return { applied: false, placements: [], validation: null };

  const dataById = new Map((game.fieldModel?.playerDataArray ?? []).map((data) => [data.playerId, data] as const));
  const players = templatePlayersFromTeam(team, game.fieldModel).filter((player) =>
    deps.canFieldInSetup((dataById.get(player.playerId)?.playerState ?? 0) & 0xff),
  );
  const selected = opts.mirrored ? mirrorTemplate(template) : template;
  const { placements, validation } = resolveTemplate(
    selected,
    players,
    legalityOptionsFromGameOptions(game.gameOptions?.gameOptionArray ?? []),
  );

  // Mirror placeSetup/store.setupSwap: vacate every owned pitch square before any landing.
  const myIds = new Set((team.playerArray ?? []).map((player) => player.playerId));
  for (const data of game.fieldModel?.playerDataArray ?? []) {
    if (myIds.has(data.playerId) && isOnPitch(data.playerCoordinate)) {
      deps.send({
        netCommandId: NetCommandId.CLIENT_SETUP_PLAYER,
        playerId: data.playerId,
        coordinate: deps.freeReserveCoordinate(game),
      });
    }
  }
  for (const placement of placements) {
    deps.send({
      netCommandId: NetCommandId.CLIENT_SETUP_PLAYER,
      playerId: placement.playerId,
      coordinate: placement.coordinate,
    });
  }

  return { applied: true, placements, validation };
}
