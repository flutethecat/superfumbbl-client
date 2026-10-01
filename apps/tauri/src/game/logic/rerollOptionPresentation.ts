// Owner 09-28 (UAT #8 / Spec S8): Lord Borak's Lord of Chaos re-roll was offered and USED without the coach
// ever seeing its name — the block-dice option rendered icon-only in icon mode (the name existed only as a
// hover `title`), and the armed hint printed the internal `kind` token (`singleBlockDie`) instead of the rule.
// Pure presentation helpers so the .vue only calls + renders; no wire shape changes.

/** The shape every partial re-roll option array already carries (`blockPartialOptions`, per-row multi-block
 *  buttons): enough to look a label up by its internal `kind` for a hint that only holds that token. */
export interface RerollOptionLike {
  kind: string;
  label: string;
}

/** The armed die-reroll hint must NAME the rule (`Lord of Chaos - click a die to re-roll it`), never the
 *  internal kind token it used to interpolate. `action` covers the single-die and multi-die-select wordings
 *  (Owner 09-28: the multiBlockDice hint names its source too, e.g. `Savage Blow - select one or more dice to
 *  re-roll`). Returns null when there is nothing armed to name. */
export function armedRerollHintText(label: string | null | undefined, action = 'click a die to reroll it'): string | null {
  const name = label?.trim();
  return name ? `${name} - ${action}` : null;
}

/** Look up an armed option's display label from its `kind` (the die-select mode only remembers the kind). */
export function rerollOptionLabelForKind(kind: string | null | undefined, options: readonly RerollOptionLike[]): string | null {
  if (!kind) return null;
  return options.find((opt) => opt.kind === kind)?.label ?? null;
}
