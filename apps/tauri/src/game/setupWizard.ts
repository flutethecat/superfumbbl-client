import type { AppSettings } from './settings';
import { UI_FONTS } from './uiFonts';
import { resolveBlockDieSurface } from '@fumbbl40k/ffb-pitch/src/blockDieSurface';

/**
 * First-launch setup wizard (owner 10-06): the pure step model behind components/FirstLaunchSetup.vue — steps,
 * option ids, the settings each option writes, and the prefill readers — testable without mounting anything.
 *
 * The wizard shows while `settings.setupWizardSeenVersion < SETUP_WIZARD_VERSION`, for EVERY install (new or
 * existing), after the contributions screen. Every choice step is prefilled from the current settings and writes
 * only when an option is SELECTED, so an existing user who just clicks Next through it changes nothing.
 */
export const SETUP_WIZARD_VERSION = 1;

/** A pack activation (switching a slot back to built-in) that has not settled after this long releases the wizard's
 *  pick lock: the pick is abandoned and superseded, nothing is written, and the user may try again. */
export const PACK_SWITCH_TIMEOUT_MS = 15_000;

export type SetupStepId =
  | 'font'
  | 'leftClick'
  | 'blitz'
  | 'blockDice'
  | 'blockDiceSurface'
  | 'diceColour'
  | 'skills'
  | 'stadium'
  | 'orientation'
  | 'login'
  | 'homeLogin'
  | 'modPacks'
  | 'fineTuning';

/** Settings a wizard option may write (the subset the step model touches). */
export type SetupSettings = Pick<AppSettings,
  | 'uiFont'
  | 'leftClickOpensContextMenu'
  | 'declareBlitzBehavior'
  | 'blockDiceFamily'
  | 'blockDiceSurface'
  | 'd6FaceVariant'
  | 'skillDisplay'
  | 'skillBadgeFamily'
  | 'showStadium'
  | 'pitchOrientation'
  | 'assetPackAssignments'>;

export interface SetupOption {
  id: string;
  title: string;
  /** Owner copy, verbatim. Absent when the spec gives none. */
  description?: string;
  /** Image keys under src/assets/onboarding/ (file name without `.png`). A missing file renders nothing. */
  images: readonly string[];
  /** A row of the six real d6 faces of this variant (drawn from @fumbbl40k/ffb-pitch's d6FaceUrl, not a screenshot). */
  d6Variant?: AppSettings['d6FaceVariant'];
  /** A row of the five block-die faces of the CURRENTLY chosen family composed on this surface (the same composed art
   *  the dice use — PitchRenderer.prepareBlockFaces / bundledBlockFaceUrls), not a screenshot. */
  blockSurface?: 'black' | 'white';
  /** A sample block rendered in this CSS font stack (the Font step; the same stacks App.vue applies as --ui-font). */
  fontStack?: string;
  /** The plain setting writes this option makes when selected. */
  writes: Partial<SetupSettings>;
  /** Asset-pack slot to clear to '' (built-in) when chosen, mirroring AssetPackSettings.changeAssignment's
   *  built-in path — a selected pack would otherwise keep winning over the family the user just picked. */
  clearsAssignment?: 'blockDice' | 'skillIcons';
}

export type SetupStepKind = 'choice' | 'login' | 'homeLogin' | 'modPacks' | 'fineTuning';

export interface SetupStep {
  id: SetupStepId;
  kind: SetupStepKind;
  title: string;
  lede: string;
  options?: readonly SetupOption[];
  /** Which option the current settings correspond to (null = none of them, e.g. an installed pack is in use). */
  prefill?: (s: SetupSettings) => string | null;
}

const DICE_FACES = ['skull', 'bothdown', 'push', 'powpush', 'pow'] as const;

/** The Font step's sample block (owner 10-06 copy). */
export const FONT_SAMPLE = {
  title: 'Super FUMBBL',
  sentence: 'Blitz the ball carrier and run it in for the touchdown.',
  digits: '0 1 2 3 4 5 6 7 8 9',
} as const;

export const SETUP_STEPS: readonly SetupStep[] = [
  {
    id: 'font',
    kind: 'choice',
    title: 'Font',
    lede: "Choose the typeface for the client's menus and panels.",
    options: [
      { id: 'nuffle', title: 'Nuffle (Default)', images: [], fontStack: UI_FONTS.nuffle, writes: { uiFont: 'nuffle' } },
      { id: 'system', title: 'System', images: [], fontStack: UI_FONTS.system, writes: { uiFont: 'system' } },
      { id: 'arial', title: 'Arial', images: [], fontStack: UI_FONTS.arial, writes: { uiFont: 'arial' } },
    ],
    prefill: (s) => (s.uiFont === 'system' || s.uiFont === 'arial' ? s.uiFont : 'nuffle'),
  },
  {
    id: 'leftClick',
    kind: 'choice',
    title: 'Left click behavior',
    lede: 'Choose what a left click on one of your players does.',
    options: [
      { id: 'modern', title: 'Modern (Default)', description: 'Left click declares move to start', images: ['click-modern'], writes: { leftClickOpensContextMenu: false } },
      { id: 'fumbbl', title: 'FUMBBL Original', description: 'Left click opens context menu', images: ['click-fumbbl'], writes: { leftClickOpensContextMenu: true } },
    ],
    prefill: (s) => (s.leftClickOpensContextMenu ? 'fumbbl' : 'modern'),
  },
  {
    id: 'blitz',
    kind: 'choice',
    title: 'Blitz behavior',
    lede: 'Choose how a blitz is declared.',
    options: [
      {
        id: 'menu',
        title: 'Blitz must be declared from context menu (Default)',
        description: 'To declare a blitz the user must first declare blitz and then select their target.',
        images: ['blitz-menu'],
        writes: { declareBlitzBehavior: 'fumbbl' },
      },
      { id: 'click', title: 'Blitz can be declared using left clicks', images: ['blitz-click'], writes: { declareBlitzBehavior: 'modern' } },
    ],
    prefill: (s) => (s.declareBlitzBehavior === 'modern' ? 'click' : 'menu'),
  },
  {
    id: 'blockDice',
    kind: 'choice',
    title: 'Block dice',
    lede: 'Choose the faces drawn on your block dice.',
    options: [
      { id: 'default', title: 'Super FUMBBL Default', images: DICE_FACES.map((f) => `dice-default-${f}`), writes: { blockDiceFamily: 'default' }, clearsAssignment: 'blockDice' },
      { id: 'krisb', title: 'Kristofer B dice', images: DICE_FACES.map((f) => `dice-krisb-${f}`), writes: { blockDiceFamily: 'krisb' }, clearsAssignment: 'blockDice' },
    ],
    // An installed block-dice pack wins over either family, so neither card is "current" while one is assigned.
    prefill: (s) => (s.assetPackAssignments.blockDice ? null : s.blockDiceFamily === 'krisb' ? 'krisb' : 'default'),
  },
  {
    // Owner 10-06: "the user should be able to select their Block die face type as well as whether it's on a white or
    // a black surface. Add that to the wizard." Right after the family pick; the previews follow that pick.
    id: 'blockDiceSurface',
    kind: 'choice',
    title: 'Block die surface',
    lede: "Choose whether your block dice sit on black or white. Your face set's default is preselected.",
    // Titles carry no "(Default)": setupOptionTitle appends it to the face set's own surface (the 'auto' resolution).
    options: [
      { id: 'black', title: 'Black', images: [], blockSurface: 'black', writes: { blockDiceSurface: 'black' } },
      { id: 'white', title: 'White', images: [], blockSurface: 'white', writes: { blockDiceSurface: 'white' } },
    ],
    // Owner 10-06 follow-up: the preselected card is the RESOLVED surface for the family picked on the previous step
    // ('auto' = per face set); leaving the step without a pick writes nothing, so 'auto' stays.
    prefill: (s) => resolveBlockDieSurface(s.blockDiceFamily, s.blockDiceSurface),
  },
  {
    // Owner 10-06 follow-up. Labels match Settings > Dice's mapping: the legacy 'black' key is the WHITE face set.
    id: 'diceColour',
    kind: 'choice',
    title: 'Dice colour',
    lede: 'Choose the colour of the rolling dice.',
    options: [
      { id: 'black', title: 'Black (Default)', images: [], d6Variant: 'brushed-metal', writes: { d6FaceVariant: 'brushed-metal' } },
      { id: 'white', title: 'White', images: [], d6Variant: 'black', writes: { d6FaceVariant: 'black' } },
    ],
    prefill: (s) => (s.d6FaceVariant === 'black' ? 'white' : 'black'),
  },
  {
    id: 'skills',
    kind: 'choice',
    title: 'Skill icons vs skill markings',
    lede: 'Choose how player skills are shown on the pitch.',
    options: [
      { id: 'icons', title: 'Skill Icons · Illustrated (Default)', images: [], writes: { skillDisplay: 'icons', skillBadgeFamily: 'illustrated' }, clearsAssignment: 'skillIcons' },
      { id: 'markings', title: 'Skill Markings · FUMBBL', images: ['markings-fumbbl'], writes: { skillDisplay: 'markings' } },
    ],
    prefill: (s) => {
      if (s.skillDisplay === 'markings') return 'markings';
      // Icons with the flat family or a skill-icon pack is neither card.
      return s.skillBadgeFamily === 'illustrated' && !s.assetPackAssignments.skillIcons ? 'icons' : null;
    },
  },
  {
    id: 'stadium',
    kind: 'choice',
    title: 'Stadium',
    lede: 'Choose whether the pitch sits in a crowded stadium.',
    options: [
      {
        id: 'on',
        title: 'On (Default)',
        description: "The number of spectators is dynamically generated for both Home and Away teams. Spectators will say quips when events happen and you'll see signs being held by them calling out prominent members of the community.",
        images: ['stadium-on'],
        writes: { showStadium: true },
      },
      { id: 'off', title: 'Off', description: 'No stadium, a more minimalist look.', images: ['stadium-off'], writes: { showStadium: false } },
    ],
    prefill: (s) => (s.showStadium ? 'on' : 'off'),
  },
  {
    id: 'orientation',
    kind: 'choice',
    title: 'Orientation',
    lede: 'Choose which way the pitch runs on your screen.',
    options: [
      {
        id: 'ns',
        title: 'North-South (Default)',
        description: "You'll always be on the south end of the pitch whether defending or attacking. In spectator mode, offensive drives will always drive to the north.",
        images: ['orientation-ns'],
        writes: { pitchOrientation: 'ns' },
      },
      {
        id: 'ew',
        title: 'East-West',
        description: "Play travels from East to West. You'll always play on the left side of the pitch and offense will always drive to the right in spectator mode.",
        images: ['orientation-ew'],
        writes: { pitchOrientation: 'ew' },
      },
    ],
    prefill: (s) => (s.pitchOrientation === 'ew' ? 'ew' : 'ns'),
  },
  {
    id: 'login',
    kind: 'login',
    title: 'FUMBBL login',
    lede: 'Enter your FUMBBL logins. This enables you to join games on FUMBBL.',
  },
  {
    id: 'homeLogin',
    kind: 'homeLogin',
    title: 'Sign in on the Home pane',
    lede: 'Sign in to fumbbl.com in the Home pane to join games with one click.',
  },
  {
    id: 'modPacks',
    kind: 'modPacks',
    title: 'Install mod packs',
    lede: "If you have any mod packs that your friends have provided or you've found online, you can import them here.",
  },
  {
    id: 'fineTuning',
    kind: 'fineTuning',
    title: 'Fine tuning',
    lede: 'A few last touches. Everything here can be changed later in Settings.',
  },
];

/** The steps actually shown: "Sign in on the Home pane" only when the host provides a Home pane. */
export function visibleSetupSteps(opts: { hasHomeLogin: boolean }): SetupStep[] {
  return SETUP_STEPS.filter((step) => step.id !== 'homeLogin' || opts.hasHomeLogin);
}

export function setupStep(id: SetupStepId): SetupStep {
  const step = SETUP_STEPS.find((candidate) => candidate.id === id);
  if (!step) throw new Error(`Unknown setup step ${id}`);
  return step;
}

export function setupOption(stepId: SetupStepId, optionId: string): SetupOption {
  const option = setupStep(stepId).options?.find((candidate) => candidate.id === optionId);
  if (!option) throw new Error(`Unknown option ${optionId} for setup step ${stepId}`);
  return option;
}

/** The title a card shows. Block die surface (owner 10-06): " (Default)" is appended to the card that is the chosen
 *  face set's own surface (resolveBlockDieSurface(family, 'auto')) — Black for Super FUMBBL, White for KrisB. */
export function setupOptionTitle(stepId: SetupStepId, option: SetupOption, s: SetupSettings): string {
  if (stepId === 'blockDiceSurface' && option.id === resolveBlockDieSurface(s.blockDiceFamily, 'auto')) return `${option.title} (Default)`;
  return option.title;
}

export function prefillSetupOption(stepId: SetupStepId, s: SetupSettings): string | null {
  return setupStep(stepId).prefill?.(s) ?? null;
}

/**
 * The asset-pack slot that must be switched back to built-in (through the pack-activation path) BEFORE this option's
 * settings are written, or null when nothing is assigned there. Mirrors AssetPackSettings.changeAssignment: activate
 * first, and only on success touch the family — a failed activation leaves the family and the selection alone.
 */
export function setupOptionAssignmentToClear(stepId: SetupStepId, optionId: string, s: SetupSettings): 'blockDice' | 'skillIcons' | null {
  const slot = setupOption(stepId, optionId).clearsAssignment;
  return slot && s.assetPackAssignments[slot] ? slot : null;
}

/** Write an option's plain settings onto `s` immediately (Back/Next never loses a choice). */
export function applySetupOption(stepId: SetupStepId, optionId: string, s: SetupSettings): void {
  Object.assign(s, setupOption(stepId, optionId).writes);
}

export function setupWizardNeeded(seenVersion: number): boolean {
  return seenVersion < SETUP_WIZARD_VERSION;
}

/** Finish: mark this wizard revision seen and the first run complete (the caller flushes the settings file). */
export function completeSetupWizard(s: Pick<AppSettings, 'setupWizardSeenVersion' | 'completedFirstRun'>): void {
  s.setupWizardSeenVersion = SETUP_WIZARD_VERSION;
  s.completedFirstRun = true;
}
