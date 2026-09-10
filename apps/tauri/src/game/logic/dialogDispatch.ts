// #190 increment 2 — the dialog-dispatch logic seam (Meero SR-199 FOCUSED-BUILD-GO, DK-1).
//
// A PURE, side-effect-free module (mirrors deriveReaction/deriveClientState) so Echo's ffb-protocol golden rig
// can import it and assert the REACHED-per-pair matrix + the key-stability teeth (Frenzy double-followup,
// update-not-replace) without reaching into store.ts. store.ts keeps the IMPURE execution (surface arm-fns +
// sendCommand answer senders) and consumes this derivation — the same split as deriveReaction→resolvePlayFollowups.
//
// THE ONE SHARED dialog-instance identity (RG-5): #190 D-1 (dispatch update-vs-replace), spec-199 R-A2/R-A5
// (answered-instance suppression), and R-E1 (send-side stale-answer guard) ALL key off `dialogInstanceKey`.
//
// ⚠ WHY A DISCRIMINATOR INCLUDE-LIST, NOT BLIND PAYLOAD-EQUALITY (Meero SR-199, the correction my #207-adjacent
// measurement forced): `dialogParameter` is an untyped bag `{dialogId; [k]:unknown}` whose CONTENT the server
// UPDATES within one live instance — block dice / multi-block `selectedIndex` / the growing penalty-shootout
// rolls. A content-inclusive key changes every sync ⇒ close-old/open-new CHURN (the mirror worse than the gate,
// DM-1 "too-fine"). So the identity is dialogId + addressee + the per-type STABLE discriminators ONLY; mutable
// content is excluded by construction. This generalizes store.ts's proven `DlgSig` (BT-1b) send-guard.
//
// DM-1 (captured-at-transition): a WITHDRAWN then RE-SHOWN identical dialog (same discriminators across a null
// frame) is a NEW instance — disambiguated by `ctx.transitionNr`, the commandNr captured at the null→dialog
// transition (NEVER the running lastAppliedCommandNr, which would churn every apply).
//
// DK-1 (binding, Meero SR-199): a step that can replace a same-type-same-discriminator dialog within ONE applied
// frame needs a BESPOKE disambiguator (no null gap ⇒ transitionNr can't split them). The enumerated cases ride
// `ctx`: the BLOCK family (two blocks, identical dice) needs `ctx.blockEpoch` — REQUIRED, fail-loud, never
// defaulted (a defaulted epoch collapses two blocks into one identity, Q3). The FRENZY double-followup (one
// attacker, two legit `followupChoice` in one activation) is the same class and takes `ctx.followupEpoch` when
// followupChoice joins the registry (stage 3); enumerated against the dead-pair matrix, proven by Echo's teeth.

import type { GameJson } from '@fumbbl40k/ffb-protocol';

export type DialogKeyCtx = {
  /** BLOCK family ONLY (Q3, DK-1): the per-block epoch (store.ts `blockChoiceEpoch`). REQUIRED for block/multi-
   *  block dialogs so two blocks with identical dice don't collapse to one identity — fail loud if absent. */
  blockEpoch?: number;
  /** FRENZY double-followup (DK-1): the per-followup epoch, so a Frenzy attacker's second same-square followup in
   *  one activation is a distinct instance. Supplied when followupChoice joins the registry. */
  followupEpoch?: number;
  /** DM-1: the commandNr captured at the null→dialog transition; disambiguates a withdraw→reshow of an identical
   *  payload. NEVER the running lastAppliedCommandNr. */
  transitionNr?: number;
};

const BLOCK_FAMILY = new Set([
  'blockRoll', 'blockRollProperties', 'blockRollPartialReRoll', 'reRollBlockForTargetsProperties',
]);

/** The stable per-`dialogId` discriminator (identity, NOT mutable content). '' when the addressee alone
 *  identifies the instance. Throws for the block family without `ctx.blockEpoch` (Q3 fail-loud). */
function discriminatorFor(id: string, dp: Record<string, unknown>, ctx: DialogKeyCtx): string {
  switch (id) {
    case 'reRoll':
    case 'reRollProperties':
      return `${String(dp.reRolledAction ?? '')}:${String(dp.playerId ?? '')}`;
    case 'skillUse':
      return `${String(dp.playerId ?? '')}:${String(dp.skill ?? '')}`;
    case 'interception':
      return String(dp.throwerId ?? '');
    case 'confirmEndAction':
      return String(dp.playerAction ?? '');
    case 'playerChoice':
      // Different player-choice modes can replace one another without a null dialog gap. The mode is
      // immutable instance identity (the mutable offered playerIds/min/max deliberately are not).
      return String(dp.playerChoiceMode ?? '');
    case 'informationOkay':
      // Q4 (SR-199): identity is the PAIR (notice text + the null-gap transitionNr) — strictly stronger than the
      // old content-only key. The text must be set-once at the emitting steps (verified at the info handlers).
      return `${infoText(dp)}#${ctx.transitionNr ?? ''}`;
    case 'blockRoll':
    case 'blockRollProperties':
    case 'blockRollPartialReRoll':
    case 'reRollBlockForTargetsProperties':
      if (ctx.blockEpoch == null) {
        throw new Error(`dialogInstanceKey: block-family dialog '${id}' requires ctx.blockEpoch (SR-199 Q3 fail-loud)`);
      }
      return `${String(dp.playerId ?? dp.choosingTeamId ?? '')}:e${ctx.blockEpoch}`;
    case 'followupChoice':
      // DK-1 Frenzy: a per-followup epoch splits a same-attacker double-followup in one activation. Absent until
      // followupChoice joins the registry (stage 3) — then REQUIRED like the block epoch.
      return `${String(dp.playerId ?? '')}${ctx.followupEpoch != null ? `:e${ctx.followupEpoch}` : ''}`;
    case 'useApothecary':
      return apothecaryInjuryDiscriminator(dp);
    case 'useApothecaries':
      return Array.isArray(dp.injuryDescriptions)
        ? dp.injuryDescriptions.map((injury) => apothecaryInjuryDiscriminator(injury)).join(';')
        : 'malformed';
    case 'bloodlustAction':
    case 'apothecaryChoice':
      return String(dp.playerId ?? '');
    case 'penaltyShootout':
      return ''; // one shootout per game; its rolls are mutable content (excluded)
    default:
      return ''; // addressee-only: bribes / argueTheCall / pregame (coinChoice/receiveChoice/…)
  }
}

function apothecaryInjuryDiscriminator(value: unknown): string {
  if (!value || typeof value !== 'object') return 'malformed';
  const injury = value as Record<string, unknown>;
  return JSON.stringify({
    playerId: injury.playerId ?? null,
    playerState: injury.playerState ?? null,
    seriousInjury: injury.seriousInjury ?? null,
    apothecaryTypes: injury.apothecaryTypes ?? null,
  });
}

function infoText(dp: Record<string, unknown>): string {
  const title = typeof dp.text === 'string' ? dp.text : '';
  const body = Array.isArray(dp.messageArray) ? (dp.messageArray as unknown[]).map(String).join(' ') : '';
  return `${title}:${body}`.trim();
}

/** Whether `id` is a block-family dialog (requires `ctx.blockEpoch`). Exported for the dispatcher's ctx wiring. */
export function isBlockFamilyDialog(id: string | null | undefined): boolean {
  return !!id && BLOCK_FAMILY.has(id);
}

/** The ONE shared dialog-instance key (RG-5). `null` when no dialog is up. Stable across syncs while the SAME
 *  dialog persists (⇒ update-vs-replace: same key = update, different key = replace). See the module header for
 *  the include-list / captured-at-transition rationale. */
export function dialogInstanceKey(g: GameJson | null | undefined, ctx: DialogKeyCtx = {}): string | null {
  const dp = (g?.dialogParameter ?? null) as Record<string, unknown> | null;
  if (!dp || !dp.dialogId) return null;
  const id = String(dp.dialogId);
  const addressee = String(dp.teamId ?? dp.playerId ?? '');
  return `${id}|${addressee}|${discriminatorFor(id, dp, ctx)}`;
}
