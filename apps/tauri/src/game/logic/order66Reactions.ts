// ORDER 66 — Phase A.3+ : the REACTIVE-DIALOG re-home (surface ④ — consequence answers).
//
// The port of the block-resolution consequence surfaces — die-pick (blockPartial) / pushback / follow-up /
// reroll — off resolvePlayFollowups' ad-hoc dialogId checks and onto the STATE MACHINE's authority. Pure +
// side-effect-free: it reads the server-synced model + the wire authority fields and returns WHICH consequence
// surface the local coach is authorized to answer this frame. The flag-gated store dispatch arms the EXISTING
// surface state (blockPartial / pushChoice / followupChoice / reRollPrompt — frozen shapes, untouched)
// accordingly, so this relocates the DECISION of when to surface, never the shape.
//
// ⚖ server-derived law: authority is the server's — the wire's `choosingTeamId`, the model's `homeChoice`
// (via deriveClientState → PUSHBACK), the acting player — read at RECEIVE time, never recomputed, never
// predicted. Echo's rig invariants assert these outputs (2/2a/2b die-pick authority; #4 pushback authority +
// the skillUse→pushback precedence for Side Step).

import type { GameJson } from '@fumbbl40k/ffb-protocol';
import { deriveClientState, type ClientStateContext } from './clientStateMachine';

/** The consequence surface the local coach may answer this frame (or 'none').
 *  `blockView` is the ONLY non-interactive member — a READ-ONLY display of the block dice for the NON-chooser
 *  (owner batch #5); it emits nothing, so invariant 2a's authority half (non-chooser sends no clientBlockChoice)
 *  is preserved. Every other member authorizes a wire answer. */
export type ReactionSurface = 'diePick' | 'blockView' | 'pushback' | 'followup' | 'reroll' | 'none';

interface DialogLike { dialogId?: string; choosingTeamId?: string; playerId?: string; reRolledAction?: string }

const BLOCK_DICE_DIALOGS = new Set(['blockRoll', 'blockRollProperties', 'blockRollPartialReRoll']);
const REROLL_DIALOGS = new Set(['reRoll', 'reRollProperties']);

function dialog(game: GameJson): DialogLike {
  return ((game as { dialogParameter?: unknown }).dialogParameter ?? {}) as DialogLike;
}

/**
 * A `skillUse` yes/no dialog is pending → it takes PRECEDENCE over the PUSHBACK pick (Echo invariant #4 /
 * Tarkin's Side Step chain). The defender answers "Use Sidestep? [Yes/No]" FIRST, and only on YES does the
 * server recompute `pushbackSquareArray` with `homeChoice=defender` → the defender's PUSHBACK derives. Suppress
 * the push surface until the skillUse is answered so the two surfaces don't race. (dialogParameter is singular
 * on the wire, so a live skillUse already excludes a block-dice/reroll dialog — this guard specifically covers
 * the case where a stale/co-derived pushbackSquareArray would otherwise leak PUSHBACK under the open dialog.)
 */
export function skillDialogPending(game: GameJson | null | undefined): boolean {
  return !!game && String(dialog(game).dialogId ?? '') === 'skillUse';
}

/** True iff the given wire block-dice `reRolledAction` marks a BLOODLUST reroll — those route to the unified
 *  bloodlust card in the store, NOT the generic reroll prompt, so the caller peels them off before asking here. */
export function isBloodlustReroll(game: GameJson | null | undefined): boolean {
  const action = String(dialog(game as GameJson).reRolledAction ?? '');
  return /blood ?lust/i.test(action);
}

/**
 * Which consequence surface the LOCAL coach is authorized to answer this frame, or 'none'. Ordered by the
 * block-resolution sequence + the wire authority:
 *   - `diePick`  — the wire's `choosingTeamId` is my true team (invariant 2, authority is the wire's and never
 *                  recomputed; the non-choosing side emits ZERO clientBlockChoice → we simply never surface it,
 *                  invariant 2a; the store's resolve bounds the diceIndex, invariant 2b).
 *   - `reroll`   — a live `reRoll`/`reRollProperties` dialog offered for my player. The singular wire dialog takes
 *                  precedence over stale pushback geometry. Bloodlust-flavored rerolls route to the store card.
 *   - `pushback` — deriveClientState === 'PUSHBACK'. The state machine already encodes the true-home + homeChoice
 *                  authority, so this fires for the ATTACKER's normal push AND the DEFENDER's Side Step / chain
 *                  push — the latter the legacy `if (!actingIsMine) return` silently dropped. Suppressed while a
 *                  skillUse dialog is pending (precedence above).
 *   - `followup` — a `followupChoice` dialog whose acting player is mine (follow / stay after a knockdown push).
 *
 * `isMyTeamId` / `isMinePlayer` are supplied by the store (true-identity, coach-matched) so this module stays
 * free of store state; `ctx` carries the local coach's true side for deriveClientState.
 */
export function deriveReaction(
  game: GameJson | null | undefined,
  ctx: ClientStateContext,
  isMyTeamId: (teamId: string | undefined) => boolean,
  isMinePlayer: (playerId: string) => boolean,
): ReactionSurface {
  if (!game) return 'none';
  const dp = dialog(game);
  const dlg = String(dp.dialogId ?? '');

  // 1) die-pick — the block-dice dialog addressed to MY choosing team (wire authority).
  if (BLOCK_DICE_DIALOGS.has(dlg) && isMyTeamId(dp.choosingTeamId)) return 'diePick';

  // 1b) block-view — the SAME block-dice dialog when I am the NON-chooser (owner batch #5): render the dice
  //     READ-ONLY so the defender SEES the block outcome. The dp is already synced to BOTH clients
  //     (UtilServerDialog.showDialog sets it on the model; the away-transform copies it verbatim), so this is a
  //     pure render of what the server sent — the omission-leak fix, not a prediction. It authorizes ZERO wire
  //     (the store arms blockPartial with pickable:false + no reroll sources), so invariant 2a's authority half
  //     (non-chooser emits no clientBlockChoice) is preserved. Covers both phases of an uphill block: whoever
  //     the wire does NOT name as choosingTeam this frame gets the read-only view.
  if (BLOCK_DICE_DIALOGS.has(dlg)) return 'blockView';

  // 2) reroll — the singular live dialog outranks any stale pushback squares left in the field model.
  if (REROLL_DIALOGS.has(dlg) && dp.playerId && isMinePlayer(String(dp.playerId))) return 'reroll';

  // 3) pushback — the state machine says it's my direction pick (attacker push OR Side Step defender),
  //    unless a skillUse dialog is still pending (its yes/no comes first).
  if (deriveClientState(game, ctx) === 'PUSHBACK' && !skillDialogPending(game)) return 'pushback';

  // 4) follow / stay — my acting player's post-push follow-up.
  if (dlg === 'followupChoice') {
    const acting = String((game.actingPlayer as { playerId?: string } | undefined)?.playerId ?? '');
    if (acting && isMinePlayer(acting)) return 'followup';
  }

  return 'none';
}
