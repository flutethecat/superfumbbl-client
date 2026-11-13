// Touch mode staged commits (review findings 4, 5 and 10). In touch mode a tap that would send a dice-rolling or
// irreversible command stages it instead; only the action center's Confirm sends it. A stage is bound to the moment it
// was made - the game, half, turn, turn mode, acting player, its action and its square (the `key`) - and is dropped as
// soon as any of them changes. At Confirm it is checked again (same key, and `revalidate`, which re-runs the same
// router / legality code the tap used) before `commit` sends exactly what the tap used to send.

/** Every kind the match view stages (round-2 finding 2): the registry a test holds the view to, so no staged tap can
 *  exist without being listed - and every stage object carries its own commit, which Confirm runs. */
export const TOUCH_STAGE_KINDS = [
  'furyBlock', 'kegTarget', 'swoop', 'fieldCoordinate', 'blitzTarget', 'kickEmBlock', 'blastinTarget', 'multiBlock', 'foulTarget',
  'handOverTarget', 'ttmPickup', 'squarePick', 'fireball', 'blitzToMove', 'furiousOutburst', 'ballAndChain', 'leap', 'step',
  'chooserPlainBlock', 'blockTarget', 'pushback', 'playerPick', 'bncAim', 'kickoff', 'quickSnap',
] as const;

export interface TouchStage {
  /** What is staged (for the label and the same-target check). */
  kind: string;
  /** The target (player id or "x,y"): a second tap on the same staged target does nothing. */
  target: string;
  /** The action center's Confirm label. */
  label: string;
  /** Re-run the tap's own legality check against the game as it is now. */
  revalidate: () => boolean;
  /** Send exactly what the tap used to send. */
  commit: () => void;
  /** The commit may legitimately send nothing (a client-held step, e.g. a wide-rail election): never re-staged. */
  local?: boolean;
  /** Round 5: the walk this stage's commit sends (Throw Team-Mate pickup); the plan draws exactly this. */
  route?: [number, number][];
  /** Round-4 finding 1: draw what the commit will send (a walk) whenever this stage is the current one ... */
  draw?: () => void;
  /** ... and take it down when the stage is retired, replaced or sent. */
  onRetire?: () => void;
}

export interface TouchStageContext {
  gameId: string;
  half: number;
  turnHome: number;
  turnAway: number;
  homePlaying: boolean;
  turnMode: string;
  actorId: string;
  playerAction: string;
  actorSquare: string;
  /** Squares moved this activation (a step taken retires a stage made from the earlier square). */
  currentMove: number;
}

export function touchStageKey(c: TouchStageContext): string {
  return [c.gameId, c.half, c.turnHome, c.turnAway, c.homePlaying ? 'H' : 'A', c.turnMode, c.actorId, c.playerAction, c.actorSquare, c.currentMove].join('|');
}

/** Reads the binding context from a game model (loose: every field optional on the wire). */
export function touchStageContext(g: unknown): TouchStageContext {
  const game = (g ?? {}) as {
    gameId?: unknown; id?: unknown; half?: unknown; turnMode?: unknown; homePlaying?: unknown;
    turnDataHome?: { turnNr?: unknown }; turnDataAway?: { turnNr?: unknown };
    actingPlayer?: { playerId?: unknown; playerAction?: unknown; currentMove?: unknown };
    fieldModel?: { playerDataArray?: { playerId?: unknown; playerCoordinate?: unknown }[] };
  };
  const actorId = String(game.actingPlayer?.playerId ?? '');
  const sq = actorId ? game.fieldModel?.playerDataArray?.find((d) => d.playerId === actorId)?.playerCoordinate : null;
  return {
    gameId: String(game.gameId ?? game.id ?? ''),
    half: Number(game.half ?? 0),
    turnHome: Number(game.turnDataHome?.turnNr ?? 0),
    turnAway: Number(game.turnDataAway?.turnNr ?? 0),
    homePlaying: game.homePlaying === true,
    turnMode: String(game.turnMode ?? ''),
    actorId,
    playerAction: String(game.actingPlayer?.playerAction ?? ''),
    actorSquare: Array.isArray(sq) ? `${sq[0]},${sq[1]}` : '',
    currentMove: Number(game.actingPlayer?.currentMove ?? 0),
  };
}

export type TouchStageTap = 'staged' | 'same';
/** 'refused' (round-3 finding 2): the commit sent nothing while the tap still validates - the stage is kept to retry. */
export type TouchStageConfirm = 'sent' | 'stale' | 'none' | 'refused';

export interface TouchStageHolder {
  current(): (TouchStage & { key: string }) | null;
  /** A tap: stage it, or 'same' (nothing happens) when this exact target is already staged under the same key. */
  tap(stage: TouchStage): TouchStageTap;
  /** Confirm: send when still bound and legal, else drop it ('stale'). */
  confirm(): TouchStageConfirm;
  /** Drop the stage when the binding key moved on (call on every model change). */
  sync(): void;
  clear(): void;
}

export function createTouchStageHolder(currentKey: () => string, onChange: (stage: (TouchStage & { key: string }) | null) => void = () => undefined,
  sentCount?: () => number): TouchStageHolder {
  let staged: (TouchStage & { key: string }) | null = null;
  const set = (s: (TouchStage & { key: string }) | null) => {
    if (staged && staged !== s) staged.onRetire?.();
    staged = s;
    s?.draw?.();
    onChange(s);
  };
  return {
    current: () => staged,
    tap(stage) {
      const key = currentKey();
      if (staged && staged.key === key && staged.kind === stage.kind && staged.target === stage.target) return 'same';
      set({ ...stage, key });
      return 'staged';
    },
    confirm() {
      const s = staged;
      if (!s) return 'none';
      set(null);
      if (s.key !== currentKey() || !s.revalidate()) return 'stale';
      const before = sentCount?.();
      s.commit();
      // Round-3 finding 2: nothing went out (a refused send) and the tap still holds: keep it so Confirm can retry.
      if (!s.local && sentCount && sentCount() === before && staged === null && s.key === currentKey() && s.revalidate()) {
        set(s);
        return 'refused';
      }
      return 'sent';
    },
    sync() { if (staged && staged.key !== currentKey()) set(null); },
    clear() { if (staged) set(null); },
  };
}
