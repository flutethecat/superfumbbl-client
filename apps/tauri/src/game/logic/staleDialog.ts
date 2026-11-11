export const SETUP_NOTICE_LIVE_MODES: ReadonlySet<string> = new Set([
  'setup',
  'solidDefence',
  'perfectDefence',
  'swarming',
]);

/** Dwarfen Wisdom `useInducement` liveness, derived from upstream bb2025 kickoff/StepDwarfenWisdom + Kickoff.java.
 *
 *  Kickoff.java runs ... SETUP, SETUP, DWARFEN_WISDOM(kicker, handleReceivingTeam=false),
 *  DWARFEN_WISDOM(receiver, handleReceivingTeam=true), SWARMING x2, MASTER_CHEF, KICKOFF. Entering the Wisdom steps
 *  turnMode is `setup` and homePlaying is the KICKER. Each step, if its team has Wisdom uses left:
 *   - offer: receiver step flips homePlaying to the receiver first; game.setDialogParameter(offer) (no showDialog).
 *     So while the server waits, the OFFERED team is ALWAYS the playing side.
 *   - decline (inducementType null): receiver step flips homePlaying back to the kicker; NEXT_STEP; NO hideDialog.
 *   - accept, players on the pitch: showDialog(playerChoice) replaces the offer; CLIENT_PLAYER_CHOICE sets turnMode
 *     dwarfenWisdom; End Turn -> leave(): turnMode kickoff, homePlaying back (receiver step), hideDialog.
 *   - accept, NO players on the pitch (:245-247): leave() at once - turnMode setup -> kickoff (lastTurnMode setup),
 *     hideDialog. The receiver step can then raise its offer while turnMode is already kickoff.
 *  After the steps, the dialog left by a decline survives SWARMING/MASTER_CHEF unless swarming replaces it
 *  (showDialog); StepKickoff sets turnMode kickoff (if not already) and hides the dialog only when the kick arrives.
 *
 *  | ordering                                      | turnMode | lastTurnMode  | offered = playing | server waits on it |
 *  |-----------------------------------------------|----------|---------------|-------------------|--------------------|
 *  | kicker offered                                | setup    | any           | yes               | yes  (live)        |
 *  | receiver offered (kicker declined / none)     | setup    | any           | yes               | yes  (live)        |
 *  | kicker accepted -> receiver offered           | kickoff  | dwarfenWisdom | yes               | yes  (live)        |
 *  | kicker accepted, empty pitch -> receiver offd | kickoff  | setup         | yes               | yes  (live)   [A]  |
 *  | receiver declined (g1104; any kicker path)    | kickoff  | setup/dW      | NO                | no   (stale)       |
 *  | kicker declined, receiver has no Wisdom       | kickoff  | setup         | yes               | no   (stale)  [A]  |
 *  | receiver/kicker accepted                      | (dialog becomes playerChoice / hidden: not this rule) |
 *  | any offer after the kick / later modes        | other    | -             | -                 | no   (stale)       |
 *
 *  Field rule: setup / dwarfenWisdom -> live; kickoff and offered team not playing -> stale (exact); kickoff, offered
 *  playing, lastTurnMode dwarfenWisdom -> live (exact: a declining kicker never enters dwarfenWisdom); kickoff, offered
 *  playing, lastTurnMode other than setup/dwarfenWisdom -> stale; any other turn mode -> stale.
 *  [A] AMBIGUOUS by fields alone: kickoff + lastTurnMode setup + offered playing. Frame history settles it: the stale
 *  one was OPENED by a frame (its gameSetDialogParameter) that ended in setup and the turn mode moved on under it; the
 *  live one is opened by a frame that already ended in kickoff (leave() precedes the receiver step). applyFrame calls
 *  noteDwarfenWisdomOfferFrame at every frame end; only the frame that SET the dialog is evidence - an offer first
 *  seen any other way (a reconnect snapshot, a frame that did not set it) is recorded `unknown`, for good.
 *  Without evidence the row SPLITS (Sol r2, latches fail open): it blocks nothing (kick, /stuck, End Turn go out) but
 *  the offer card stays up for the offered team. Both readings recover:
 *   - stale (offered = the kicker): the kicker kicks; a leftover answer reaches StepKickoff, which handles only
 *     CLIENT_KICKOFF - CLIENT_USE_INDUCEMENT is unhandled and StepExecutor drops it (no queue, no state change).
 *   - live (offered = the receiver, the playing side): the receiver answers the card and the server continues. The
 *     receiver also holds the kick surface (the playing side kicks); a CLIENT_KICKOFF it sends here reaches
 *     StepDwarfenWisdom, which does not handle it (dropped the same way), and End Turn fails its validator
 *     (expects turnMode dwarfenWisdom). The kicker is not the playing side, so it gets no kick surface. */
export const DWARFEN_WISDOM_OFFER_LIVE_MODES: ReadonlySet<string> = new Set(['setup', 'dwarfenWisdom']);
const DWARFEN_WISDOM_INDUCEMENT = 'dwarfenWisdom';
const UNKNOWN_OPENING = 'unknown';

type StaleDialogGame = {
  dialogParameter?: unknown;
  turnMode?: unknown;
  lastTurnMode?: unknown;
  homePlaying?: unknown;
  teamHome?: { teamId?: unknown } | null;
  teamAway?: { teamId?: unknown } | null;
};

/** A `useInducement` offer whose every offered type is Dwarfen Wisdom (the RESETUP_D3_PLAYERS inducement). */
export function dwarfenWisdomOnlyOffer(dialog: unknown): boolean {
  const d = dialog as { dialogId?: unknown; inducementTypeArray?: unknown } | null | undefined;
  if (d?.dialogId !== 'useInducement' || !Array.isArray(d.inducementTypeArray)) return false;
  const types = d.inducementTypeArray as unknown[];
  return types.length > 0 && types.every((type) => String(type) === DWARFEN_WISDOM_INDUCEMENT);
}

/** Per Wisdom offer object: the turn mode at the end of the frame that SET it, or `unknown`. */
let wisdomOfferOpenedIn = new WeakMap<object, string>();
/** Called once per applied server frame, after its model changes. `frameSetDialog`: this frame carried a
 *  gameSetDialogParameter change (the only evidence of where an offer opened). */
export function noteDwarfenWisdomOfferFrame(game: unknown, frameSetDialog: boolean): void {
  const g = game as StaleDialogGame | null | undefined;
  const dialog = g?.dialogParameter;
  if (!dialog || typeof dialog !== 'object' || !dwarfenWisdomOnlyOffer(dialog) || wisdomOfferOpenedIn.has(dialog)) return;
  wisdomOfferOpenedIn.set(dialog, frameSetDialog ? String(g?.turnMode ?? '') || UNKNOWN_OPENING : UNKNOWN_OPENING);
}
/** @internal tests: forget recorded openings. */
export function resetDwarfenWisdomOfferHistory(): void { wisdomOfferOpenedIn = new WeakMap(); }

export type DwarfenWisdomOfferPhase = 'live' | 'stale' | 'ambiguous';
/** null = not a Wisdom-only offer (or nothing proven: no model / turn mode / playing side) - not judged here. */
export function dwarfenWisdomOfferPhase(turnMode: unknown, game: unknown, dialog: unknown): DwarfenWisdomOfferPhase | null {
  if (!game || typeof game !== 'object' || !dwarfenWisdomOnlyOffer(dialog)) return null;
  if (typeof turnMode !== 'string' || turnMode.length === 0) return null;
  if (DWARFEN_WISDOM_OFFER_LIVE_MODES.has(turnMode)) return 'live';
  if (turnMode !== 'kickoff') return 'stale';
  const g = game as StaleDialogGame;
  const playing = g.homePlaying === true ? g.teamHome : g.homePlaying === false ? g.teamAway : undefined;
  if (playing === undefined) return null;
  const offeredTeamId = String((dialog as { teamId?: unknown }).teamId ?? '');
  if (!offeredTeamId || String(playing?.teamId ?? '') !== offeredTeamId) return 'stale';
  const last = g.lastTurnMode == null ? '' : String(g.lastTurnMode);
  if (last === 'dwarfenWisdom') return 'live';
  if (last !== 'setup' && last !== '') return 'stale';
  // [A]: opened in setup and outlived it -> stale; opened in kickoff -> live; no evidence (or no lastTurnMode) -> split.
  const opened = last === 'setup' ? wisdomOfferOpenedIn.get(dialog as object) : undefined;
  if (opened === 'setup') return 'stale';
  if (opened !== undefined && opened !== UNKNOWN_OPENING) return 'live';
  return 'ambiguous';
}

/** The offer card question: a Wisdom offer whose card must go. An ambiguous offer keeps its card (see [A]). */
export function dwarfenWisdomOfferCardRetired(game: unknown): boolean {
  const g = game as StaleDialogGame | null | undefined;
  return dwarfenWisdomOfferPhase(g?.turnMode, g, g?.dialogParameter) === 'stale';
}

function dwarfenWisdomOfferOutlivedPhase(turnMode: unknown, game: unknown, dialog: unknown): boolean {
  const phase = dwarfenWisdomOfferPhase(turnMode, game, dialog);
  return phase === 'stale' || phase === 'ambiguous'; // [A]: an ambiguous offer blocks nothing
}

/** `game` (the applied model) lets a dialog judged by its content be proven stale; `dialog` defaults to its
 *  dialogParameter. Without `game` only the dialogId-level rules apply. */
export function staleDialogOutlivedPhase(dialogId: string, turnMode: unknown, game?: unknown, dialog?: unknown): boolean {
  if ((dialogId === 'setupError' || dialogId === 'swarmingError')
      && !SETUP_NOTICE_LIVE_MODES.has(String(turnMode ?? ''))) return true;
  if (dialogId === 'selectBlitzTarget') {
    return typeof turnMode === 'string' && turnMode.length > 0 && turnMode !== 'selectBlitzTarget';
  }
  if (dialogId === 'useInducement') {
    const d = dialog !== undefined ? dialog : (game as StaleDialogGame | null | undefined)?.dialogParameter;
    return dwarfenWisdomOfferOutlivedPhase(turnMode, game, d);
  }
  return false; // not proven stale; does NOT assert liveness
}
