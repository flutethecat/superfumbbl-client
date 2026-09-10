/** Mirror of ffb-common PlayerState.java: base state in the low byte, flags above. */

export const PlayerStateBase = {
  UNKNOWN: 0x00,
  STANDING: 0x01,
  MOVING: 0x02,
  PRONE: 0x03,
  STUNNED: 0x04,
  KNOCKED_OUT: 0x05,
  BADLY_HURT: 0x06,
  SERIOUS_INJURY: 0x07,
  RIP: 0x08,
  RESERVE: 0x09,
  MISSING: 0x0a,
  FALLING: 0x0b,
  BLOCKED: 0x0c,
  BANNED: 0x0d,
  EXHAUSTED: 0x0e,
  BEING_DRAGGED: 0x0f,
  PICKED_UP: 0x10,
  HIT_ON_GROUND: 0x11,
  SETUP_PREVENTED: 0x14,
  IN_THE_AIR: 0x15,
} as const;

export const PlayerStateFlag = {
  ACTIVE: 0x00100,
  CONFUSED: 0x00200,
  ROOTED: 0x00400,
  HYPNOTIZED: 0x00800,
  SELECTED_STAB_TARGET: 0x01000,
  USED_PRO: 0x02000,
  SELECTED_BLITZ_TARGET: 0x04000,
  SELECTED_BLOCK_TARGET: 0x08000,
  SELECTED_GAZE_TARGET: 0x10000,
  EYE_GOUGED: 0x20000,
  CHOMPED: 0x40000,
} as const;

export function baseState(playerState: number): number {
  return playerState & 0xff;
}

export function hasFlag(playerState: number, flag: number): boolean {
  return (playerState & flag) !== 0;
}

/** Mirrors PlayerState.hasTacklezones: standing/moving/blocked, not confused/hypnotized. */
export function hasTackleZones(playerState: number): boolean {
  const base = baseState(playerState);
  return (
    (base === PlayerStateBase.STANDING || base === PlayerStateBase.MOVING || base === PlayerStateBase.BLOCKED) &&
    !hasFlag(playerState, PlayerStateFlag.CONFUSED) &&
    !hasFlag(playerState, PlayerStateFlag.HYPNOTIZED)
  );
}

/** On the ground but still on the pitch. */
export function isDown(playerState: number): boolean {
  const base = baseState(playerState);
  return base === PlayerStateBase.PRONE || base === PlayerStateBase.STUNNED;
}

/** Renders on the pitch at all (vs dugout/box states). */
export function rendersOnPitch(playerState: number): boolean {
  const base = baseState(playerState);
  return (
    base === PlayerStateBase.STANDING ||
    base === PlayerStateBase.MOVING ||
    base === PlayerStateBase.PRONE ||
    base === PlayerStateBase.STUNNED ||
    base === PlayerStateBase.FALLING ||
    base === PlayerStateBase.BLOCKED ||
    base === PlayerStateBase.EXHAUSTED ||
    base === PlayerStateBase.BEING_DRAGGED ||
    base === PlayerStateBase.PICKED_UP ||
    base === PlayerStateBase.HIT_ON_GROUND ||
    base === PlayerStateBase.IN_THE_AIR
  );
}

/** ⚖ SERVER-DERIVED (owner 08-19): the DEFENDER decoration upstream draws while a block
 *  result is applying. Mirrors PlayerIconFactory.getIcon: base BLOCKED / FALLING /
 *  HIT_ON_GROUND → DECORATION_BLOCK_HOME when the home side is playing, else _AWAY
 *  (inverted under TurnMode TRICKSTER). Server sets BLOCKED in StepInitBlocking and
 *  clears it via ServerUtilBlock.removePlayerBlockStates — the model change is the only
 *  signal; no client latch. Returns the decoration key or null. */
export function blockedDecoration(
  playerState: number,
  homePlaying: boolean,
  turnMode: string,
): 'block_home' | 'block_away' | null {
  const base = baseState(playerState);
  if (
    base !== PlayerStateBase.BLOCKED &&
    base !== PlayerStateBase.FALLING &&
    base !== PlayerStateBase.HIT_ON_GROUND
  ) {
    return null;
  }
  const useHome = turnMode === 'trickster' ? !homePlaying : homePlaying;
  return useHome ? 'block_home' : 'block_away';
}
