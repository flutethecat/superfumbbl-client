// Owner 09-28 (S7 v3): the opponent's failed-roll die is held only while the reroll OFFER that justified it is still
// open. `opponentRerollPending` is computed in the store when the roll is staged (same sync as the dialog). A die whose
// show is DEFERRED — a camera pan, or the re-roll beat's scheduleGameTimeout — can reach the pitch after that offer has
// closed; re-validating against the CURRENT dialog at show time drops the stale hold so the die is not pinned on the
// opponent's client (the reported g987 bug). This can only ever CONFIRM or DROP the staged flag, never create one.

/** Normalize a server dialogId the way the renderer / store do (lowercase, strip non-alphanumerics). */
export function normalizeDialogId(dialogId: unknown): string {
  return String(dialogId ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Is the currently open server dialog a reroll offer? */
export function isRerollDialogId(dialogId: unknown): boolean {
  return normalizeDialogId(dialogId).includes('reroll');
}

/** The opponent-reroll hold to apply to a die at SHOW time: the staged flag, re-validated against the live dialog. */
export function opponentRerollHoldAtShow(staged: boolean | undefined, currentDialogId: unknown): boolean {
  return !!staged && isRerollDialogId(currentDialogId);
}
