import { PlayerStateBase } from '@fumbbl40k/ffb-pitch';

export interface WisdomSetupPlayer {
  playerId: string;
  playerState: number;
}

export interface WisdomSetupPlayerGate {
  playerId: string;
  placeable: boolean;
}

export interface WisdomSetupGate {
  active: boolean;
  players: WisdomSetupPlayerGate[];
}

/** ffb-common/src/main/java/com/fumbbl/ffb/PlayerState.java:226-228: setup movement accepts STANDING or RESERVE. */
export function wisdomSetupGate(
  turnMode: string | null | undefined,
  players: readonly WisdomSetupPlayer[],
): WisdomSetupGate {
  if (turnMode !== 'dwarfenWisdom') return { active: false, players: [] };

  return {
    active: true,
    players: players.map((player) => {
      const base = player.playerState & 0xff;
      return {
        playerId: player.playerId,
        placeable: base === PlayerStateBase.STANDING || base === PlayerStateBase.RESERVE,
      };
    }),
  };
}
