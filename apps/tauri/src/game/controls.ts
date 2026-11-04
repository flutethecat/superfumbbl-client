/**
 * Controller support P1 (owner 10-07, spec-controller-support.md + "Owner round 2"): the action registry. One list of
 * every bindable action with a keyboard and a controller binding pair (primary + secondary), defaults, labels, groups
 * and the context it applies in.
 *
 * Pure module (no settings import — settings.ts imports it): every function takes the settings-shaped object.
 *
 * Storage: `settings.controlBindings` holds every action's four bindings. The three keyboard keys that existed before
 * the registry — `confirmKey`, `rosterKey`, `logExpandKey` — stay the source of truth for their action's KEYBOARD
 * PRIMARY (`keyboardAlias`): reads and writes of that cell go through the old field, so existing code, tests and
 * stored values keep working; `migrateControlBindings` mirrors them into the map.
 *
 * Dispatch: keyboard handlers and the gamepad router both call `dispatchControlAction(id, source)`, which offers the
 * action to the registered handlers by priority (the in-game view over the app shell). No second code path.
 */
import { ref } from 'vue';
import type { PadEvent } from './gamepad';
import { $t } from '../i18n';

export type InputMethod = 'auto' | 'keyboard' | 'controller';
export type ActiveInput = 'controller' | 'mouse';
export type BindingMethod = 'keyboard' | 'controller';
export type BindingSlot = 'primary' | 'secondary';
export type InputSource = 'keyboard' | 'controller';
export interface BindingPair { primary: string; secondary: string }
export interface ActionBindings { keyboard: BindingPair; controller: BindingPair }
export type ControlGroup = 'Game' | 'Camera' | 'Quick bar' | 'Menus';
export type KeyboardAlias = 'confirmKey' | 'rosterKey' | 'logExpandKey';
/** Where an action applies. A `game` and a `main` action may share an input (LB / RB: zoom in game, cycle blades on
 *  the main screen); `any` overlaps both. P2b (Astra P3-14): `setup` = the setup phase only — it never overlaps the
 *  in-play `game` actions (plain LB is unassigned in play) nor the main screen. */
export type ControlContext = 'game' | 'main' | 'setup' | 'any';

export interface ControlAction {
  id: string;
  label: string;
  group: ControlGroup;
  context: ControlContext;
  keyboard: BindingPair;
  controller: BindingPair;
  /** The keyboard binding is a fixed shortcut shown for reference (not rebindable); the label is what the table shows. */
  keyboardFixed?: string;
  /** Same for the controller (the camera stick). */
  controllerFixed?: string;
  /** The keyboard primary lives in this legacy settings field. */
  keyboardAlias?: KeyboardAlias;
}

const pair = (primary = '', secondary = ''): BindingPair => ({ primary, secondary });

/** Owner 10-10: a mouse button a KEYBOARD cell may hold (Settings > Controls captures it like a key). Only the middle
 *  button: the left and right buttons are the pitch's own click / context menu and are never captured. */
export const MOUSE_MIDDLE = 'MouseMiddle';
/** The binding code of a mouse button (MouseEvent.button), or null when that button cannot be bound. */
export function mouseButtonInput(button: number): string | null { return button === 1 ? MOUSE_MIDDLE : null; }
export function isMouseInput(value: string): boolean { return value === MOUSE_MIDDLE; }

/** Every bindable action in the client (P1 inventory + owner round 2 reservations). Order = the Edit Bindings table. */
export const CONTROL_ACTIONS = [
  { id: 'gameMenu', get label() { return $t('settings.controlActions.gameMenuClearSelection'); }, group: 'Game', context: 'any', keyboard: pair('Escape'), controller: pair('Start'), keyboardFixed: 'Esc' },
  { id: 'endTurn', get label() { return $t('settings.controlActions.endTurnConfirmSetup'); }, group: 'Game', context: 'game', keyboard: pair(), controller: pair('View') },
  { id: 'confirm', get label() { return $t('settings.controlActions.confirmMovePassTarget'); }, group: 'Game', context: 'game', keyboard: pair('Space'), controller: pair(), keyboardAlias: 'confirmKey' },
  // Owner 10-10: the keyboard side has NO default (it was P in the dev builds) until the owner rules on each new key.
  { id: 'playerCard', get label() { return $t('settings.controlActions.playerCard'); }, group: 'Game', context: 'game', keyboard: pair(), controller: pair('Y') },
  // Owner 10-10: "let's add Middle Mouse Button as a default button for enabling/disabling player portraits"; restated:
  // "The middle mouse button for player portrait should disable player portraits" - the first press turns them OFF. Flips
  // Settings > UI "Player card" between Show automatically and Only when called. A mouse / keyboard feature (no pad
  // default, not behind the controller box).
  { id: 'playerCardsToggle', get label() { return $t('settings.controlActions.playerPortraitsOnOff'); }, group: 'Game', context: 'game', keyboard: pair(MOUSE_MIDDLE), controller: pair() },
  { id: 'cyclePlayerPrev', get label() { return $t('settings.controlActions.previousPlayerWhoCan'); }, group: 'Game', context: 'game', keyboard: pair(), controller: pair('DpadLeft') },
  { id: 'cyclePlayerNext', get label() { return $t('settings.controlActions.nextPlayerWhoCan'); }, group: 'Game', context: 'game', keyboard: pair(), controller: pair('DpadRight') },
  // Controller support P2b (owner round 2): setup — LB places the current player on the next free line-of-scrimmage
  // square (centre outward), RB sends it to the reserves. Setup-phase only (Astra P3-14), and listed before the in-play
  // rows so a coach's own plain-LB binding cannot shadow it during setup. Plain LB acts on release (chords still work).
  { id: 'setupPlaceLos', get label() { return $t('settings.controlActions.setupPlaceOnThe'); }, group: 'Game', context: 'setup', keyboard: pair(), controller: pair('LB') },
  { id: 'setupReserve', get label() { return $t('settings.controlActions.setupSendToThe'); }, group: 'Game', context: 'setup', keyboard: pair(), controller: pair('RB') },
  // Controller support P2a (owner 10-07): the pitch crosshair. The mouse is the keyboard side of these (fixed cells).
  { id: 'crosshairMove', get label() { return $t('settings.controlActions.moveTheCrosshair'); }, group: 'Game', context: 'game', keyboard: pair(), controller: pair('LeftStick'), keyboardFixed: 'Mouse', controllerFixed: 'Left stick' },
  { id: 'crosshairSelect', get label() { return $t('settings.controlActions.clickAtTheCrosshair'); }, group: 'Game', context: 'game', keyboard: pair(), controller: pair('A'), keyboardFixed: 'Left click' },
  { id: 'crosshairContext', get label() { return $t('settings.controlActions.contextMenuAtThe'); }, group: 'Game', context: 'game', keyboard: pair(), controller: pair('X'), keyboardFixed: 'Right click' },
  { id: 'crosshairCancel', get label() { return $t('settings.controlActions.cancelDismiss'); }, group: 'Game', context: 'game', keyboard: pair(), controller: pair('B'), keyboardFixed: 'Right click on grass' },
  { id: 'precisionToggle', get label() { return $t('settings.controlActions.precisionCrosshairOnOff'); }, group: 'Game', context: 'game', keyboard: pair(), controller: pair('L3'), keyboardFixed: '—' },
  { id: 'cameraPan', get label() { return $t('settings.controlActions.cameraPan'); }, group: 'Camera', context: 'game', keyboard: pair('KeyW'), controller: pair('RightStick'), keyboardFixed: 'W A S D / Arrows', controllerFixed: 'Right stick' },
  // Owner 10-07: zoom lives on the TRIGGERS (tap = one level, hold = continuous); LB / RB are unassigned in game
  // (LB held is the quick-bar chord modifier). Keys: none by default (owner 10-10; the dev builds had = / - and the
  // numpad + / -); bindable in the table.
  { id: 'zoomIn', get label() { return $t('settings.controlActions.zoomInTriggerTap'); }, group: 'Camera', context: 'game', keyboard: pair(), controller: pair('RT(tap)') },
  { id: 'zoomOut', get label() { return $t('settings.controlActions.zoomOutTriggerTap'); }, group: 'Camera', context: 'game', keyboard: pair(), controller: pair('LT(tap)') },
  { id: 'autoDirector', get label() { return $t('settings.controlActions.autoDirectorOnOff'); }, group: 'Camera', context: 'game', keyboard: pair(), controller: pair('LB+DpadRight') },
  // Owner 10-12: "a hot key to flip perspectives on the pitch" (north / south or east / west turned around; seats stay).
  // Flips the Settings checkbox "Flip the pitch view". `game` covers setup and kick-off as well. No pad default.
  { id: 'pitchFlip', get label() { return $t('settings.controlActions.flipThePitchView'); }, group: 'Camera', context: 'game', keyboard: pair('KeyF'), controller: pair() },
  { id: 'tackleZones', get label() { return $t('settings.controlActions.tackleZonesCycle'); }, group: 'Quick bar', context: 'game', keyboard: pair(), controller: pair('LB+DpadUp') },
  { id: 'sprites', get label() { return $t('settings.controlActions.spritesCycle'); }, group: 'Quick bar', context: 'game', keyboard: pair(), controller: pair('LB+DpadDown') },
  { id: 'skillDisplay', get label() { return $t('settings.controlActions.skillDisplayIconsMarkings'); }, group: 'Quick bar', context: 'game', keyboard: pair(), controller: pair('LB+DpadLeft') },
  { id: 'roster', get label() { return $t('settings.controlActions.rosterPopOut'); }, group: 'Quick bar', context: 'game', keyboard: pair('KeyH'), controller: pair('LB+A'), keyboardAlias: 'rosterKey' },
  { id: 'logExpand', get label() { return $t('settings.controlActions.enlargeTheLogWindow'); }, group: 'Quick bar', context: 'game', keyboard: pair('KeyL'), controller: pair('LB+X'), keyboardAlias: 'logExpandKey' },
  { id: 'openChat', get label() { return $t('settings.controlActions.openChatChatDock'); }, group: 'Quick bar', context: 'game', keyboard: pair('Enter'), controller: pair('LB+Y'), keyboardFixed: 'Enter' },
  { id: 'telestrator', get label() { return $t('settings.controlActions.telestratorSketchOpenClose'); }, group: 'Quick bar', context: 'game', keyboard: pair(), controller: pair('LB+B') },
  { id: 'bladePrev', get label() { return $t('settings.controlActions.previousBladeMainScreen'); }, group: 'Menus', context: 'main', keyboard: pair(), controller: pair('LB') },
  { id: 'bladeNext', get label() { return $t('settings.controlActions.nextBladeMainScreen'); }, group: 'Menus', context: 'main', keyboard: pair(), controller: pair('RB') },
  { id: 'virtualKeyboard', get label() { return $t('settings.controlActions.virtualKeyboardComingSoon'); }, group: 'Menus', context: 'any', keyboard: pair(), controller: pair('RT+X') },
  { id: 'fullscreen', get label() { return $t('settings.controlActions.toggleFullscreen'); }, group: 'Menus', context: 'any', keyboard: pair('F11'), controller: pair(), keyboardFixed: 'F11 / Alt + Enter' },
] as const satisfies readonly ControlAction[];

export type ControlActionId = (typeof CONTROL_ACTIONS)[number]['id'];
export type ControlBindings = Record<ControlActionId, ActionBindings>;

const ACTIONS: readonly ControlAction[] = CONTROL_ACTIONS;
const ACTION_BY_ID = new Map<string, ControlAction>(ACTIONS.map((a) => [a.id, a]));
export function controlAction(id: ControlActionId): ControlAction { return ACTION_BY_ID.get(id)!; }
/** Owner 10-10: actions that exist only for a pad (the crosshair and what rides on it, the setup bumpers, the virtual
 *  keyboard). Settings > Controls lists them only while controller support is on. */
const PAD_ONLY_ACTIONS: ReadonlySet<string> = new Set([
  'cyclePlayerPrev', 'cyclePlayerNext', 'setupPlaceLos', 'setupReserve', 'crosshairMove', 'crosshairSelect',
  'crosshairContext', 'crosshairCancel', 'precisionToggle', 'virtualKeyboard',
]);
export function isPadOnlyAction(id: ControlActionId): boolean { return PAD_ONLY_ACTIONS.has(id); }
export function isControlActionId(value: unknown): value is ControlActionId { return typeof value === 'string' && ACTION_BY_ID.has(value); }

export function defaultControlBindings(): ControlBindings {
  return Object.fromEntries(ACTIONS.map((a) => [a.id, { keyboard: { ...a.keyboard }, controller: { ...a.controller } }])) as ControlBindings;
}

/** The settings slice the registry reads and writes. */
export interface ControlSettings {
  confirmKey: string;
  rosterKey: string;
  logExpandKey: string;
  controlBindings: ControlBindings;
  inputMethod: InputMethod;
}

const CONTROLLER_INPUTS = new Set<string>([
  'A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Start', 'L3', 'R3', 'DpadUp', 'DpadDown', 'DpadLeft', 'DpadRight',
]);
/** A storable controller binding: a button, an LB / RT chord on another button, a trigger gesture (`LT(tap)` /
 *  `RT(tap)`: tap = one step, hold = continuous), or a stick. A bare LT / RT press is not bindable (Astra review P2.6):
 *  the triggers bind as their gesture. */
export function isControllerInput(value: string): boolean {
  if (value === 'LT' || value === 'RT') return false;
  if (value === 'LT(tap)' || value === 'RT(tap)') return true;
  if (CONTROLLER_INPUTS.has(value) || value === 'LeftStick' || value === 'RightStick') return true;
  const m = /^(LB|RT)\+(.+)$/.exec(value);
  return !!m && m[1] !== m[2] && m[2] !== 'LT' && m[2] !== 'RT' && CONTROLLER_INPUTS.has(m[2]!);
}
const isKeyboardInput = (value: string): boolean => /^[A-Za-z][A-Za-z0-9]{0,31}$/.test(value);
/** Two actions can collide only when their contexts overlap. */
export function contextsOverlap(a: ControlContext, b: ControlContext): boolean { return a === 'any' || b === 'any' || a === b; }
// (setup vs game / main: never — distinct contexts.)

/**
 * Load-time migration + sanitising. Keeps every stored valid binding, fills missing actions / cells with defaults,
 * drops unknown actions and malformed values, and mirrors the legacy keyboard fields (already validated by the
 * loader) into their actions' keyboard primary — the user's existing keys are preserved, never reset. A legacy key
 * also wins over a NEW action's default (a roster key on P keeps P; Player card then starts unbound).
 */
/** Actions added after coaches already had stored maps: their keyboard default yields to any key a coach stored. */
const DEFAULT_YIELDS_TO_STORED: ReadonlySet<string> = new Set(['pitchFlip']);
/** Bumped when defaults move; `migrateControlBindings` upgrades a stored map from an older revision. */
export const CONTROL_BINDINGS_REVISION = 3;
/** Revision → the defaults it retired: a stored cell from an older revision still equal to one takes the new default
 *  (a cell the coach changed is kept). r2 (owner 10-07): zoom moved from LB / RB to the trigger gestures and got keys
 *  (the r1 keyboard cells were empty). */
const RETIRED_DEFAULTS: Record<number, Partial<Record<ControlActionId, Partial<Record<BindingMethod, Partial<BindingPair>>>>>> = {
  2: {
    zoomIn: { controller: { primary: 'RB' }, keyboard: { primary: '', secondary: '' } },
    zoomOut: { controller: { primary: 'LB' }, keyboard: { primary: '', secondary: '' } },
  },
  // r3 (owner 10-10): the keyboard defaults the dev builds introduced (P, = / -, numpad + / -) are withdrawn until the
  // owner rules on each: a stored cell still equal to one becomes unbound; a key the coach chose is kept.
  3: {
    playerCard: { keyboard: { primary: 'KeyP' } },
    zoomIn: { keyboard: { primary: 'Equal', secondary: 'NumpadAdd' } },
    zoomOut: { keyboard: { primary: 'Minus', secondary: 'NumpadSubtract' } },
  },
};
/** r2 (owner 10-07, o66md): LB replaced LT as the chord modifier. Every stored `LT+<x>` becomes `LB+<x>` — the old
 *  defaults move with the layer, and a coach's own LT chord keeps its button (LT no longer chords, so `LT+<x>` could
 *  never fire again). */
/** Astra review: only an integer revision 1..CURRENT is trusted; anything else (NaN, 1.5, -1e100, > CURRENT, a
 *  string) is treated as r1 and every migration re-runs. */
export function normaliseBindingsRevision(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= CONTROL_BINDINGS_REVISION ? value : 1;
}
/** The fixed migration list (never a loop bounded by a stored number). */
const MIGRATION_REVISIONS = Object.keys(RETIRED_DEFAULTS).map(Number).sort((a, b) => a - b);

function upgradeStoredCell(value: unknown, storedRevision: number): unknown {
  if (storedRevision < 2 && typeof value === 'string') {
    const m = /^LT\+(.+)$/.exec(value);
    if (m) return `LB+${m[1]}`;
  }
  return value;
}

/** `reservedKeyboard` (Astra P2, 10-10): keyboard codes no registry cell may hold on load - the fixed shortcuts (Esc,
 *  Enter, F11, W A S D / arrows, 1-6, modifiers) and the unbindable keys; settings.ts passes its lists. Together with
 *  the three legacy keys (Confirm / Roster / Log, whatever the coach set them to) these are the keys the client had
 *  before the registry: a STORED cell that claims one is dropped (the newcomer yields, never the existing key), so a
 *  hand-edited / stale map cannot make Space end the turn or H do anything but open the roster - box on or off. The
 *  live editor already refuses the same conflicts (settings.ts controlBindingConflict). */
export function migrateControlBindings(raw: unknown, legacy: Pick<ControlSettings, KeyboardAlias>, revision: unknown = CONTROL_BINDINGS_REVISION, reservedKeyboard: Iterable<string> = []): ControlBindings {
  const storedRevision = normaliseBindingsRevision(revision);
  const stored = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const upgraded = new Set<string>();
  const hadStored = (id: string): boolean => !upgraded.has(id) && !!stored[id] && typeof stored[id] === 'object';
  const out = defaultControlBindings();
  /** Keyboard cells whose value came from storage (the rest hold the table default). */
  const storedCells = new Set<string>();
  for (const action of ACTIONS) {
    const entry = stored[action.id] as Partial<Record<BindingMethod, Partial<BindingPair>>> | undefined;
    const target = out[action.id as ControlActionId];
    for (const method of ['keyboard', 'controller'] as const) {
      const fixed = method === 'keyboard' ? action.keyboardFixed : action.controllerFixed;
      if (fixed) continue; // a fixed binding is never stored differently
      const valid = method === 'keyboard' ? isKeyboardInput : isControllerInput;
      for (const slot of ['primary', 'secondary'] as const) {
        const value = upgradeStoredCell(entry && typeof entry === 'object' ? entry[method]?.[slot] : undefined, storedRevision);
        if (typeof value === 'string' && (value === '' || valid(value))) {
          target[method][slot] = value;
          if (method === 'keyboard') storedCells.add(`${action.id}.${slot}`);
        }
      }
    }
    if (action.keyboardAlias) target.keyboard.primary = legacy[action.keyboardAlias];
    for (const rev of MIGRATION_REVISIONS) {
      if (rev <= storedRevision) continue;
      const retired = RETIRED_DEFAULTS[rev]?.[action.id as ControlActionId];
      if (!retired || !hadStored(action.id)) continue;
      for (const method of ['keyboard', 'controller'] as const) {
        for (const slot of ['primary', 'secondary'] as const) {
          const old = retired[method]?.[slot];
          if (old !== undefined && target[method][slot] === old) { target[method][slot] = action[method][slot]; upgraded.add(action.id); }
        }
      }
    }
  }
  const legacyKeys = new Set<string>([legacy.confirmKey, legacy.rosterKey, legacy.logExpandKey]);
  const reserved = new Set<string>(reservedKeyboard);
  const taken = (key: string): boolean => !!key && (legacyKeys.has(key) || reserved.has(key));
  // Every rebindable keyboard cell except the three legacy primaries themselves - stored or default alike - yields to
  // the keys the client already had. Then a key two stored cells both claim (in overlapping contexts) stays with the
  // first action in table order only.
  const claimed: { key: string; context: ControlContext }[] = ACTIONS.filter((a) => a.keyboardAlias)
    .map((a) => ({ key: legacy[a.keyboardAlias!], context: a.context }));
  // Owner 10-12 (the Flip the pitch view default, F): the NEW action's table default never displaces a key the coach
  // bound themselves, whatever the table order - the newcomer starts unbound instead. Only this action (Astra review):
  // every other effective binding is exactly what the passes below gave it before the flip existed.
  for (const action of ACTIONS) {
    if (action.keyboardFixed || !DEFAULT_YIELDS_TO_STORED.has(action.id)) continue;
    const kb = out[action.id as ControlActionId].keyboard;
    for (const slot of ['primary', 'secondary'] as const) {
      const key = kb[slot];
      if (!key || storedCells.has(`${action.id}.${slot}`) || (slot === 'primary' && action.keyboardAlias)) continue;
      const coachHasIt = ACTIONS.some((other) => other !== action && !other.keyboardFixed && contextsOverlap(other.context, action.context)
        && (['primary', 'secondary'] as const).some((s) => storedCells.has(`${other.id}.${s}`) && out[other.id as ControlActionId].keyboard[s] === key));
      if (coachHasIt) kb[slot] = '';
    }
  }
  for (const action of ACTIONS) {
    if (action.keyboardFixed) continue;
    const kb = out[action.id as ControlActionId].keyboard;
    for (const slot of ['primary', 'secondary'] as const) {
      if (slot === 'primary' && action.keyboardAlias) continue; // the legacy key itself
      const key = kb[slot];
      if (!key) continue;
      if (taken(key) || claimed.some((c) => c.key === key && contextsOverlap(c.context, action.context))) kb[slot] = '';
      else claimed.push({ key, context: action.context });
    }
  }
  return out;
}

/** The effective bindings of one action (the legacy alias wins for its keyboard primary). */
export function getBinding(settings: ControlSettings, id: ControlActionId): ActionBindings {
  const action = controlAction(id);
  // Defensive: the loader validates a stored keyboard key against the RAW stored map before migrating it.
  const entry = settings.controlBindings?.[id] as Partial<Record<BindingMethod, Partial<BindingPair>>> | undefined;
  const cell = (method: BindingMethod, slot: BindingSlot): string => {
    const value = entry && typeof entry === 'object' ? entry[method]?.[slot] : undefined;
    return typeof value === 'string' ? value : action[method][slot];
  };
  return {
    keyboard: { primary: action.keyboardAlias ? settings[action.keyboardAlias] : cell('keyboard', 'primary'), secondary: cell('keyboard', 'secondary') },
    controller: { primary: cell('controller', 'primary'), secondary: cell('controller', 'secondary') },
  };
}

export function isBindingEditable(id: ControlActionId, method: BindingMethod): boolean {
  const action = controlAction(id);
  return !(method === 'keyboard' ? action.keyboardFixed : action.controllerFixed);
}

/** Write one cell. Fixed cells are left alone (returns false). */
export function setBinding(settings: ControlSettings, id: ControlActionId, method: BindingMethod, slot: BindingSlot, input: string): boolean {
  if (!isBindingEditable(id, method)) return false;
  const action = controlAction(id);
  if (!settings.controlBindings || typeof settings.controlBindings !== 'object') settings.controlBindings = defaultControlBindings();
  if (!settings.controlBindings[id]) settings.controlBindings[id] = { keyboard: { ...action.keyboard }, controller: { ...action.controller } };
  settings.controlBindings[id][method][slot] = input;
  if (method === 'keyboard' && slot === 'primary' && action.keyboardAlias) settings[action.keyboardAlias] = input;
  return true;
}

/** Reset to defaults — every action, both methods, including the legacy keyboard fields. */
export function resetControlBindings(settings: ControlSettings): void {
  settings.controlBindings = defaultControlBindings();
  for (const action of ACTIONS) {
    if (action.keyboardAlias) settings[action.keyboardAlias] = action.keyboard.primary;
  }
}

/** The action whose cell of `method` already binds `input` in an overlapping context (null when free). Fixed cells
 *  count. */
export function bindingConflict(settings: ControlSettings, id: ControlActionId, method: BindingMethod, slot: BindingSlot, input: string): ControlActionId | null {
  if (!input) return null;
  const context = controlAction(id).context;
  for (const action of ACTIONS) {
    if (!contextsOverlap(context, action.context)) continue;
    const b = getBinding(settings, action.id as ControlActionId)[method];
    for (const s of ['primary', 'secondary'] as const) {
      if (action.id === id && s === slot) continue;
      if (b[s] === input) return action.id as ControlActionId;
    }
  }
  return null;
}

export interface BindingConflictGroup { method: BindingMethod; input: string; actions: ControlActionId[] }
/** Every input bound more than once within a method in overlapping contexts (for the Settings warning). */
export function findBindingConflicts(settings: ControlSettings): BindingConflictGroup[] {
  const out: BindingConflictGroup[] = [];
  for (const method of ['keyboard', 'controller'] as const) {
    const holders = new Map<string, ControlAction[]>();
    for (const action of ACTIONS) {
      const b = getBinding(settings, action.id as ControlActionId)[method];
      for (const input of new Set([b.primary, b.secondary])) {
        if (input) holders.set(input, [...(holders.get(input) ?? []), action]);
      }
    }
    for (const [input, actions] of holders) {
      const clashing = actions.filter((a) => actions.some((o) => o !== a && contextsOverlap(a.context, o.context)));
      if (clashing.length > 1) out.push({ method, input, actions: clashing.map((a) => a.id as ControlActionId) });
    }
  }
  return out;
}

/** The actions a pressed key / pad input triggers, in table order (rebindable cells only for the keyboard — fixed
 *  shortcuts keep their own handlers; every controller cell incl. defaults). Several only when their contexts differ
 *  (LB: zoom out in game, previous blade on the main screen) — the router offers each until one handles it. */
export function actionsForInput(settings: ControlSettings, method: BindingMethod, input: string, context?: ControlContext | null): ControlActionId[] {
  if (!input) return [];
  const out: ControlActionId[] = [];
  for (const action of ACTIONS) {
    if (method === 'keyboard' && action.keyboardFixed) continue;
    const b = getBinding(settings, action.id as ControlActionId)[method];
    if (b.primary === input || b.secondary === input) out.push(action.id as ControlActionId);
  }
  if (!context || context === 'any') return out;
  // P2b (Astra P2-f): the CURRENT context's actions are offered first (setup actions during setup, in-play actions in
  // play), then `any`, then the rest; table order within each rank (a stable sort).
  const rank = (id: ControlActionId): number => {
    const c = controlAction(id).context;
    return c === context ? 0 : c === 'any' ? 1 : 2;
  };
  return out.map((id, i) => ({ id, i })).sort((a, b) => rank(a.id) - rank(b.id) || a.i - b.i).map((e) => e.id);
}

/** P2b (Astra final P2): the in-game keyboard path over a context-ranked list. `tryFirst` = the actions to offer before
 *  the confirm shortcut (everything ranked ahead of `confirm`); `confirm` = the key is (also) the confirm key, which
 *  runs its own guarded branch when nothing ranked ahead of it handled the press. Confirm wins only when it is the
 *  context's first candidate (Space bound to Setup: send to reserves sends to reserves during setup). */
export function resolveKeyActions(ranked: readonly ControlActionId[]): { tryFirst: ControlActionId[]; confirm: boolean } {
  const at = ranked.indexOf('confirm');
  return at < 0 ? { tryFirst: [...ranked], confirm: false } : { tryFirst: ranked.slice(0, at), confirm: true };
}

/** P2b (Astra P2-f): which context pad / key presses resolve in right now (SpectateView sets `setup` / `game`; null =
 *  the main screen). */
let activeContextProvider: () => ControlContext | null = () => null;
export function setActiveControlContext(fn: (() => ControlContext | null) | null): void { activeContextProvider = fn ?? (() => null); }
export function activeControlContext(): ControlContext {
  return activeContextProvider() ?? 'main';
}
export function actionForInput(settings: ControlSettings, method: BindingMethod, input: string): ControlActionId | null {
  return actionsForInput(settings, method, input)[0] ?? null;
}

/** Astra review P2.8: a NEW action's default key that migration left unbound because a coach's legacy key holds it
 *  (e.g. roster on P → Player card unbound). Null when the cell is bound or was not displaced. */
export function legacyCollisionNote(settings: ControlSettings, id: ControlActionId): { key: string; keptBy: ControlActionId } | null {
  const action = controlAction(id);
  if (action.keyboardAlias || action.keyboardFixed || !action.keyboard.primary) return null;
  if (getBinding(settings, id).keyboard.primary !== '') return null;
  for (const other of ACTIONS) {
    if (other.keyboardAlias && settings[other.keyboardAlias] === action.keyboard.primary) return { key: action.keyboard.primary, keptBy: other.id as ControlActionId };
  }
  return null;
}

/** Player card call (owner round 2: controller Y / key P). P1 stub: the in-game handler calls this hook (a no-op until
 *  the P2 card surface installs one with setPlayerCardHook). */
let playerCardHook: (source: InputSource) => void = () => undefined;
export function setPlayerCardHook(hook: ((source: InputSource) => void) | null): void { playerCardHook = hook ?? (() => undefined); }
export function requestPlayerCard(source: InputSource): void { playerCardHook(source); }

const PAD_LABELS: Record<string, string> = {
  get View() { return $t('settings.controls.padLabels.view'); }, get Start() { return $t('settings.controls.padLabels.start'); }, get 'LT(tap)'() { return $t('settings.controls.padLabels.ltTap'); }, get 'RT(tap)'() { return $t('settings.controls.padLabels.rtTap'); }, get DpadUp() { return $t('settings.controls.padLabels.dPad'); }, get DpadDown() { return $t('settings.controls.padLabels.dPad2'); }, get DpadLeft() { return $t('settings.controls.padLabels.dPad3'); }, get DpadRight() { return $t('settings.controls.padLabels.dPad4'); },
  get LeftStick() { return $t('settings.controls.padLabels.leftStick'); }, get RightStick() { return $t('settings.controls.padLabels.rightStick'); },
};
export function controllerInputLabel(input: string): string {
  if (!input) return '—';
  return input.split('+').map((part) => PAD_LABELS[part] ?? part).join(' + ');
}

/** Wraps through `list` from `current` (a missing current starts at the first / last entry). */
export function nextInCycle<T>(list: readonly T[], current: T, direction: 1 | -1): T | undefined {
  if (!list.length) return undefined;
  const i = list.indexOf(current);
  if (i < 0) return direction > 0 ? list[0] : list[list.length - 1];
  return list[(i + direction + list.length) % list.length];
}

// --- dispatcher ---------------------------------------------------------------------------------------------------

/** Returns true when it handled the action (stops the offer). */
export type ControlActionHandler = (id: ControlActionId, source: InputSource) => boolean;
export type ControlAnalogHandler = (stick: 'left' | 'right', x: number, y: number) => boolean;
/** Controller support P2a: the stick that is not the camera's drives the pitch crosshair. */
export type ControlPointerStickHandler = (x: number, y: number) => boolean;

interface Registered<T> { handler: T; priority: number; order: number }
const actionHandlers: Registered<ControlActionHandler>[] = [];
const analogHandlers: Registered<ControlAnalogHandler>[] = [];
const pointerStickHandlers: Registered<ControlPointerStickHandler>[] = [];
let registrationOrder = 0;

/** Higher priority is offered first; equal priorities newest-first. The in-game view registers at
 *  CONTROL_PRIORITY_GAME over the app shell's CONTROL_PRIORITY_SHELL regardless of mount order. */
export const CONTROL_PRIORITY_SHELL = 0;
export const CONTROL_PRIORITY_GAME = 10;
function register<T>(list: Registered<T>[], handler: T, priority: number): () => void {
  const entry = { handler, priority, order: ++registrationOrder };
  list.push(entry);
  list.sort((a, b) => b.priority - a.priority || b.order - a.order);
  return () => { const i = list.indexOf(entry); if (i >= 0) list.splice(i, 1); };
}
export function registerActionHandler(handler: ControlActionHandler, priority = CONTROL_PRIORITY_SHELL): () => void { return register(actionHandlers, handler, priority); }
export function registerAnalogHandler(handler: ControlAnalogHandler, priority = CONTROL_PRIORITY_SHELL): () => void { return register(analogHandlers, handler, priority); }

export function dispatchControlAction(id: ControlActionId, source: InputSource): boolean {
  for (const { handler } of [...actionHandlers]) if (handler(id, source)) return true;
  return false;
}
/** Trigger hold gesture (owner 10-07: continuous zoom): `active` true when the hold starts, false when it ends. */
export type ControlHoldHandler = (id: ControlActionId, active: boolean, trigger: 'LT' | 'RT') => boolean;
const holdHandlers: Registered<ControlHoldHandler>[] = [];
export function registerHoldHandler(handler: ControlHoldHandler, priority = CONTROL_PRIORITY_SHELL): () => void { return register(holdHandlers, handler, priority); }
export function dispatchControlHold(id: ControlActionId, active: boolean, trigger: 'LT' | 'RT'): boolean {
  for (const { handler } of [...holdHandlers]) if (handler(id, active, trigger)) return true;
  return false;
}
export function dispatchAnalog(stick: 'left' | 'right', x: number, y: number): boolean {
  for (const { handler } of [...analogHandlers]) if (handler(stick, x, y)) return true;
  return false;
}
export function registerPointerStickHandler(handler: ControlPointerStickHandler, priority = CONTROL_PRIORITY_SHELL): () => void { return register(pointerStickHandlers, handler, priority); }
export function dispatchPointerStick(x: number, y: number): boolean {
  for (const { handler } of [...pointerStickHandlers]) if (handler(x, y)) return true;
  return false;
}

/** Controller support P2b: raw pad events offered BEFORE action dispatch (server cards own the pad while open —
 *  game/cardFocus.ts). True = consumed. */
export type PadInterceptor = (event: PadEvent) => boolean;
const padInterceptors: Registered<PadInterceptor>[] = [];
export function registerPadInterceptor(handler: PadInterceptor, priority = CONTROL_PRIORITY_SHELL): () => void { return register(padInterceptors, handler, priority); }
/** Sol r4: the camera stick's DIRECTION steps are offered to the interceptors only when this says the open focus scope
 *  asked for them (game/cardFocus.ts: a card with a `scroll` body). Everywhere else the camera keeps the stick. */
let cameraStickDirectionTaker: (event: PadEvent) => boolean = () => false;
export function setCameraStickDirectionTaker(fn: ((event: PadEvent) => boolean) | null): void { cameraStickDirectionTaker = fn ?? (() => false); }
export function cameraStickDirectionTaken(event: PadEvent): boolean { return cameraStickDirectionTaker(event); }
export function dispatchPadIntercept(event: PadEvent): boolean {
  for (const { handler } of [...padInterceptors]) if (handler(event)) return true;
  return false;
}

/** Controller support P2b (owner addition): the chord modifiers currently held (LB, RT) — the chord-layer glyph
 *  badges read it. Cleared on release, a cancelled release, and every fail-safe. */
export const heldModifiers = ref<{ LB: boolean; RT: boolean }>({ LB: false, RT: false });

/** P2b glyphs (owner round 2): which prompt set the pads get — Sony pads (vendor 054c) the generic shape set, every
 *  other pad the Xbox set. Follows the last pad used. */
export type PadGlyphFamily = 'xbox' | 'sony';
export function padGlyphFamily(id: string | null | undefined): PadGlyphFamily {
  return /054c|sony|playstation|dualshock|dualsense/i.test(id ?? '') ? 'sony' : 'xbox';
}
export const activePadGlyphFamily = ref<PadGlyphFamily>('xbox');

// --- active input + controller router -----------------------------------------------------------------------------

/**
 * Owner (10-07): which device is driving the client right now. `inputMethod: 'auto'` (default) follows the last
 * device used — a pad button edge or a stick past its deadzone → 'controller' at once (OS cursor hidden); mouse
 * movement > 4 px, a click, the wheel or a key → 'mouse' at once (cursor shown). 'keyboard' / 'controller' pin it.
 * Everything controller-only (pad actions, the camera stick, later the crosshair / glyphs) gates on
 * `activeInput.value === 'controller'`. Reactive for later phases.
 */
export const activeInput = ref<ActiveInput>('mouse');
export const INPUT_SWITCH_NOTICE_MS = 1500;
export const INPUT_SWITCH_NOTICE: Record<ActiveInput, string> = { get controller() { return $t('settings.controls.inputSwitchNotice.controller'); }, get mouse() { return $t('settings.controls.inputSwitchNotice.mouseKeyboard'); } };
export const CONTROLLER_DISCONNECT_TOAST = 'Controller disconnected — mouse and keyboard still work';
export const CONTROLLER_TOAST_MS = 8000;
/** Mouse travel (px) that counts as using the mouse. */
export const MOUSE_SWITCH_DISTANCE_PX = 4;

/** The device a pinned method forces (null = auto, which follows use). */
export function pinnedInput(method: InputMethod): ActiveInput | null {
  return method === 'controller' ? 'controller' : method === 'keyboard' ? 'mouse' : null;
}

/** Astra review (P2.1 / B1): a STICK-driven switch to the controller waits this long after any switch (drift guard).
 *  A button edge and mouse / key use always switch at once. */
export const INPUT_SWITCH_DEBOUNCE_MS = 500;
/** Owner (o66mh, Steam Controller): every pad the browser reports, with its mapping, for Settings > Controls. */
export interface ConnectedPad { pad: number; id: string; standard: boolean }
export const connectedPads = ref<ConnectedPad[]>([]);
export const CONTROLLER_CONNECT_TOAST_MS = 3000;
export const NONSTANDARD_PAD_TOAST_MS = 6000;
/** A readable pad name: the Gamepad API id without the vendor / product suffix (Chromium "(... Vendor: …)") or the
 *  Firefox "045e-0b13-" prefix, capped at 40 characters. */
export function padShortName(id: string): string {
  let name = String(id ?? '').replace(/\s*\([^)]*\)\s*$/, '').replace(/^[0-9a-f]{1,4}-[0-9a-f]{1,4}-/i, '').trim();
  if (!name) name = 'Controller';
  return name.length > 40 ? `${name.slice(0, 39)}…` : name;
}
export function controllerConnectToast(id: string): string { return $t('settings.controls.text.controllerConnectedP0', { p0: padShortName(id) }); }
/** Owner (o66mh): a pad without the W3C "standard" mapping (Steam Controller outside Steam Input, some DualSense /
 *  generic HID pads) cannot be read with the Xbox table — say so and how to fix it; its input is never used. */
export function nonStandardPadToast(id: string): string {
  return $t('settings.controls.text.controllerP0UsesA', { p0: padShortName(id) })
    + $t('settings.controls.text.steamControllerDualsenseUsers');
}
/** Connected standard pads (the router counts connect / disconnect). Reactive for the camera fail-safe. */
export const connectedPadCount = ref(0);

export interface InputSwitcherDeps {
  settings: Pick<ControlSettings, 'inputMethod'> & { showInputSwitchNotice?: boolean };
  /** The state written (defaults to the exported `activeInput`). */
  state?: { value: ActiveInput };
  /** Millisecond clock for the switch debounce (defaults to performance.now / Date.now). */
  now?(): number;
  showNotice?(text: string, durationMs: number): void;
  /** Cursor: hidden while the controller drives, shown on any mouse / key use. */
  setCursorHidden?(hidden: boolean): void;
  /** Every change of the active input (incl. a pin); the camera fail-safe hooks here. */
  onChange?(next: ActiveInput): void;
}
export interface InputSwitcher {
  /** Deliberate pad use: a button edge (`'button'`, switches at once), or a stick past deadzone + 0.1 for two polls
   *  (`'stick'`, subject to the drift cooldown). */
  padUsed(kind?: 'button' | 'stick'): void;
  /** Mouse moved > 4 px, clicked, wheeled, or a key was pressed. */
  mouseUsed(): void;
  /** Re-apply the pinned value after a settings change. */
  sync(): void;
}
const clock = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());
export function createInputSwitcher(deps: InputSwitcherDeps): InputSwitcher {
  const state = deps.state ?? activeInput;
  const now = deps.now ?? clock;
  let lastSwitch = Number.NEGATIVE_INFINITY;
  const set = (next: ActiveInput): void => {
    if (state.value === next) return;
    state.value = next;
    deps.onChange?.(next);
  };
  const switchTo = (next: ActiveInput, cooled = false): void => {
    if (state.value === next) return;
    const t = now();
    if (cooled && t - lastSwitch < INPUT_SWITCH_DEBOUNCE_MS) return;
    lastSwitch = t;
    set(next);
    if (deps.settings.showInputSwitchNotice !== false) deps.showNotice?.(INPUT_SWITCH_NOTICE[next], INPUT_SWITCH_NOTICE_MS);
  };
  return {
    padUsed(kind = 'button') {
      const pinned = pinnedInput(deps.settings.inputMethod);
      if (pinned === null) switchTo('controller', kind === 'stick');
      if (state.value === 'controller') deps.setCursorHidden?.(true);
    },
    mouseUsed() {
      deps.setCursorHidden?.(false);
      if (pinnedInput(deps.settings.inputMethod) === null) switchTo('mouse');
    },
    sync() {
      const pinned = pinnedInput(deps.settings.inputMethod);
      if (pinned !== null) set(pinned);
      if (state.value !== 'controller') deps.setCursorHidden?.(false);
    },
  };
}

export interface ControllerRouterDeps {
  settings: ControlSettings;
  switcher: InputSwitcher;
  /** The active-input state read for gating (defaults to the exported `activeInput`). */
  state?: { value: ActiveInput };
  /** The pad-count state written (defaults to the exported `connectedPadCount`). */
  padCount?: { value: number };
  showToast?(text: string, durationMs: number): void;
  /** Connect notices (P2a): `standard` false = the non-standard-layout hint. Defaults to showToast. */
  showConnectToast?(text: string, durationMs: number, standard: boolean): void;
  /** The connected-pads list written (defaults to the exported `connectedPads`). */
  pads?: { value: ConnectedPad[] };
  /** Settings > Controls is capturing a binding: pad input goes to it, never to an action. */
  capture?(event: PadEvent): boolean;
  dispatch?(id: ControlActionId, source: InputSource): boolean;
  dispatchAnalog?(stick: 'left' | 'right', x: number, y: number): boolean;
  dispatchHold?(id: ControlActionId, active: boolean, trigger: 'LT' | 'RT'): boolean;
  /** The crosshair stick (P2a; defaults to dispatchPointerStick). */
  dispatchPointerStick?(x: number, y: number): boolean;
  /** P2b: the context presses resolve in (defaults to activeControlContext). */
  context?(): ControlContext | null;
  /** P2b: raw events offered first (defaults to dispatchPadIntercept). */
  intercept?(event: PadEvent): boolean;
  /** Sol r4: whether a camera-stick direction goes to `intercept` (defaults to cameraStickDirectionTaken). */
  cameraDirectionTaken?(event: PadEvent): boolean;
  /** P2b: the held-modifier state written (defaults to the exported `heldModifiers`). */
  modifiers?: { value: { LB: boolean; RT: boolean } };
}
export interface ControllerRouter {
  (event: PadEvent): void;
  /** Fail-safe (Astra review P1): stop a pad camera pan AND end every trigger hold. For disconnect, capture, leaving
   *  controller input and window blur — never for a stick returning to centre (that only stops the pan). */
  neutralise(): void;
}

/** Bare presses that never dispatch: the triggers act through their tap / hold gesture, RT is a chord modifier, and LB
 *  (the chord base) is judged on RELEASE — a plain LB acts only when no chord happened while it was down. */
const DEFERRED_INPUTS = new Set(['LT', 'RT', 'LB']);
const HOLD_INPUT = /^(LT|RT)\(hold\)$/;

/**
 * Routes pad events. Deliberate pad use first updates the active input (auto: a button edge, or a stick held past
 * deadzone + 0.1 for two polls — a resting / drifting stick never switches); then, while the controller is the
 * active input, presses dispatch their bound action(s) and the camera stick drives the camera. Cancelled releases
 * (blur, the floor moving to another pad) are never acted on.
 *
 * Camera fail-safe: once a non-zero stick reached the camera, a neutral {0,0} follows on the stick's own return, a
 * disconnect, a capture swallowing input, or the controller stopping being the active input. Trigger holds are owned
 * per trigger (releasing LT never ends RT's hold) and end on their own release, a cancelled release, or `neutralise`.
 */
export function createControllerRouter(deps: ControllerRouterDeps): ControllerRouter {
  const dispatch = deps.dispatch ?? dispatchControlAction;
  const analog = deps.dispatchAnalog ?? dispatchAnalog;
  const state = deps.state ?? activeInput;
  const padCount = deps.padCount ?? connectedPadCount;
  const pads = deps.pads ?? connectedPads;
  const pointer = deps.dispatchPointerStick ?? dispatchPointerStick;
  let pointerStickLive = false;
  const hold = deps.dispatchHold ?? dispatchControlHold;
  const intercept = deps.intercept ?? dispatchPadIntercept;
  const takesCameraDirection = deps.cameraDirectionTaken ?? cameraStickDirectionTaken;
  const modifiers = deps.modifiers ?? heldModifiers;
  const setModifier = (mod: 'LB' | 'RT', held: boolean): void => {
    if (modifiers.value[mod] !== held) modifiers.value = { ...modifiers.value, [mod]: held };
  };
  const clearModifiers = (): void => { setModifier('LB', false); setModifier('RT', false); };
  let panStick: 'left' | 'right' | null = null;
  const holds = new Map<'LT' | 'RT', ControlActionId>();
  const endHold = (trigger: 'LT' | 'RT'): void => {
    const id = holds.get(trigger);
    if (!id) return;
    holds.delete(trigger);
    hold(id, false, trigger);
  };
  const endAllHolds = (): void => { endHold('LT'); endHold('RT'); };
  const stopPan = (): void => {
    if (!panStick) return;
    const stick = panStick;
    panStick = null;
    analog(stick, 0, 0);
  };
  const stopPointer = (): void => { if (pointerStickLive) { pointerStickLive = false; pointer(0, 0); } };
  const neutralise = (): void => { endAllHolds(); stopPan(); stopPointer(); clearModifiers(); };
  const cameraStick = (): 'left' | 'right' | null => {
    const bound = getBinding(deps.settings, 'cameraPan').controller.primary;
    return bound === 'RightStick' ? 'right' : bound === 'LeftStick' ? 'left' : null;
  };
  const dispatchInput = (input: string): void => {
    for (const id of actionsForInput(deps.settings, 'controller', input, (deps.context ?? activeControlContext)())) if (dispatch(id, 'controller')) break;
  };
  const router = ((event: PadEvent) => {
    if (event.type === 'connected') {
      pads.value = [...pads.value.filter((p) => p.pad !== event.pad), { pad: event.pad, id: event.id, standard: event.standard }];
      const notify = deps.showConnectToast ?? ((text: string, ms: number) => deps.showToast?.(text, ms));
      if (!event.standard) { notify(nonStandardPadToast(event.id), NONSTANDARD_PAD_TOAST_MS, false); return; } // never switches
      padCount.value++;
      if (pads.value.filter((p) => p.standard).length === 1) activePadGlyphFamily.value = padGlyphFamily(event.id);
      notify(controllerConnectToast(event.id), CONTROLLER_CONNECT_TOAST_MS, true);
      return;
    }
    if (event.type === 'press' || (event.type === 'stick' && event.engaged === true)) {
      // The glyph set follows the pad in use (a button, or a stick taking over — Astra P3).
      const pad = pads.value.find((p) => p.pad === event.pad);
      if (pad) activePadGlyphFamily.value = padGlyphFamily(pad.id);
    }
    if (event.type === 'disconnected') {
      const known = pads.value.find((p) => p.pad === event.pad);
      pads.value = pads.value.filter((p) => p.pad !== event.pad);
      if (known && !known.standard) return; // a non-standard pad never counted or drove anything
      padCount.value = Math.max(0, padCount.value - 1);
      neutralise();
      if (state.value === 'controller') deps.showToast?.($t('settings.controls.disconnectToast'), CONTROLLER_TOAST_MS);
      return;
    }
    if (event.type === 'release' && (event.input === 'LB' || event.input === 'RT')) setModifier(event.input, false);
    if (event.type === 'release' && event.cancelled) {
      const held = HOLD_INPUT.exec(event.input);
      if (held) endHold(held[1] as 'LT' | 'RT');
      return; // a forced release never acts (and never counts as use)
    }
    if (deps.capture?.(event)) { neutralise(); return; }
    // Switch first, then route: a button press that switches auto mode is dispatched in the same tick (Astra B1).
    if (event.type === 'press') deps.switcher.padUsed('button');
    else if (event.type === 'stick' && event.engaged === true) deps.switcher.padUsed('stick');
    if (state.value !== 'controller') { neutralise(); return; }
    if (event.type === 'press' && (event.input === 'LB' || event.input === 'RT')) setModifier(event.input, true);
    // P2b: an open server card gets the raw event first (focus ring, A / B / its key bindings).
    // Sol r4: a camera-stick direction goes to the interceptors only when the open focus scope scrolls with it.
    if ((event.type === 'press' || event.type === 'release'
      || (event.type === 'direction' && (event.stick !== cameraStick() || takesCameraDirection(event))))
      && !(event.type !== 'direction' && HOLD_INPUT.test(event.input)) && intercept(event)) return;
    if (event.type === 'release') {
      const held = HOLD_INPUT.exec(event.input);
      if (held) { endHold(held[1] as 'LT' | 'RT'); return; }
      if (event.input === 'LB' && !event.wasModifier) dispatchInput('LB'); // plain LB: no chord happened
      return;
    }
    if (event.type === 'press') {
      if (DEFERRED_INPUTS.has(event.input)) return;
      // A trigger hold drives whatever its tap gesture is bound to, continuously (zoom), until that hold ends.
      const holdOf = HOLD_INPUT.exec(event.input);
      if (holdOf) {
        const trigger = holdOf[1] as 'LT' | 'RT';
        endHold(trigger);
        for (const id of actionsForInput(deps.settings, 'controller', `${trigger}(tap)`)) if (hold(id, true, trigger)) { holds.set(trigger, id); break; }
        return;
      }
      dispatchInput(event.input);
    } else if (event.type === 'stick' && event.stick === cameraStick()) {
      if (event.x === 0 && event.y === 0) { stopPan(); return; } // centring stops the pan only, never a zoom hold
      if (analog(event.stick, event.x, event.y)) panStick = event.stick;
    } else if (event.type === 'stick') {
      // P2a: the other stick moves the pitch crosshair (a neutral stick follows on return / every fail-safe path).
      if (event.x === 0 && event.y === 0) { stopPointer(); return; }
      if (pointer(event.x, event.y)) pointerStickLive = true;
    }
  }) as ControllerRouter;
  router.neutralise = neutralise;
  return router;
}

// --- DOM wiring (mouse / key use + OS cursor) ----------------------------------------------------------------------

export const PAD_CURSOR_HIDDEN_CLASS = 'pad-cursor-hidden';
export function bodyCursorHider(body: HTMLElement): (hidden: boolean) => void {
  return (hidden) => { body.classList.toggle(PAD_CURSOR_HIDDEN_CLASS, hidden); };
}

/** Feeds mouse / keyboard use into the switcher: mousemove beyond 4 px (from where the mouse rested when the pad took
 *  over), mousedown, wheel, keydown. A synthetic mousemove (no movement — what a cursor-style change can fire) never
 *  counts, so hiding the cursor cannot switch back by itself. Returns a dispose function. */
export function trackMouseKeyboardUse(target: Pick<Window, 'addEventListener' | 'removeEventListener'>, switcher: InputSwitcher, state: { value: ActiveInput } = activeInput): () => void {
  let anchor: { x: number; y: number } | null = null;
  const move = (event: Event): void => {
    const e = event as MouseEvent;
    const at = { x: e.clientX, y: e.clientY };
    if (!anchor || state.value !== 'controller') { anchor = at; return; }
    if (e.movementX === 0 && e.movementY === 0) return; // synthetic (cursor restyle / layout), not a hand on the mouse
    if (Math.hypot(at.x - anchor.x, at.y - anchor.y) > MOUSE_SWITCH_DISTANCE_PX) {
      anchor = at;
      switcher.mouseUsed();
    }
  };
  const used = (): void => { switcher.mouseUsed(); };
  const types = ['mousedown', 'wheel', 'keydown'] as const;
  target.addEventListener('mousemove', move, { passive: true, capture: true });
  for (const type of types) target.addEventListener(type, used, { passive: true, capture: true });
  return () => {
    target.removeEventListener('mousemove', move, { capture: true });
    for (const type of types) target.removeEventListener(type, used, { capture: true });
  };

}
