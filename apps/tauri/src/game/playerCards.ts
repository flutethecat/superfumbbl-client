/**
 * Owner 2026-10-10: "let's add Middle Mouse Button as a default button for enabling/disabling player portraits."
 *
 * Restated the same day: "The middle mouse button for player portrait should disable player portraits" /
 * "Until clicked again".
 *
 * Read as the PLAYER CARD - the docked card with the player's portrait, name, stats and skills that a click on a player
 * opens (SpectateView `popup`). User-facing wording is "Player portraits". A middle mouse button click on the pitch
 * flips the persisted setting `playerCardMode` between
 *  - 'auto'   = cards on: a click on a player opens their card (how the client always behaved), and
 *  - 'called' = cards off: pitch clicks open no card; an open card closes; the explicit opens still work (a roster
 *    row).
 * Owner 11-07 (Train's report: "The Player Portraits setting keeps turning itself off seemingly at random"): the middle
 * click no longer writes the saved setting. A flip is TEMPORARY, kept until the app closes (it survives leaving a game
 * for a spectate); Settings > UI "Player portraits" is the saved choice and overrides it - changing it there drops the
 * flip, and so does a saved value that no longer matches the one the flip was taken from.
 *
 * Shipped first as the 1.0.168 hotfix (fixed middle button); with the controls registry the bound actions come from
 * the binding table (Settings > Controls: "Player portraits on / off", default Middle mouse, rebindable) and the
 * action runs through the in-game action runner. The hotfix's ownership rule below is kept whole.
 */
import { reactive, watch } from 'vue';
import type { ControlActionId } from './controls';
import { isAssignTouchdownPickKey, isMvpPickKey } from './endGamePick';

export type PlayerCardMode = 'auto' | 'called';
/** Catalogue keys of the notice (owner 11-07: shown in the player's language, logged in English through lt()). */
export const PLAYER_CARDS_ON_NOTICE = 'hud.playerCards.on';
export const PLAYER_CARDS_OFF_NOTICE = 'hud.playerCards.off';
/** Owner 11-07: a flip away from the saved choice says it is temporary. */
export const PLAYER_CARDS_ON_SESSION_NOTICE = 'hud.playerCards.onSession';
export const PLAYER_CARDS_OFF_SESSION_NOTICE = 'hud.playerCards.offSession';

/** Owner 11-07: the temporary flip, app-wide (module state: it outlives a view, never reaches the settings file).
 *  `base` = the saved mode when the flip was taken; a different saved mode means Settings changed and wins. */
export const playerCardOverride = reactive<{ mode: PlayerCardMode | null; base: PlayerCardMode | null }>({ mode: null, base: null });

/** The mode in force: the temporary flip while it still belongs to the saved choice, else the saved setting. */
export function effectivePlayerCardMode(saved: PlayerCardMode): PlayerCardMode {
  return playerCardOverride.mode !== null && playerCardOverride.base === saved ? playerCardOverride.mode : saved;
}

/** The saved choice changed (App.vue watches it, whatever wrote it) or Settings' "Use saved setting": the saved
 *  choice overrides any temporary flip. */
export function clearPlayerCardOverride(): void {
  playerCardOverride.mode = null;
  playerCardOverride.base = null;
}

/** Owner 11-07: drop the temporary flip on EVERY change of the saved choice. Synchronous (Sol r2 P3): a batched watch
 *  saw no change when the saved value went auto -> called -> auto in one tick, and the stale flip came back. The
 *  toggle never writes the saved value, so the toggle itself never triggers this. Returns the stop handle. */
export function clearPlayerCardOverrideOnSavedChange(saved: () => PlayerCardMode): () => void {
  return watch(saved, () => clearPlayerCardOverride(), { flush: 'sync' });
}

export interface PlayerCardToggleDeps {
  settings: { playerCardMode: PlayerCardMode };
  /** Close the card that is open (cards were just turned off). */
  closeCard(): void;
  /** The small notice; `key` is one of the PLAYER_CARDS_*_NOTICE catalogue keys. */
  notice(key: string): void;
}
/** Flip the mode in force for this session (the saved setting is never written); returns the new one. Flipping back
 *  to the saved choice ends the temporary flip. */
export function togglePlayerCardMode(deps: PlayerCardToggleDeps): PlayerCardMode {
  const saved = deps.settings.playerCardMode;
  const next: PlayerCardMode = effectivePlayerCardMode(saved) === 'called' ? 'auto' : 'called';
  if (next === saved) clearPlayerCardOverride();
  else { playerCardOverride.mode = next; playerCardOverride.base = saved; }
  if (next === 'called') deps.closeCard();
  const temporary = next !== saved;
  deps.notice(next === 'auto'
    ? (temporary ? PLAYER_CARDS_ON_SESSION_NOTICE : PLAYER_CARDS_ON_NOTICE)
    : (temporary ? PLAYER_CARDS_OFF_SESSION_NOTICE : PLAYER_CARDS_OFF_NOTICE));
  return next;
}

/** What the middle button can carry: any registry action bound to it (Settings > Controls). */
export type PlayerCardAction = ControlActionId;

export interface MiddleClickInput {
  /** The actions bound to the middle mouse button in this context (Settings > Controls). */
  bound: readonly PlayerCardAction[];
  /** Something else owns input: Settings / the wizard, the Game Menu or a context menu, a card or confirmation, a
   *  text field in focus. */
  blocked: boolean;
}
export interface MiddleClickDecision {
  /** The click is the binding's: the pitch must not also treat it as a left click. */
  consume: boolean;
  /** The actions to offer, in order, until one handles it. */
  run: readonly PlayerCardAction[];
}
/**
 * A middle-button CLICK on the pitch (press and release without a drag; a drag pans the camera as before).
 * Unbound → not consumed: the click keeps what it did before the binding existed (the pitch treats it as a left
 * click). Bound → always consumed (never a left click as well), and the action runs unless something else owns input.
 */
export function middleClickDecision(input: MiddleClickInput): MiddleClickDecision {
  if (!input.bound.length) return { consume: false, run: [] };
  return { consume: true, run: input.blocked ? [] : input.bound };
}

// --- who owns input (hotfix-local; the controller branch derives this from its crosshair gate) --------------------

const NON_TEXT_INPUT_TYPES = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image']);
/** The focused element takes typed text (an input that is not a check box / button, a textarea, a select, an
 *  editable region): the middle click leaves the mode alone. Duck-typed so it is testable without a DOM. */
export function textFieldOwnsInput(focused: unknown): boolean {
  const el = focused as { tagName?: unknown; type?: unknown; isContentEditable?: unknown } | null | undefined;
  if (!el || typeof el.tagName !== 'string') return false;
  const tag = el.tagName.toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') return !NON_TEXT_INPUT_TYPES.has(String(el.type ?? 'text').toLowerCase());
  return el.isContentEditable === true;
}

/**
 * Owner 2026-10-13: "Bug reports should swallow all keyboard entry. Currently if the confirm dialog is up, it sends the
 * command through." Who owns a keydown before the in-game hotkeys (confirm, Enter = chat, Digit1-6 hotbar, pan, Esc
 * cascade) may see it:
 *  - the Report modal open: it owns EVERY key; Escape closes it (unless a send is in flight) and nothing else runs;
 *  - a focused text control (textarea, text input, select, contenteditable): it owns every key but Escape, so a Space
 *    typed in a note never confirms the open card, Enter never opens chat, a digit never picks a hotbar action.
 *    Escape keeps its existing behaviour from a text field (the caller's own branches decide);
 *  - otherwise the key passes to the game handler (a focused prompt BUTTON keeps its native activation there).
 */
export type GameKeyOwner = 'closeReport' | 'reportOwns' | 'textOwns' | 'pass';
export interface GameKeyInput {
  reportOpen: boolean;
  /** A report send is in flight: Escape must not close it. */
  reportBusy: boolean;
  /** textFieldOwnsInput / keyboardOwnedByTextControl on the event target. */
  textFieldFocused: boolean;
  key: string;
}
export function gameKeyDecision(i: GameKeyInput): GameKeyOwner {
  if (i.reportOpen) return i.key === 'Escape' && !i.reportBusy ? 'closeReport' : 'reportOwns';
  if (i.textFieldFocused && i.key !== 'Escape') return 'textOwns';
  return 'pass';
}
/**
 * Astra review of the report fix: a key the open report owns whose target sits OUTSIDE the modal (focus on body, or a
 * HUD button tabbed to) must not activate that control natively. Enter / Space are cancelled (no native End Turn
 * click); Tab is cancelled and focus pulled back into the report.
 */
export function reportOutsideKey(key: string): { preventDefault: boolean; pullFocus: boolean } {
  if (key === 'Tab') return { preventDefault: true, pullFocus: true };
  return { preventDefault: key === 'Enter' || key === ' ' || key === 'Spacebar', pullFocus: false };
}

type Maybe<T> = T | null | undefined;
/** The store slice read for "a decision card is up" (shapes as in game/store.ts state; the same list as the
 *  controller branch's crosshairGateInput `cardOpen`). */
export interface DecisionCardStoreState {
  reRollPrompt?: Maybe<{ mine: boolean }>;
  skillChoice?: Maybe<{ mine: boolean; using?: boolean }>;
  blockPartial?: Maybe<{ mine: boolean }>;
  multiBlockResolution?: Maybe<{ rolls: { isOwnChoice: boolean | null }[] }>;
  followupChoice?: Maybe<object>;
  apothecaryChoice?: Maybe<{ mine: boolean }>;
  apothecaryD16?: Maybe<{ mine: boolean }>;
  injuryInteraction?: Maybe<{ mine: boolean }>;
  bloodlust?: Maybe<{ stage: string }>;
  kickSkill?: Maybe<object>;
  yesNo?: Maybe<object>;
  blitzBlockChoice?: Maybe<object>;
  foulChoiceHold?: Maybe<object>;
  coinChoicePrompt?: Maybe<object>;
  receiveChoicePrompt?: Maybe<object>;
  selectSkill?: Maybe<object>;
  selectPosition?: Maybe<object>;
  selectWeather?: Maybe<object>;
  keywordChoice?: Maybe<object>;
  cardChoice?: Maybe<object>;
  cardBuy?: Maybe<object>;
  inducementBuy?: Maybe<object>;
  inducementUse?: Maybe<object>;
  wizardTargetConfirm?: Maybe<object>;
  sendOff?: Maybe<object>;
  playerPick?: Maybe<{ key: string; declinable: boolean }>;
}
/** A decision card owns input: a reroll / skill / block-dice / follow-up / apothecary / yes-no / list / inducement
 *  card, a declinable or pane-only player pick. A PITCH pick (push square, kick aim, touchback receiver) is not a
 *  card: the pitch stays the coach's. */
export function decisionCardOpen(st: DecisionCardStoreState): boolean {
  return !!st.reRollPrompt?.mine || (!!st.skillChoice?.mine && !st.skillChoice.using) || !!st.followupChoice
    || !!st.yesNo || !!st.blitzBlockChoice || !!st.foulChoiceHold
    || (!!st.playerPick && (st.playerPick.declinable || isMvpPickKey(st.playerPick.key) || isAssignTouchdownPickKey(st.playerPick.key)))
    || (!!st.bloodlust && st.bloodlust.stage !== 'bite')
    || !!st.blockPartial?.mine || !!st.multiBlockResolution?.rolls.some((r) => r.isOwnChoice === true)
    || !!st.selectSkill || !!st.selectPosition || !!st.selectWeather || !!st.keywordChoice
    || !!st.coinChoicePrompt || !!st.receiveChoicePrompt
    || !!st.apothecaryChoice?.mine || !!st.apothecaryD16?.mine || !!st.injuryInteraction?.mine
    || !!st.kickSkill || !!st.cardChoice || !!st.cardBuy || !!st.inducementBuy || !!st.inducementUse
    || !!st.wizardTargetConfirm || !!st.sendOff;
}

export interface PlayerCardsInputOwnership {
  /** Settings or the setup wizard is open. */
  shellModalOpen: boolean;
  gameMenuOpen: boolean;
  contextMenuOpen: boolean;
  /** Another modal of the game view (the bug-report form, the unanswered-prompt panel). */
  modalOpen: boolean;
  /** An End Activation / End Turn confirmation, or a rail activation prompt. */
  confirmationOpen: boolean;
  /** decisionCardOpen(store state). */
  decisionCardOpen: boolean;
  /** textFieldOwnsInput(document.activeElement). */
  textFieldFocused: boolean;
}
/** True = the middle click is swallowed (never a left click) but the mode does not flip. */
export function playerCardsToggleBlocked(o: PlayerCardsInputOwnership): boolean {
  return o.shellModalOpen || o.gameMenuOpen || o.contextMenuOpen || o.modalOpen || o.confirmationOpen
    || o.decisionCardOpen || o.textFieldFocused;
}
