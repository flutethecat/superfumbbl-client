import type { AppSettings } from './settings';
import { UI_FONTS } from './uiFonts';
import { resolveBlockDieSurface } from '@fumbbl40k/ffb-pitch/src/blockDieSurface';
import { DEFAULT_LOCALE, availableLocales, englishVariantOf, systemLanguageTags, t, type Locale } from '../i18n';

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
  | 'language'
  | 'font'
  | 'leftClick'
  | 'blitz'
  | 'blockDice'
  | 'blockDiceSurface'
  | 'diceColour'
  | 'skills'
  | 'stadium'
  | 'orientation'
  | 'logStyle'
  | 'controls'
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
  | 'assetPackAssignments'
  | 'language'
  | 'languageChosen'
  | 'logStyle'
  | 'controlLayer'
  | 'fumbblShortcuts'>;

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
   *  the dice use — PitchRenderer.prepareBlockFaces / bundledBlockFaceUrls), not a screenshot. 'team' (owner 10-15,
   *  Home / Away) shows two rows: the blue home set and the red away set. */
  blockSurface?: 'black' | 'white' | 'team';
  /** The Language step: the BCP 47 tag of this option's own name (its `lang` attribute, so each name renders in its script). */
  lang?: string;
  /** The Log style step: a static example of the same log moment in this style (components/SetupLogStylePreview.vue,
   *  the real log row helpers and components over fixture rows). */
  logStylePreview?: AppSettings['logStyle'];
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
  get title() { return t('setupWizard.fontSample.superFumbbl'); },
  get sentence() { return t('setupWizard.fontSample.blitzTheBallCarrier'); },
  digits: '0 1 2 3 4 5 6 7 8 9',
} as const;

/**
 * Owner 10-23: the system language mapped onto our locales - the first of the user's preferred tags that maps wins:
 * an exact tag (case-insensitive), then its base language; Chinese -> zh-Hans; Serbian -> sr-Cyrl unless the tag names
 * the Latin script. Nothing maps -> English, `matched: false` (the panel says the system language is not available).
 * Traditional Chinese (zh-Hant, zh-TW, zh-HK, zh-MO) maps to Simplified as a FALLBACK (`fallback: true`): the panel
 * names it the closest available language, never "detected".
 * Owner 11-03: an English tag picks the English variant by region (i18n/englishVariant.ts): en-GB / en-IE / en-AU /
 * en-NZ / en-ZA and the other British-spelling regions -> English (UK), every other English tag -> English (US).
 */
export interface DetectedLocale { locale: Locale; matched: boolean; fallback: boolean; tag: string }
export function detectSystemLocale(tags: readonly (string | null | undefined)[]): DetectedLocale {
  const clean = tags.map((tag) => (typeof tag === 'string' ? tag.trim().replace(/_/g, '-') : '')).filter(Boolean);
  for (const tag of clean) {
    const lower = tag.toLowerCase();
    const english = englishVariantOf(tag);
    if (english) return { locale: english, matched: true, fallback: false, tag };
    const exact = availableLocales.find((l) => l.id.toLowerCase() === lower);
    if (exact) return { locale: exact.id, matched: true, fallback: false, tag };
    const parts = lower.split('-');
    const base = parts[0]!;
    if (base === 'zh') {
      const traditional = !parts.includes('hans') && (parts.includes('hant') || parts.some((p) => p === 'tw' || p === 'hk' || p === 'mo'));
      return { locale: 'zh-Hans', matched: true, fallback: traditional, tag };
    }
    if (base === 'sr') return { locale: parts.includes('latn') ? 'sr-Latn' : 'sr-Cyrl', matched: true, fallback: false, tag };
    const byBase = availableLocales.find((l) => l.id.toLowerCase() === base);
    if (byBase) return { locale: byBase.id, matched: true, fallback: false, tag };
  }
  return { locale: DEFAULT_LOCALE, matched: false, fallback: false, tag: clean[0] ?? '' };
}
/** The browser's preferred language tags (moved to i18n/englishVariant.ts; re-exported for existing callers). */
export { systemLanguageTags };
/**
 * The language the wizard switches to on open: the detected one ONLY on a brand-new install (`freshInstall`: nothing was
 * stored before this launch - settingsProvenance) whose language nobody has picked yet, so the very first panel already
 * reads in the system language. Anything else returns null and the panel just preselects the current setting: a re-run,
 * a relaunch after quitting mid-wizard (the settings now exist), an existing install, an explicit pick (English too).
 */
export function initialSetupLocale(s: Pick<AppSettings, 'language' | 'languageChosen' | 'setupWizardSeenVersion'>, detected: DetectedLocale, freshInstall: boolean): Locale | null {
  if (!freshInstall || s.languageChosen || !setupWizardNeeded(s.setupWizardSeenVersion) || s.language !== DEFAULT_LOCALE) return null;
  return detected.locale !== s.language ? detected.locale : null;
}

export const SETUP_STEPS: readonly SetupStep[] = [
  {
    // Owner 10-23: the VERY FIRST panel. Each language is named in its own language (the Settings dropdown's labels);
    // picking one writes settings.language, which main.ts applies live, so this panel and every later one re-render.
    id: 'language',
    kind: 'choice',
    get title() { return t('settings.language.label'); },
    get lede() { return t('setupWizard.language.lede'); },
    // A pick is explicit (Astra r1): it also sets languageChosen, so the system language never overrides it later.
    options: availableLocales.map((l) => ({ id: l.id, title: l.name, lang: l.id, images: [], writes: { language: l.id, languageChosen: true } })),
    prefill: (s) => s.language,
  },
  {
    id: 'font',
    kind: 'choice',
    get title() { return t('setupWizard.setupSteps.font'); },
    get lede() { return t('setupWizard.setupSteps.chooseTheTypefaceFor'); },
    options: [
      { id: 'nuffle', get title() { return t('setupWizard.setupSteps.nuffleDefault'); }, images: [], fontStack: UI_FONTS.nuffle, writes: { uiFont: 'nuffle' } },
      { id: 'system', get title() { return t('setupWizard.setupSteps.system'); }, images: [], fontStack: UI_FONTS.system, writes: { uiFont: 'system' } },
      { id: 'arial', get title() { return t('setupWizard.setupSteps.arial'); }, images: [], fontStack: UI_FONTS.arial, writes: { uiFont: 'arial' } },
    ],
    prefill: (s) => (s.uiFont === 'system' || s.uiFont === 'arial' ? s.uiFont : 'nuffle'),
  },
  {
    id: 'leftClick',
    kind: 'choice',
    get title() { return t('setupWizard.setupSteps.leftClickBehavior'); },
    get lede() { return t('setupWizard.setupSteps.chooseWhatALeft'); },
    options: [
      { id: 'modern', get title() { return t('setupWizard.setupSteps.modernDefault'); }, get description() { return t('setupWizard.setupSteps.leftClickDeclaresMove'); }, images: ['click-modern'], writes: { leftClickOpensContextMenu: false } },
      { id: 'fumbbl', get title() { return t('setupWizard.setupSteps.fumbblOriginal'); }, get description() { return t('setupWizard.setupSteps.leftClickOpensContext'); }, images: ['click-fumbbl'], writes: { leftClickOpensContextMenu: true } },
    ],
    prefill: (s) => (s.leftClickOpensContextMenu ? 'fumbbl' : 'modern'),
  },
  {
    id: 'blitz',
    kind: 'choice',
    get title() { return t('setupWizard.setupSteps.blitzBehavior'); },
    get lede() { return t('setupWizard.setupSteps.chooseHowABlitz'); },
    options: [
      {
        id: 'menu',
        get title() { return t('setupWizard.setupSteps.blitzMustBeDeclared'); },
        get description() { return t('setupWizard.setupSteps.toDeclareABlitz'); },
        images: ['blitz-menu'],
        writes: { declareBlitzBehavior: 'fumbbl' },
      },
      { id: 'click', get title() { return t('setupWizard.setupSteps.blitzCanBeDeclared'); }, images: ['blitz-click'], writes: { declareBlitzBehavior: 'modern' } },
    ],
    prefill: (s) => (s.declareBlitzBehavior === 'modern' ? 'click' : 'menu'),
  },
  {
    id: 'blockDice',
    kind: 'choice',
    get title() { return t('setupWizard.setupSteps.blockDice'); },
    get lede() { return t('setupWizard.setupSteps.chooseTheFacesDrawn'); },
    options: [
      { id: 'default', get title() { return t('setupWizard.setupSteps.superFumbblDefault'); }, images: DICE_FACES.map((f) => `dice-default-${f}`), writes: { blockDiceFamily: 'default' }, clearsAssignment: 'blockDice' },
      { id: 'krisb', get title() { return t('setupWizard.setupSteps.rickDice'); }, images: DICE_FACES.map((f) => `dice-krisb-${f}`), writes: { blockDiceFamily: 'krisb' }, clearsAssignment: 'blockDice' },
      // Owner 11-04: WhatBall's FUMBBL block dice (used with permission).
      { id: 'fumbbl', get title() { return t('setupWizard.setupSteps.fumbblDice'); }, images: DICE_FACES.map((f) => `dice-fumbbl-${f}`), writes: { blockDiceFamily: 'fumbbl' }, clearsAssignment: 'blockDice' },
    ],
    // An installed block-dice pack wins over either family, so neither card is "current" while one is assigned.
    prefill: (s) => (s.assetPackAssignments.blockDice ? null : s.blockDiceFamily === 'krisb' || s.blockDiceFamily === 'fumbbl' ? s.blockDiceFamily : 'default'),
  },
  {
    // Owner 10-06: "the user should be able to select their Block die face type as well as whether it's on a white or
    // a black surface. Add that to the wizard." Right after the family pick; the previews follow that pick.
    id: 'blockDiceSurface',
    kind: 'choice',
    get title() { return t('setupWizard.setupSteps.blockDieSurface'); },
    get lede() { return t('setupWizard.setupSteps.chooseWhetherYourBlock'); },
    // Titles carry no "(Default)": setupOptionTitle appends it to the face set's own surface (the 'auto' resolution).
    options: [
      { id: 'black', get title() { return t('setupWizard.setupSteps.black'); }, images: [], blockSurface: 'black', writes: { blockDiceSurface: 'black' } },
      { id: 'white', get title() { return t('setupWizard.setupSteps.white'); }, images: [], blockSurface: 'white', writes: { blockDiceSurface: 'white' } },
      // Owner 10-15: the same setting Settings > Art > Dice offers as "Brushed metal, home and away" ('team').
      { id: 'team', get title() { return t('setupWizard.setupSteps.homeAway'); }, get description() { return t('setupWizard.setupSteps.blueForTheHome'); }, images: [], blockSurface: 'team', writes: { blockDiceSurface: 'team' } },
    ],
    // Owner 10-06 follow-up: the preselected card is the RESOLVED surface for the family picked on the previous step
    // ('auto' = per face set); leaving the step without a pick writes nothing, so 'auto' stays.
    // 'team' must be read first: resolveBlockDieSurface without a die side falls back to the face set's own surface.
    prefill: (s) => (s.blockDiceSurface === 'team' ? 'team' : resolveBlockDieSurface(s.blockDiceFamily, s.blockDiceSurface)),
  },
  {
    // Owner 10-06 follow-up. Labels match Settings > Dice's mapping: the legacy 'black' key is the WHITE face set.
    id: 'diceColour',
    kind: 'choice',
    get title() { return t('setupWizard.setupSteps.diceColour'); },
    get lede() { return t('setupWizard.setupSteps.chooseTheColourOf'); },
    options: [
      { id: 'black', get title() { return t('setupWizard.setupSteps.blackDefault'); }, images: [], d6Variant: 'brushed-metal', writes: { d6FaceVariant: 'brushed-metal' } },
      { id: 'white', get title() { return t('setupWizard.setupSteps.white'); }, images: [], d6Variant: 'black', writes: { d6FaceVariant: 'black' } },
      // Owner 10-15: Settings > Art > Dice "Brushed metal, home and away".
      { id: 'team', get title() { return t('setupWizard.setupSteps.homeAway'); }, get description() { return t('setupWizard.setupSteps.blueForTheHome'); }, images: [], d6Variant: 'team', writes: { d6FaceVariant: 'team' } },
    ],
    prefill: (s) => (s.d6FaceVariant === 'team' ? 'team' : s.d6FaceVariant === 'black' ? 'white' : 'black'),
  },
  {
    id: 'skills',
    kind: 'choice',
    get title() { return t('setupWizard.setupSteps.skillIconsVsSkill'); },
    get lede() { return t('setupWizard.setupSteps.chooseHowPlayerSkills'); },
    options: [
      { id: 'icons', get title() { return t('setupWizard.setupSteps.skillIconsIllustratedDefault'); }, images: [], writes: { skillDisplay: 'icons', skillBadgeFamily: 'illustrated' }, clearsAssignment: 'skillIcons' },
      { id: 'markings', get title() { return t('setupWizard.setupSteps.skillMarkingsFumbbl'); }, images: ['markings-fumbbl'], writes: { skillDisplay: 'markings' } },
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
    get title() { return t('setupWizard.setupSteps.stadium'); },
    get lede() { return t('setupWizard.setupSteps.chooseWhetherThePitch'); },
    options: [
      {
        id: 'on',
        get title() { return t('setupWizard.setupSteps.onDefault'); },
        get description() { return t('setupWizard.setupSteps.theNumberOfSpectators'); },
        images: ['stadium-on'],
        writes: { showStadium: true },
      },
      { id: 'off', get title() { return t('setupWizard.setupSteps.off'); }, get description() { return t('setupWizard.setupSteps.noStadiumAMore'); }, images: ['stadium-off'], writes: { showStadium: false } },
    ],
    prefill: (s) => (s.showStadium ? 'on' : 'off'),
  },
  {
    id: 'orientation',
    kind: 'choice',
    get title() { return t('setupWizard.setupSteps.orientation'); },
    get lede() { return t('setupWizard.setupSteps.chooseWhichWayThe'); },
    options: [
      {
        id: 'ns',
        get title() { return t('setupWizard.setupSteps.northSouthDefault'); },
        get description() { return t('setupWizard.setupSteps.youLlAlwaysBe'); },
        images: ['orientation-ns'],
        writes: { pitchOrientation: 'ns' },
      },
      {
        id: 'ew',
        get title() { return t('setupWizard.setupSteps.eastWest'); },
        get description() { return t('setupWizard.setupSteps.playTravelsFromEast'); },
        images: ['orientation-ew'],
        writes: { pitchOrientation: 'ew' },
      },
    ],
    prefill: (s) => (s.pitchOrientation === 'ew' ? 'ew' : 'ns'),
  },
  {
    // Owner 10-23: the last display choice, before the account steps. Labels and the Graphical / FUMBBL descriptions
    // are Settings > Display > Log's own; each card shows the same log moment in that style.
    id: 'logStyle',
    kind: 'choice',
    get title() { return t('settings.display.log.logStyle'); },
    get lede() { return t('setupWizard.logStyle.lede'); },
    options: [
      { id: 'text', get title() { return t('settings.display.log.text'); }, get description() { return t('setupWizard.logStyle.textDescription'); }, images: [], logStylePreview: 'text', writes: { logStyle: 'text' } },
      { id: 'graphical', get title() { return t('settings.display.log.graphical'); }, get description() { return t('settings.display.log.graphicalEachLineIs'); }, images: [], logStylePreview: 'graphical', writes: { logStyle: 'graphical' } },
      { id: 'fumbbl', get title() { return t('settings.display.log.fumbbl'); }, get description() { return t('settings.display.log.theFumbblClientS'); }, images: [], logStylePreview: 'fumbbl', writes: { logStyle: 'fumbbl' } },
    ],
    prefill: (s) => (s.logStyle === 'graphical' || s.logStyle === 'fumbbl' ? s.logStyle : 'text'),
  },
  {
    // FUMBBL Controls (owner 11-03, spec §6): the control layer, after Log Style. Super FUMBBL Controls is preselected;
    // choosing FUMBBL Controls shows the "Also use FUMBBL keyboard shortcuts" checkbox (unchecked) - FirstLaunchSetup.vue.
    // No one-time prompt for existing players (owner 11-03): the wizard version is unchanged.
    id: 'controls',
    kind: 'choice',
    get title() { return t('setupWizard.controls.title'); },
    get lede() { return t('setupWizard.controls.lede'); },
    options: [
      { id: 'super', get title() { return t('setupWizard.controls.super'); }, get description() { return t('setupWizard.controls.superDescription'); }, images: [], writes: { controlLayer: 'super' } },
      { id: 'fumbbl', get title() { return t('setupWizard.controls.fumbbl'); }, get description() { return t('setupWizard.controls.fumbblDescription'); }, images: [], writes: { controlLayer: 'fumbbl' } },
    ],
    prefill: (s) => (s.controlLayer === 'fumbbl' ? 'fumbbl' : 'super'),
  },
  {
    id: 'login',
    kind: 'login',
    get title() { return t('setupWizard.setupSteps.fumbblLogin'); },
    get lede() { return t('setupWizard.setupSteps.enterYourFumbblLogins'); },
  },
  {
    id: 'homeLogin',
    kind: 'homeLogin',
    get title() { return t('setupWizard.setupSteps.signInOnFumbbl'); },
    get lede() { return t('setupWizard.setupSteps.signInOnFumbbl2'); },
  },
  {
    id: 'modPacks',
    kind: 'modPacks',
    get title() { return t('setupWizard.setupSteps.installModPacks'); },
    get lede() { return t('setupWizard.setupSteps.ifYouHaveAny'); },
  },
  {
    id: 'fineTuning',
    kind: 'fineTuning',
    get title() { return t('setupWizard.setupSteps.fineTuning'); },
    get lede() { return t('setupWizard.setupSteps.aFewLastTouches'); },
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
 *  face set's own surface (resolveBlockDieSurface(family, 'auto')) — Black for Super FUMBBL and FUMBBL, White for KrisB. */
export function setupOptionTitle(stepId: SetupStepId, option: SetupOption, s: SetupSettings): string {
  if (stepId === 'blockDiceSurface' && option.id === resolveBlockDieSurface(s.blockDiceFamily, 'auto')) return t('setupWizard.text.titleDefault', { title: option.title });
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
