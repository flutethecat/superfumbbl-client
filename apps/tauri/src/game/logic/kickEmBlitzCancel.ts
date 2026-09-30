// Owner 09-28 (Spec S3 v2 #3): the Kick 'em Blitz right-click/Esc CANCEL precedence, as a pure function so the
// view and the Esc cascade share one decision instead of two hand-written copies. Sol's re-review found two
// bugs in the first cut: (a) `clearKickEmBlitzNomination()` was wired into `clearO66Arms()`, so cancelling a
// merely PLOTTED ROUTE also dropped the nomination; (b) the Kick 'em candidate picker is `state.playerPick`,
// which `interactiveDecisionSurfaceOpen()` (`plannerPromptPending`) already treats as a blocking decision
// surface — so once a nomination was cancelled and the picker re-armed, EVERY later right-click returned early
// before ever reaching the cancel/pass-through decision, and the coach could no longer reach the context menu
// or End Activation by right-click at all.
//
// Required precedence for a right-click/Esc by the acting coach while in KICK_EM_BLITZ:
//   1. a plotted route exists      -> clear the ROUTE only (nomination and its badge stay)
//   2. else a nomination exists    -> cancel the nomination (no wire); the picker re-arms
//   3. else (picker armed, nothing nominated) -> PASS THROUGH to the ordinary handling (context menu / End
//      Activation), exactly as an ordinary Blitz with no target yet.
// While the Kick 'em Yes/No confirmation card is open, this function defers entirely (passThrough) — the
// card owns the gesture; its own existing behaviour is untouched by this feature.

export type KickEmCancelAction = 'clearRoute' | 'cancelNomination' | 'passThrough';

export interface KickEmCancelInput {
  hasRoute: boolean;
  hasNomination: boolean;
  pickerArmed: boolean;
  confirmationCardOpen: boolean;
  /** Only KICK_EM_BLITZ has this precedence; any other client state always passes through untouched. */
  clientState: string | null;
}

export function kickEmCancelDecision(input: KickEmCancelInput): KickEmCancelAction {
  if (input.clientState !== 'KICK_EM_BLITZ') return 'passThrough';
  if (input.confirmationCardOpen) return 'passThrough'; // the Yes/No card owns the gesture — untouched
  if (input.hasRoute) return 'clearRoute';
  if (input.hasNomination) return 'cancelNomination';
  return 'passThrough'; // picker armed (or not even that), nothing nominated — ordinary handling applies
}
