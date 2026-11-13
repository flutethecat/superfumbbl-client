// Touch mode Cancel (spec-touch-mode-2026-11-12 section 6). The action center's Cancel runs the controller's B
// (createPadCancel) after five touch pre-steps that B does not reach (they are right-click-only today): undo the last
// pick on a multi-pick board, decline Fury's optional second block, disarm a rooted blitzer's readied block, drop a
// setup selection, and the Kick 'em route / nomination cancel. Each pre-step calls exactly the code the right-click runs for it.

export interface TouchCancelInput {
  playing: boolean;
  myTurn: boolean;
  /** Something is selected on the pitch (renderer selection) or in setup. */
  hasSelection: boolean;
  setupSelection: boolean;
  /** A plotted route, a staged target or any other planner arm (o66HasPlan + the pending refs). */
  hasPlan: boolean;
  aggroStage: boolean;
  deferredSwitch: boolean;
  boardPickUndo: boolean;
  furySecondBlock: boolean;
  rootedBlitzReady: boolean;
  foulChoiceHeld: boolean;
  blitzBlockChoiceDismissible: boolean;
  kickEmNominated: boolean;
}

/** Cancel shows only when it has something to cancel. */
export function touchCancelVisible(i: TouchCancelInput): boolean {
  if (!i.playing || !i.myTurn) return false;
  return i.hasSelection || i.setupSelection || i.hasPlan || i.aggroStage || i.deferredSwitch || i.boardPickUndo
    || i.furySecondBlock || i.rootedBlitzReady || i.foulChoiceHeld || i.blitzBlockChoiceDismissible || i.kickEmNominated;
}

export type TouchCancelPreStep = 'undo-board-pick' | 'decline-fury' | 'disarm-rooted-blitz' | 'drop-setup-selection' | 'kick-em' | null;

/** The pre-step that owns this Cancel press (right-click precedence), or null = hand it to the controller's B. */
export function touchCancelPreStep(i: Pick<TouchCancelInput, 'boardPickUndo' | 'furySecondBlock' | 'rootedBlitzReady' | 'setupSelection' | 'deferredSwitch'> & { kickEmRailArmed?: boolean }): TouchCancelPreStep {
  if (i.deferredSwitch) return null; // B's first step (cancelDeferredSwitch), as the right-click's
  if (i.rootedBlitzReady) return 'disarm-rooted-blitz';
  if (i.boardPickUndo) return 'undo-board-pick';
  if (i.furySecondBlock) return 'decline-fury';
  if (i.setupSelection) return 'drop-setup-selection';
  // The Kick 'em picker stays armed (not declinable) for the whole activation, so B is inert there: the right-click's
  // kickEmCancelDecision (clear the route, else the nomination) answers instead.
  if (i.kickEmRailArmed) return 'kick-em';
  return null;
}

/** Touch mode declare / preview / commit rules (spec section 5). */
/** In touch mode a second tap on the same target never commits: only Confirm does. */
export function secondTapCommits(touch: boolean): boolean {
  return !touch;
}
/** In touch mode a tap on an opponent with only Move armed does nothing but inspect (no click-to-act Block / Blitz). */
export function opponentTapDeclares(touch: boolean): boolean {
  return !touch;
}
export type TouchRouteTap = 'commit' | 'preview';
/** A fresh route in touch mode: no rolls on it (no dodge, no rush, no ball pick-up) commits at once, else it previews. */
export function touchRouteTap(rollCost: number, picksUpBall: boolean): TouchRouteTap {
  return rollCost === 0 && !picksUpBall ? 'commit' : 'preview';
}

/** Skills that roll when a player's activation starts (review finding 7), as normalised names (lower case, letters
 *  only; "Bloodlust (2+)" matches by prefix). Kept for reference: they are never on MOVE_SAFE_SKILLS. */
export const ACTIVATION_ROLL_SKILLS: readonly string[] = [
  'bonehead', 'reallystupid', 'animalsavagery', 'unchannelledfury', 'takeroot', 'bloodlust', 'wildanimal', 'alwayshungry',
];
/** Round-2 finding 5: the explicit allow-list of skills the client KNOWS cannot add a roll to starting an activation or
 *  to a plain move (they act on blocks, passes, catches, injuries, rerolls or the other team's turn). A player with any
 *  skill outside this list, or a star player, never commits a move on the first tap. Names normalised: the value in
 *  brackets dropped, letters only, lower case ("+MA" = "ma"). */
export const MOVE_SAFE_SKILLS: ReadonlySet<string> = new Set([
  'block', 'dodge', 'surehands', 'surefeet', 'sprint', 'catch', 'pass', 'accurate', 'strongarm', 'nervesofsteel', 'guard',
  'mightyblow', 'tackle', 'wrestle', 'frenzy', 'fend', 'kick', 'sidestep', 'standfirm', 'dauntless', 'juggernaut', 'horns',
  'claws', 'claw', 'thickskull', 'regeneration', 'stunty', 'titchy', 'extraarms', 'bighand', 'prehensiletail',
  'disturbingpresence', 'foulappearance', 'shadowing', 'divingtackle', 'divingcatch', 'leader', 'brawler', 'grab',
  'breaktackle', 'defensive', 'ironhardskin', 'multipleblock', 'pilingon', 'piledriver', 'dirtyplayer', 'sneakygit', 'stab',
  'hailmarypass', 'safepass', 'safepairofhands', 'cloudburster', 'fumblerooskie', 'runningpass', 'ontheball', 'cannoneer',
  'armbar', 'kickteammate', 'throwteammate', 'rightstuff', 'hypnoticgaze', 'projectilevomit', 'bombardier', 'verylonglegs',
  'twoheads', 'tentacles', 'monstrousmouth', 'decay', 'plagueridden', 'nurglesrot', 'pro', 'loner', 'hatred', 'chainsaw',
  'secretweapon', 'animosity', 'hitandrun', 'ma', 'st', 'ag', 'pa', 'av',
]);
export function normaliseSkillName(name: string): string {
  return name.replace(/(.*?)/g, '').toLowerCase().replace(/[^a-z]/g, '');
}
export interface TouchMoveRisk {
  /** The planner's roll cost of the route (dodges, rushes); Infinity = unknown. */
  rollCost: number;
  picksUpBall: boolean;
  /** The activation has not moved a square yet (its start rolls are still ahead). */
  freshActivation: boolean;
  actorSkills: readonly string[];
  /** Prone: standing up may roll. */
  actorProne: boolean;
  leaping: boolean;
  /** Ball & Chain: every step scatters. */
  movesRandomly: boolean;
  /** A star player (named rules the client does not model as roll-free). */
  starPlayer: boolean;
  /** A server-published hazard on the field (trapdoors) or a card effect in play: any of them may add a roll. */
  fieldHazard: boolean;
}
/** Touch mode (review findings 7 / round-2 5): a move commits on the first tap only when it is POSITIVELY known that
 *  nothing can roll. Anything uncertain previews and waits for Confirm. */
export function touchMoveRollFree(r: TouchMoveRisk): boolean {
  if (!(r.rollCost === 0) || r.picksUpBall || r.actorProne || r.leaping || r.movesRandomly || r.starPlayer || r.fieldHazard) return false;
  return r.actorSkills.every((s) => MOVE_SAFE_SKILLS.has(normaliseSkillName(s)));
}
