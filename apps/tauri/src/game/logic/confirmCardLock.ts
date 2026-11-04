/**
 * OWNER RULING (Jay, 10-15), verbatim: "No other actions can be planned while any confirm modal is up. These should be
 * swallowing clicks and force an interaction."
 *
 * The one predicate behind that rule: "a confirmation card this coach must answer is open". SpectateView feeds it the
 * visibility of every covered card (the same conditions its template mounts them on, so the lock opens and closes with
 * the card itself: a card a server frame, a game switch, a reconnect or the turn end removes releases the lock in the
 * same tick). The pitch renderer's click bodies, the in-game action runner (keyboard and controller), the hotbar keys
 * and the planning buttons consult it; nothing else keeps its own copy.
 *
 * Owner refinement (10-15): "On the modal swallow, users should still be able to click players and see portrait info,
 * etc. It should only be swallowing the planner clicks." A tap on a player under an open card shows the player card
 * only (the renderer's onInspectPlayer: no selection, no activation or switch, no plan); hover keeps working.
 *
 * Pure: no Vue, no DOM, so tests drive the real rules.
 */
import type { ControlActionId } from '../controls';

/** The covered cards. Each is a yes / no (or confirm / cancel) question the coach answers on its own buttons. */
export const CONFIRM_CARD_KINDS = [
  'endTurnWarn', // "End Turn?" (client confirmation)
  'endActivation', // "End Activation?" and the end-of-action confirmations (End Blitz, Cancel Foul, ...)
  'yesNo', // the generic yes / no card: server confirmEndAction, Kick 'em, gaze-to-move, Maximum Carnage, ...
  'wideRailSpecial', // "Special Ability" election before an action continues
  'blitzToMove', // "Keep Blitz?" (convert a declared Blitz to a Move)
  'blockAttack', // the Block / Blitz attack confirmation (special attack preview)
  'chainsawBlitz', // "Chainsaw Attack?"
  'actionTarget', // "Perform foul?" / hand-off / pass target confirmation
  'wizardZap', // "Cast Zap?"
  'shadowing', // "Shadow the runner?"
  'tentacles', // "Use Tentacles?"
  'apothecary', // the coach's own Apothecary election
  'apothecaryResult', // the coach's own apothecary injury result choice
  'sendOff', // "Spotted by the Ref!" (argue / bribe / accept)
  'bloodlustDecision', // Bloodlust "Change to move / Move first" or "Feed & perform" (the decision beat only)
] as const;
export type ConfirmCardKind = (typeof CONFIRM_CARD_KINDS)[number];

export interface ConfirmCardLockInput {
  /** A seated coach in a live game. Spectators and replays are never locked. */
  seated: boolean;
  /** Which covered cards are mounted for this coach right now. */
  cards: Partial<Record<ConfirmCardKind, boolean>>;
}

/** The open covered cards, in CONFIRM_CARD_KINDS order. Empty when not seated. */
export function openConfirmCards(input: ConfirmCardLockInput): ConfirmCardKind[] {
  if (!input.seated) return [];
  return CONFIRM_CARD_KINDS.filter((kind) => input.cards[kind] === true);
}

/** THE predicate: a coach confirmation card is open. */
export function confirmCardLocked(input: ConfirmCardLockInput): boolean {
  return openConfirmCards(input).length > 0;
}

/**
 * What a bindable action does while a card is open:
 *  - 'allow'   non-game UI: camera (zoom, flip, Auto Director), chat, Log, roster, player cards, display toggles, the
 *              telestrator, the precision crosshair toggle;
 *  - 'escape'  Esc / Start: the card's own Esc answer where it has one, else nothing (never the cascade underneath);
 *  - 'confirm' Space / the confirm key: the card's own confirm where it already had one, else nothing;
 *  - 'swallow' every gameplay action: End Turn, the crosshair click / context / cancel, player cycling, setup moves.
 */
export type LockedActionVerdict = 'allow' | 'escape' | 'confirm' | 'swallow';
const LOCK_ALLOWED: ReadonlySet<ControlActionId> = new Set<ControlActionId>([
  'roster', 'logExpand', 'tackleZones', 'sprites', 'skillDisplay', 'autoDirector', 'openChat', 'telestrator',
  'playerCard', 'playerCardsToggle', 'pitchFlip', 'zoomIn', 'zoomOut', 'precisionToggle', 'cameraPan',
  'crosshairMove', 'fullscreen', 'virtualKeyboard', 'bladePrev', 'bladeNext',
]);
export function lockedControlAction(id: ControlActionId): LockedActionVerdict {
  if (id === 'gameMenu') return 'escape';
  if (id === 'confirm') return 'confirm';
  return LOCK_ALLOWED.has(id) ? 'allow' : 'swallow';
}

/**
 * The Esc-cascade outcomes (escCascadeDecision kinds, plus the wide-rail pre-branch) that answer one of the open cards
 * the way Esc already did before the lock. Anything else the cascade would do (clear a route, ask End Activation,
 * clear the selection, open the Game Menu) is underneath the card and is not run. 'close-menu' only closes a menu or
 * popup that is already open (non-game UI). A card with no Esc answer today contributes nothing: Esc is swallowed.
 */
export function lockedEscapeOutcomes(open: readonly ConfirmCardKind[]): Set<string> {
  const allowed = new Set<string>(['close-menu', 'hold-keep']);
  for (const kind of open) {
    if (kind === 'endTurnWarn' || kind === 'endActivation') allowed.add('dismiss-prompt');
    else if (kind === 'wideRailSpecial') allowed.add('wide-rail-decline');
    else if (kind === 'blockAttack') allowed.add('undeclare'); // Esc on a stage-2 attack already backed out of it
    else if (kind === 'chainsawBlitz') allowed.add('dismiss-blitz-hold');
    else if (kind === 'actionTarget') allowed.add('abort-preview'); // clearO66Arms retires the armed target and its card
  }
  return allowed;
}

/**
 * The confirm key with a card open: which open card it answers, the way it already did before the lock. Null = it
 * answers none of them (it is swallowed: it must not commit a plotted route or a staged action under the card).
 * 'consume' = the card takes the key and decides nothing (the Special Ability election wants an explicit choice).
 */
export type LockedConfirm = 'endConfirmation' | 'blockAttack' | 'actionTarget' | 'consume' | null;
export function lockedConfirmTarget(open: readonly ConfirmCardKind[]): LockedConfirm {
  if (open.includes('endTurnWarn') || open.includes('endActivation')) return 'endConfirmation';
  if (open.includes('wideRailSpecial')) return 'consume';
  // Only when nothing else is open: Space committed the staged attack / armed target these cards confirm.
  if (open.length === 1 && open[0] === 'blockAttack') return 'blockAttack';
  if (open.length === 1 && open[0] === 'actionTarget') return 'actionTarget';
  return null;
}
