import { playerHasSkill, type GameJson } from '@fumbbl40k/ffb-protocol';
import { playerServerSide, teamServerSide, type ServerSide } from '@fumbbl40k/ffb-pitch';
/** Owner 10-16: the jump of a Pogo player is a 'pogo', of a Leap player a 'leap', else a 'jump'. */
export function jumpKindFor(game: GameJson | null, playerId: unknown): 'jump' | 'leap' | 'pogo' {
  const id = String(playerId ?? '');
  const player = game && id ? [...game.teamHome.playerArray, ...game.teamAway.playerArray].find((p) => String(p.playerId) === id) : null;
  if (!player) return 'jump';
  if (playerHasSkill(player, 'Pogo') || playerHasSkill(player, 'Pogo Stick')) return 'pogo'; // Astra 10-19: BB2020 spells it 'Pogo Stick'
  if (playerHasSkill(player, 'Leap')) return 'leap';
  return 'jump';
}

/**
 * Owner 10-15 (Settings > Display > Log > Log style "Graphical"): each match-log line is a row whose left cell shows the
 * bare icon of the action the line belongs to (the art the pitch already uses, see LogActionPlate.vue), preceded by the
 * icon of the reroll source when the line is a reroll, and whose background is tinted with the acting team's colour.
 *
 * Decided at FORMAT time from the report the line came from, never by re-reading the line's text:
 *   kind   - the action icon (null = no action icon; the cell stays empty so the text aligns);
 *   side   - the SERVER side of the acting team (null = no single owning team -> a neutral row); the view maps it to the
 *            displayed side exactly like the log dice (displayDiceSide: the local coach is home/blue while playing,
 *            native home/away for spectators and replays);
 *   source - the reroll source that actually provided this line's reroll, as the server named it ("Team ReRoll",
 *            "Pro", "Team Mascot", "Brawler", ...); absent when the line is not a reroll.
 */
/**
 * Owner 10-15 ("wherever possible, use an emoji to indicate the type of action"): THE icon table - one entry per action
 * icon the Graphical log's left column can show. `art` = pitch / resource art (LogActionPlate.vue resolves the file),
 * `skill` = the skill icon from the active skill icon family, `emoji` = an emoji, `ko` = the dugout-label KO lettering.
 * `label` is the icon's tooltip. Swap any entry here; the report -> icon mapping is REPORT_ACTION_KIND below.
 */
export const LOG_ACTION_ICONS = {
  // pitch / resource art
  move: { icon: { type: 'art', art: 'move' }, label: 'Move' }, // owner 10-16: the declaration line ("starts a Move action.")
  block: { icon: { type: 'art', art: 'block' }, label: 'Block' },
  pass: { icon: { type: 'art', art: 'pass' }, label: 'Pass' },
  handoff: { icon: { type: 'art', art: 'handoff' }, label: 'Hand-off' },
  foul: { icon: { type: 'art', art: 'foul' }, label: 'Foul' },
  catch: { icon: { type: 'art', art: 'catch' }, label: 'Catch' },
  dodge: { icon: { type: 'art', art: 'dodge' }, label: 'Dodge' },
  rush: { icon: { type: 'art', art: 'rush' }, label: 'Rush' },
  pickup: { icon: { type: 'art', art: 'pickup' }, label: 'Pick-up' },
  reroll: { icon: { type: 'art', art: 'reroll' }, label: 'Reroll' },
  mascot: { icon: { type: 'art', art: 'mascot' }, label: 'Team Mascot' },
  apothecary: { icon: { type: 'art', art: 'apothecary' }, label: 'Apothecary' },
  // skill icons (active skill icon family)
  bloodlust: { icon: { type: 'skill', skill: 'Bloodlust' }, label: 'Bloodlust' },
  gaze: { icon: { type: 'skill', skill: 'Hypnotic Gaze' }, label: 'Hypnotic Gaze' },
  foulAppearance: { icon: { type: 'skill', skill: 'Foul Appearance' }, label: 'Foul Appearance' },
  animosity: { icon: { type: 'skill', skill: 'Animosity' }, label: 'Animosity' },
  steadyFooting: { icon: { type: 'skill', skill: 'Steady Footing' }, label: 'Steady Footing' },
  teamCaptain: { icon: { type: 'skill', skill: 'Team Captain' }, label: 'Team Captain' },
  gettingEven: { icon: { type: 'skill', skill: 'Hatred' }, label: 'Getting Even' },
  chainsaw: { icon: { type: 'skill', skill: 'Chainsaw' }, label: 'Chainsaw' },
  // the dugout-label KO lettering
  ko: { icon: { type: 'ko' }, label: 'Knocked out' },
  // emoji
  breatheFire: { icon: { type: 'emoji', emoji: '\u{1F525}' }, label: 'Breathe Fire' },
  vomit: { icon: { type: 'emoji', emoji: '\u{1F92E}' }, label: 'Projectile Vomit' },
  coin: { icon: { type: 'emoji', emoji: '\u{1FA99}' }, label: 'Coin toss' },
  kickoff: { icon: { type: 'emoji', emoji: '\u{1F4E3}' }, label: 'Kick-off event' },
  kickoffScatter: { icon: { type: 'emoji', emoji: '\u{1F3AF}' }, label: 'Kick-off scatter' },
  weather: { icon: { type: 'emoji', emoji: '\u{1F326}\u{FE0F}' }, label: 'Weather' },
  throwARock: { icon: { type: 'emoji', emoji: '\u{1FAA8}' }, label: 'Throw a Rock' },
  dodgySnack: { icon: { type: 'emoji', emoji: '\u{1F32D}' }, label: 'Dodgy Snack' },
  brilliantCoaching: { icon: { type: 'emoji', emoji: '\u{1F9E0}' }, label: 'Brilliant Coaching' },
  kickoffBlitz: { icon: { type: 'emoji', emoji: '\u{26A1}' }, label: 'Blitz!' },
  quickSnap: { icon: { type: 'emoji', emoji: '\u{1F3C3}' }, label: 'Quick Snap' },
  solidDefence: { icon: { type: 'emoji', emoji: '\u{1F6E1}\u{FE0F}' }, label: 'Solid Defence' },
  timeout: { icon: { type: 'emoji', emoji: '\u{23F1}\u{FE0F}' }, label: 'Time-out' },
  halfStart: { icon: { type: 'emoji', emoji: '\u{1F514}' }, label: 'Half start' },
  touchdown: { icon: { type: 'emoji', emoji: '\u{1F3C6}' }, label: 'Touchdown' },
  turnEnd: { icon: { type: 'emoji', emoji: '\u{23F3}' }, label: 'Turn end' },
  heat: { icon: { type: 'emoji', emoji: '\u{1F975}' }, label: 'Heat exhaustion' },
  throwIn: { icon: { type: 'emoji', emoji: '\u{1F64C}' }, label: 'Throw-in' },
  scatter: { icon: { type: 'emoji', emoji: '\u{1F4A8}' }, label: 'Scatter' },
  ballAndChain: { icon: { type: 'emoji', emoji: '\u{26D3}\u{FE0F}' }, label: 'Ball & Chain' },
  standUp: { icon: { type: 'emoji', emoji: '\u{1F9CD}' }, label: 'Stand up' },
  jump: { icon: { type: 'emoji', emoji: '\u{1F998}' }, label: 'Jump' },
  // owner 10-16: a jump by a Leap / Pogo player is named for the skill (the pitch plate reads LEAP / POGO too)
  leap: { icon: { type: 'skill', skill: 'Leap' }, label: 'Leap' },
  pogo: { icon: { type: 'skill', skill: 'Pogo' }, label: 'Pogo' },
  throwTeamMate: { icon: { type: 'emoji', emoji: '\u{1F93E}' }, label: 'Throw Team-Mate' },
  landing: { icon: { type: 'emoji', emoji: '\u{1FA82}' }, label: 'Landing' },
  bomb: { icon: { type: 'emoji', emoji: '\u{1F4A3}' }, label: 'Bomb' },
  cloudBurster: { icon: { type: 'emoji', emoji: '\u{2601}\u{FE0F}' }, label: 'Cloud Burster' },
  wizard: { icon: { type: 'emoji', emoji: '\u{1F9D9}' }, label: 'Wizard' },
  prayer: { icon: { type: 'emoji', emoji: '\u{1F64F}' }, label: 'Prayer to Nuffle' },
  card: { icon: { type: 'emoji', emoji: '\u{1F0CF}' }, label: 'Card' },
  inducements: { icon: { type: 'emoji', emoji: '\u{1F6D2}' }, label: 'Inducements' },
  masterChef: { icon: { type: 'emoji', emoji: '\u{1F373}' }, label: 'Master Chef' },
  rookies: { icon: { type: 'emoji', emoji: '\u{1F423}' }, label: 'Riotous Rookies' },
  pastries: { icon: { type: 'emoji', emoji: '\u{1F967}' }, label: 'Bretonnian Pastries' }, // Pastries lane 10-23 (pending upstream)
  hired: { icon: { type: 'emoji', emoji: '\u{1F91D}' }, label: 'Hired by both coaches' },
  fans: { icon: { type: 'emoji', emoji: '\u{1F465}' }, label: 'Fans' },
  winnings: { icon: { type: 'emoji', emoji: '\u{1F4B0}' }, label: 'Winnings' },
  defecting: { icon: { type: 'emoji', emoji: '\u{1F6AA}' }, label: 'Defecting players' },
  shootout: { icon: { type: 'emoji', emoji: '\u{1F945}' }, label: 'Penalty shootout' },
  referee: { icon: { type: 'emoji', emoji: '\u{2696}\u{FE0F}' }, label: 'Referee' },
  argueTheCall: { icon: { type: 'emoji', emoji: '\u{1F5E3}\u{FE0F}' }, label: 'Argue the Call' },
  bribe: { icon: { type: 'emoji', emoji: '\u{1F4B5}' }, label: 'Bribe' },
  secretWeapon: { icon: { type: 'emoji', emoji: '\u{1F7E5}' }, label: 'Secret Weapon' },
  stalling: { icon: { type: 'art', art: 'stalling' }, label: 'Stalling' }, // owner 10-15: the pitch's STALLING die badge, not an emoji
  raiseDead: { icon: { type: 'emoji', emoji: '\u{1F9DF}' }, label: 'Raise Dead' },
  bite: { icon: { type: 'emoji', emoji: '\u{1F9DB}' }, label: 'Bite' },
  chomp: { icon: { type: 'emoji', emoji: '\u{1F444}' }, label: 'Chomp' },
  alwaysHungry: { icon: { type: 'emoji', emoji: '\u{1F356}' }, label: 'Always Hungry' },
  allYouCanEat: { icon: { type: 'emoji', emoji: '\u{1F37D}\u{FE0F}' }, label: 'All You Can Eat' },
  saboteur: { icon: { type: 'emoji', emoji: '\u{1F4A5}' }, label: 'Saboteur' },
  dwarfenWisdom: { icon: { type: 'emoji', emoji: '\u{1F9D4}' }, label: 'Dwarfen Wisdom' },
  punt: { icon: { type: 'emoji', emoji: '\u{1F9B5}' }, label: 'Punt' },
  swoop: { icon: { type: 'emoji', emoji: '\u{1F985}' }, label: 'Swoop' },
  twoForOne: { icon: { type: 'emoji', emoji: '\u{1F46F}' }, label: 'Two For One' },
  tentacles: { icon: { type: 'emoji', emoji: '\u{1F419}' }, label: 'Tentacles' },
  shadowing: { icon: { type: 'emoji', emoji: '\u{1F464}' }, label: 'Shadowing' },
  savagery: { icon: { type: 'emoji', emoji: '\u{1F43A}' }, label: 'Animal Savagery' },
  confusion: { icon: { type: 'emoji', emoji: '\u{1F635}' }, label: 'Negative trait' },
  dauntless: { icon: { type: 'emoji', emoji: '\u{1F4AA}' }, label: 'Dauntless' },
  regeneration: { icon: { type: 'emoji', emoji: '\u{267B}\u{FE0F}' }, label: 'Regeneration' },
  escape: { icon: { type: 'emoji', emoji: '\u{1F513}' }, label: 'Escape' },
  lookIntoMyEyes: { icon: { type: 'emoji', emoji: '\u{1F441}\u{FE0F}' }, label: 'Look Into My Eyes' },
  dagger: { icon: { type: 'emoji', emoji: '\u{1F5E1}\u{FE0F}' }, label: 'Weeping Dagger' },
  stab: { icon: { type: 'emoji', emoji: '\u{1F52A}' }, label: 'Stab' },
  swarming: { icon: { type: 'emoji', emoji: '\u{1F400}' }, label: 'Swarming' },
  nervesOfSteel: { icon: { type: 'emoji', emoji: '\u{1F624}' }, label: 'Nerves of Steel' },
  indomitable: { icon: { type: 'emoji', emoji: '\u{1F9BE}' }, label: 'Indomitable' },
  oldPro: { icon: { type: 'emoji', emoji: '\u{1F393}' }, label: 'Old Pro' },
  pickMeUp: { icon: { type: 'emoji', emoji: '\u{2B06}\u{FE0F}' }, label: 'Pick Me Up' },
  raidingParty: { icon: { type: 'emoji', emoji: '\u{2694}\u{FE0F}' }, label: 'Raiding Party' },
  keg: { icon: { type: 'emoji', emoji: '\u{1F37A}' }, label: 'Thrown keg' },
  placedBall: { icon: { type: 'emoji', emoji: '\u{1F3C8}' }, label: 'Ball placement' },
  trapDoor: { icon: { type: 'emoji', emoji: '\u{1F573}\u{FE0F}' }, label: 'Trap door' },
  skill: { icon: { type: 'emoji', emoji: '\u{2728}' }, label: 'Skill' },
  hex: { icon: { type: 'emoji', emoji: '\u{1F52E}' }, label: 'Baleful Hex' },
  catchOfTheDay: { icon: { type: 'emoji', emoji: '\u{1F3A3}' }, label: 'Catch of the Day' },
  thrownAt: { icon: { type: 'emoji', emoji: '\u{1F94F}' }, label: 'Thrown at' },
  crowd: { icon: { type: 'emoji', emoji: '\u{1F3DF}\u{FE0F}' }, label: 'Crowd' },
  fireball: { icon: { type: 'emoji', emoji: '\u{2604}\u{FE0F}' }, label: 'Fireball' },
  lightning: { icon: { type: 'emoji', emoji: '\u{1F329}\u{FE0F}' }, label: 'Lightning' },
} as const satisfies Record<string, { icon: LogIconSpec; label: string }>;

export type LogIconSpec =
  | { type: 'art'; art: string }
  | { type: 'skill'; skill: string }
  | { type: 'emoji'; emoji: string }
  | { type: 'ko' };
export type LogActionKind = keyof typeof LOG_ACTION_ICONS;
export const LOG_ACTION_KINDS = Object.keys(LOG_ACTION_ICONS) as LogActionKind[];

/** Display name of each action icon (its accessible label / tooltip). */
export const LOG_ACTION_LABELS: Readonly<Record<LogActionKind, string>> = Object.fromEntries(
  LOG_ACTION_KINDS.map((kind) => [kind, LOG_ACTION_ICONS[kind].label]),
) as Record<LogActionKind, string>;

/**
 * Owner 10-15: every report type the log renders -> its action icon (null = no icon: bookkeeping without an action).
 * A few types refine this in logActionPlate (a hand-off's catch, an injury by its type, a skill-specific roll, the
 * turn end per line); the entry here is the type's own icon. A test keeps every formatter type in this table.
 */
export const REPORT_ACTION_KIND: Readonly<Record<string, LogActionKind | null>> = {
  // movement and ball handling
  dodgeRoll: 'dodge', goForItRoll: 'rush', catchRoll: 'catch', passRoll: 'pass', pickUpRoll: 'pickup', leapRoll: 'jump',
  interceptionRoll: 'catch', scatterPlayer: 'ballAndChain', standUpRoll: 'standUp', jumpUpRoll: 'standUp',
  modifiedPassResult: 'pass', modifiedDodgeResultSuccessful: 'dodge', passDeviate: 'pass', handOver: 'handoff',
  safeThrowRoll: 'pass', throwIn: 'throwIn', scatterBall: 'scatter', placedBallDirection: 'placedBall', fumblerooskie: 'placedBall',
  // block family
  block: 'block', blockRoll: 'block', blockChoice: 'block', blockReRoll: 'reroll', pushback: 'block', foul: 'foul',
  referee: 'foul', injury: null, apothecaryRoll: 'apothecary', apothecaryChoice: 'apothecary', regenerationRoll: 'regeneration',
  // kick-off and game flow
  coinThrow: 'coin', receiveChoice: 'coin', kickoffResult: 'kickoff', kickoffScatter: 'kickoffScatter', weather: 'weather',
  kickoffTimeout: 'timeout', quickSnapRoll: 'quickSnap', kickoffSequenceActivationsCount: 'quickSnap',
  kickoffSequenceActivationsExhausted: 'quickSnap', blitzRoll: 'kickoffBlitz', solidDefenceRoll: 'solidDefence',
  extraReRoll: 'brilliantCoaching', cheeringFans: 'kickoff', kickoffDodgySnack: 'dodgySnack', dodgySnackRoll: 'dodgySnack',
  kickoffPitchInvasion: 'kickoff', kickoffThrowARock: 'throwARock', kickoffRiot: 'kickoff', startHalf: 'halfStart',
  turnEnd: 'turnEnd', weatherMageRoll: 'weather', weatherMageResult: 'weather',
  // pre / post game
  fanFactor: 'fans', fanFactorRoll: 'fans', spectators: 'fans', dedicatedFans: 'fans', winnings: 'winnings', winningsRoll: 'winnings',
  defectingPlayers: 'defecting', penaltyShootout: 'shootout', masterChefRoll: 'masterChef', riotousRookies: 'rookies', bretonnianPastriesRoll: 'pastries',
  cardsAndInducementsBought: 'inducements', inducementsBought: 'inducements', cardsBought: 'inducements',
  inducement: 'inducements', // the 'inducement used' report (Igor / Wandering Apothecary / Extra Team Training ...), formatted since 1.0.292
  prayersAndInducementsBought: 'inducements', doubleHiredStarPlayer: 'hired', doubleHiredStaff: 'hired',
  wizardUse: 'wizard', cardEffectRoll: 'card', prayerRoll: 'prayer', prayerAmount: 'prayer', prayerEnd: 'prayer',
  prayerWasted: 'prayer', playerEvent: 'prayer', biasedRef: 'referee', secretWeaponBan: 'secretWeapon',
  throwAtStallingPlayer: 'stalling',
  // rerolls
  reRoll: 'reroll', mascotUsed: 'mascot', teamCaptainRoll: 'teamCaptain', pumpUpTheCrowdReRoll: 'reroll',
  showStarReRoll: 'reroll', briberyAndCorruptionReRoll: 'reroll', brilliantCoachingReRoll: 'brilliantCoaching',
  pumpUpTheCrowdReRollLost: 'reroll', showStarReRollLost: 'reroll', oldPro: 'oldPro',
  // skills and traits
  confusionRoll: 'confusion', bloodLustRoll: 'bloodlust', hypnoticGazeRoll: 'gaze', steadyFootingRoll: 'steadyFooting',
  dauntlessRoll: 'dauntless', foulAppearanceRoll: 'foulAppearance', escapeRoll: 'escape', rightStuffRoll: 'landing',
  throwTeamMateRoll: 'throwTeamMate', kickTeamMateFumble: 'throwTeamMate', raiseDead: 'raiseDead', biteSpectator: 'bite',
  chompRoll: 'chomp', chompRemoved: 'chomp', animosityRoll: 'animosity', alwaysHungryRoll: 'alwaysHungry',
  saboteurRoll: 'saboteur', chainsawRoll: 'chainsaw', gettingEvenRoll: 'gettingEven', dwarfenWisdomRoll: 'dwarfenWisdom',
  puntDirectionRoll: 'punt', puntDistanceRoll: 'punt', swoopDirectionRoll: 'swoop', swoopPlayer: 'swoop',
  twoForOne: 'twoForOne', tentaclesShadowingRoll: 'tentacles', animalSavagery: 'savagery', projectileVomit: 'vomit',
  breatheFire: 'breatheFire', lookIntoMyEyesRoll: 'lookIntoMyEyes', weepingDaggerRoll: 'dagger', swarmingPlayersRoll: 'swarming',
  nervesOfSteel: 'nervesOfSteel', indomitable: 'indomitable', pickMeUp: 'pickMeUp', raidingParty: 'raidingParty',
  thrownKeg: 'keg', bombOutOfBounds: 'bomb', bombExplodesAfterCatch: 'bomb', cloudBurster: 'cloudBurster',
  trapDoor: 'trapDoor', skillUse: 'skill', skillUseOtherPlayer: 'skill', skillWasted: 'skill', throwAtPlayer: 'thrownAt',
  balefulHex: 'hex', catchOfTheDay: 'catchOfTheDay', allYouCanEat: 'allYouCanEat', playerAction: null, playerActionCancelled: null,
  // report types without a formatter of their own (the generic line)
  argueTheCall: 'argueTheCall', bribesRoll: 'bribe', kickTeamMateRoll: 'throwTeamMate', officiousRefRoll: 'referee',
  spellEffectRoll: 'wizard', thenIStartedBlastin: 'saboteur',
};

/** Injury type families (lower case, any "ForSpp" suffix dropped) -> the icon of their cause (the row is the cause's
 *  armour / injury step). Block and foul injuries are handled before this lookup (Block / Foul icons). */
export const INJURY_ACTION_KIND: Readonly<Record<string, LogActionKind>> = {
  dropdodge: 'dodge', dropgfi: 'rush', dropleap: 'jump', projectilevomit: 'vomit', chainsaw: 'chainsaw', stab: 'stab',
  crowdpush: 'crowd', ktmcrowd: 'crowd', fireball: 'fireball', lightning: 'lightning', bomb: 'bomb', breathefire: 'breatheFire',
  trapdoor: 'trapDoor', trapdoorfall: 'trapDoor', ttmlanding: 'landing', ttmhitplayer: 'landing', ktminjury: 'throwTeamMate',
  ktmfumbleinjury: 'throwTeamMate', ktmfumbleapokoinjury: 'throwTeamMate', quickbite: 'bite', bitten: 'bite',
  saboteur: 'saboteur', sabotaged: 'saboteur', startedblastin: 'saboteur', keghit: 'keg', eatplayer: 'alwaysHungry',
  throwarock: 'throwARock', ballandchain: 'ballAndChain', pilingonarmor: 'block', pilingoninjury: 'block', pilingonknockedout: 'block',
};

/** The INJURY_ACTION_KIND key of an injury type: lower case, any "ForSpp" suffix dropped. */
export function injuryTypeFamilyKey(injuryType: unknown): string {
  return String(injuryType ?? '').toLowerCase().replace(/forspp$/, '');
}

export interface LogActionPlate {
  kind: LogActionKind | null;
  side: ServerSide | null;
  source?: string;
  /** Owner 10-16: a 'skill' row (skillUse / skillUseOtherPlayer / skillWasted) names the skill it used, so the plate
   *  shows THAT skill's icon from the active skill icon family instead of the generic sparkle. */
  skill?: string;
}

type Report = Record<string, unknown>;

/** The formatter's cursor context: the block attacker latched by the `block` report that opens a block sequence, the
 *  receiver named by the last `handOver` report (consumed by the catch roll it leads to), and the reroll source that
 *  last PROVIDED a reroll (consumed by the rerolled roll line it leads to). */
export interface LogActionContext {
  lastBlockAttackerId: string | null;
  lastHandOverCatcherId?: string | null;
  lastRerollSource?: string | null;
  /** The player the pending grant's reRoll report named (null for a team-level grant such as the Mascot). */
  lastRerollPlayerId?: string | null;
  /** The team of a team-level grant (mascotUsed names only its team). */
  lastRerollTeamId?: string | null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
function actingPlayerId(game: GameJson | null): string | null {
  return str((game?.actingPlayer as { playerId?: unknown } | undefined)?.playerId);
}
/** First resolvable player id -> its server side. */
function sideOfFirst(game: GameJson | null, ...ids: unknown[]): ServerSide | null {
  for (const id of ids) {
    const playerId = str(id);
    if (playerId) return playerServerSide(game, playerId);
  }
  return null;
}
function blockAttackerSide(report: Report, game: GameJson | null, context: LogActionContext | null): ServerSide | null {
  return sideOfFirst(game, report.attackerId, report.playerId, actingPlayerId(game), context?.lastBlockAttackerId);
}

const MASCOT_SOURCE = 'Team Mascot';
/** Owner 10-15: a reroll source whose reRoll report `roll` is a GATE roll that can deny the reroll (Pro and its
 *  fallbacks, Loner, a team reroll whose Loner check older shapes fold into the report). An absent source is the team
 *  reroll. Any other source (Blind Rage...) reports the replacement's own roll there. Shared with the reRoll line. */
export function isGateRerollSource(source: string | null | undefined): boolean {
  const named = typeof source === 'string' && source.trim() ? source.trim() : 'Team ReRoll';
  const key = named.toLowerCase().replace(/[^a-z]/g, '');
  return /^pro\b/i.test(named) || key === 'loner' || key.includes('teamreroll');
}
/** Hand-off latch after the receiver's failed first catch: only its reroll still belongs to the Hand-off. */
const HANDOFF_RETRY = 'retry:';
/** Gate-only sources: they roll to let the reroll ALREADY being spent go ahead (Loner gates a team reroll), so they
 *  are never the provider themselves. */
const GATE_SOURCES = new Set(['loner']);
/** The source a granting report provides; null when it provided none; undefined when the report grants nothing.
 *  Wire shapes (bug-report wire logs, apps/tauri/test/fixtures/g1950459-rush-burst-wire.jsonl,
 *  g999-blitz-turnover-wire.jsonl):
 *   - an ungated reroll reports roll 0 and successful FALSE (`Team ReRoll`, successful false, roll 0, then the rerolled
 *     roll): `successful` only means something for a GATED roll (roll > 0), the same rule the formatter's line uses;
 *   - a gated source (Pro, Loner) reports its roll: successful false = denied ("FAILED | no reroll");
 *   - Loner follows the Team ReRoll it gates (TRR, then Loner passed): it keeps the latched provider;
 *   - a working Mascot reports only mascotUsed (successful, no reRoll report); a failed Mascot that falls back reports
 *     mascotUsed (successful false) THEN reRoll "Team ReRoll". */
function providedSource(report: Report, context: LogActionContext | null): string | null | undefined {
  const id = String(report.reportId ?? '');
  if (id === 'reRoll' || id === 'blockReRoll') {
    const roll = Number(report.roll);
    const named = str(report.reRollSource);
    // Only a GATE roll can deny the reroll: Pro (and its fallbacks), Loner, and a team reroll (whose Loner check older
    // shapes fold into the same report). Other sources report the REPLACEMENT's own roll / result there (fixture
    // g1951755-frenzy-blitz-chainpush-wire.jsonl: reRoll "Blind Rage" successful false roll 3, then the rerolled
    // Dauntless roll), which never takes the reroll back.
    const gated = isGateRerollSource(named) && Number.isInteger(roll) && roll > 0;
    if (gated && report.successful === false) return null;
    if (named && GATE_SOURCES.has(named.toLowerCase().replace(/[^a-z]/g, ''))) return context?.lastRerollSource ?? null;
    // A reRoll without a source reads "uses a team reroll to reroll" in the log (the formatter's own default); a blockReRoll
    // without one names none.
    return named ?? (id === 'reRoll' ? 'Team ReRoll' : null);
  }
  if (id === 'mascotUsed') return report.successful === true ? MASCOT_SOURCE : null;
  return undefined;
}

/** Advance the context latches from a report. Idempotent: the live store calls it for every report, displayed or not
 *  (handOver carries no dice, so the live log never formats it), and logActionPlate calls it again when the report is
 *  formatted. Consumption happens only in logActionPlate. */
export function latchLogActionContext(report: Report, context: LogActionContext): void {
  const id = String(report.reportId ?? '');
  if (id === 'handOver') context.lastHandOverCatcherId = str(report.catcherId);
  const source = providedSource(report, context);
  // A partial block reroll is reRoll -> block -> blockReRoll (the replaced die) -> blockRoll (the full new set; fixture
  // block-brawler-reroll-wire.jsonl cmd 55): blockReRoll keeps the grant pending (its own named source, else the one
  // already latched) so that final blockRoll still reads as the reroll.
  if (source !== undefined) {
    if (id === 'blockReRoll') {
      context.lastRerollSource = source ?? context.lastRerollSource ?? null;
    } else {
      context.lastRerollSource = source;
      context.lastRerollPlayerId = source ? str(report.playerId) : null;
      context.lastRerollTeamId = source ? str(report.teamId) : null;
    }
  }
  // The die selection ends a block's dice sequence, and a turn end ends everything: any grant still pending is stale.
  if (id === 'blockChoice' || id === 'turnEnd') clearPendingReroll(context);
}

function clearPendingReroll(context: LogActionContext): void {
  context.lastRerollSource = null;
  context.lastRerollPlayerId = null;
  context.lastRerollTeamId = null;
}

/** Is `report` the receiver's catch of the pending hand-off (or that catch's reroll)? Read-only - logActionPlate
 *  consumes the latch afterwards. */
export function isHandoffCatch(report: Report, context: Pick<LogActionContext, 'lastHandOverCatcherId'> | null | undefined): boolean {
  if (String(report.reportId ?? '') !== 'catchRoll') return false;
  const latch = context?.lastHandOverCatcherId ?? null;
  const catcher = str(report.playerId);
  if (!catcher || !latch) return false;
  return latch === catcher || (latch === `${HANDOFF_RETRY}${catcher}` && report.reRolled === true);
}

/** Is `report` the roll a pending reroll grant leads to? A roll flagged reRolled; a full block reroll, which the server
 *  sends as a fresh unflagged blockRoll (mascotUsed / reRoll -> block -> blockRoll); or the granted player's own next
 *  roll even when flagged reRolled:false - the server does that for the replacement Pass roll (fixture
 *  wire-g992-hmpscatter-cmd422-433.json: reRoll "Pass" then passRoll reRolled:false). Grant reports themselves never
 *  qualify. Shared by the "Rerolled | " lead (reportFormatter) and the Graphical source icon, read before consumption. */
export function pendingRerollApplies(report: Report, context: Pick<LogActionContext, 'lastRerollSource' | 'lastRerollPlayerId' | 'lastRerollTeamId'> | null | undefined, game: GameJson | null = null): boolean {
  if (providedSource(report, null) !== undefined) return false;
  if (typeof context?.lastRerollSource !== 'string' || !context.lastRerollSource) return false;
  const id = String(report.reportId ?? '');
  if (report.reRolled === true || id === 'blockRoll') return true;
  if (report.reRolled !== false) return false;
  const player = str(report.playerId);
  if (!player) return false;
  if (context.lastRerollPlayerId) return player === context.lastRerollPlayerId;
  // A team-level grant (a working Mascot names only its team): the granting team's player's next roll - the server
  // clears the reroll source before the replacement Hail Mary pass, so that roll arrives reRolled:false too.
  const team = context.lastRerollTeamId ? teamServerSide(game, context.lastRerollTeamId) : null;
  return !!team && playerServerSide(game, player) === team;
}

/** What icon a reroll source shows: the team reroll icon, an inducement icon, or the source's skill icon. */
export type RerollSourceIcon = { kind: 'trr' } | { kind: 'resource'; name: string } | { kind: 'skill'; skill: string };
export function rerollSourceIcon(source: string): RerollSourceIcon {
  const key = source.toLowerCase().replace(/[^a-z]/g, '');
  if (key.includes('mascot') && !/^pro\b/i.test(source.trim())) return { kind: 'resource', name: 'team_mascot' };
  if (key.includes('bribery')) return { kind: 'resource', name: 're_roll_argue' };
  // Brilliant Coaching grants a TEAM reroll and has no art of its own: the TRR icon. (Pump up the Crowd and Star of
  // the Show have their own skill art, so they fall through to the skill icon below.)
  if (key.includes('teamreroll') || key.includes('brilliantcoaching')) return { kind: 'trr' };
  // "Pro", and Pro with a fallback ("Pro TRR", "Pro Mascot TRR"): the final Pro roll decided the reroll.
  if (/^pro\b/i.test(source.trim())) return { kind: 'skill', skill: 'Pro' };
  const leaf = source.includes('.') ? source.slice(source.lastIndexOf('.') + 1) : source;
  const skill = leaf.replace(/[_$]/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim()
    .replace(/(^|\s)([a-z])/g, (_m, sp: string, c: string) => sp + c.toUpperCase());
  return { kind: 'skill', skill: skill || source };
}

/** The two icons a Graphical row's left cell shows: [source][action]. The source is dropped when it would repeat the
 *  action's own art (a Team ReRoll source on a Reroll line: both are the team reroll icon), so no row shows one icon
 *  twice. */
export function logRowIcons(plate: LogActionPlate | null | undefined): { source: RerollSourceIcon | null; action: LogActionKind | null } {
  if (!plate) return { source: null, action: null };
  const source = plate.source ? rerollSourceIcon(plate.source) : null;
  const repeats = source && ((source.kind === 'trr' && plate.kind === 'reroll')
    || (source.kind === 'resource' && source.name === 'team_mascot' && plate.kind === 'mascot'));
  return { source: repeats ? null : source, action: plate.kind };
}

/** The wire playerAction -> action kind, for the (debug-log) playerAction line. */
export function logActionForPlayerAction(action: unknown): LogActionKind | null {
  switch (String(action ?? '')) {
    case 'move': case 'moveLeap': case 'standUp': return 'move';
    case 'block': case 'blitz': case 'blitzMove': case 'multipleBlock': return 'block';
    case 'pass': case 'passMove': return 'pass';
    case 'handOver': case 'handOverMove': return 'handoff';
    case 'foul': case 'foulMove': return 'foul';
    default: return null;
  }
}

/**
 * The row decoration for the lines of `report` (every line of a multi-line report, e.g. an injury's dice line and its
 * effect sentences, belongs to the same action). `fallbackSide` is the report's dice owner (reportDiceOwner): the row
 * tint of a line whose report maps to no action icon. Null = nothing to show (neutral row, empty icon cell).
 * Advances the context: latches from handOver / reroll grants, consumes them on the catch / rerolled roll they lead to.
 */
export function logActionPlate(report: Report, game: GameJson | null, context: LogActionContext | null = null, fallbackSide: ServerSide | null = null): LogActionPlate | null {
  if (context) latchLogActionContext(report, context);
  const action = logActionKindPlate(report, game, context);
  // The reroll source: a granting report's own line shows what it provided (nothing when it failed); a rerolled roll
  // line shows the source the latch holds, consumed here so it can never decorate a later, unrelated reroll.
  let source: string | null = null;
  const id = String(report.reportId ?? '');
  const provided = providedSource(report, context);
  // (mascotUsed is excluded: its line's own action icon already is the Mascot; its grant feeds the latch only.)
  if (provided !== undefined && id !== 'mascotUsed') source = provided;
  // The roll the grant leads to: a roll flagged reRolled, or a full block reroll, which the server sends as a fresh
  // blockRoll with no flag (mascotUsed / reRoll -> block -> blockRoll). Consumed, so it decorates nothing later.
  if (pendingRerollApplies(report, context, game)) {
    source = context?.lastRerollSource ?? null;
    if (context) clearPendingReroll(context);
  } else if (report.reRolled === false && context) {
    // Any other roll the server states was NOT rerolled ends a pending grant (it can only be stale by then).
    clearPendingReroll(context);
  }
  const side = action ? action.side ?? fallbackSide : fallbackSide;
  const kind = action?.kind ?? null;
  if (!kind && !source && !side) return null;
  const skill = action?.skill;
  return { kind, side, ...(source ? { source } : {}), ...(skill ? { skill } : {}) };
}

/**
 * Owner 10-15 (Graphical style): the plate each displayed row shows. A step row (indent > 0) keeps its sequence's tint
 * but drops an icon that only repeats its parent row's action (the block's push / knockdown under the Block row, a
 * chainsaw's injury step under the chainsaw roll); a step of a different action type (a hand-off's Catch, the
 * apothecary, regeneration, a skill, a crowd push) shows its own icon. A reroll row keeps only its reroll source icon.
 * `rows` are in display order (oldest first); the parent is the nearest earlier row at a lower indent.
 */
// Perf (JLeav 1.0.296): a step row's reduced plate is built once per action, so the row's plate keeps its identity on
// every recompute (the Log's memoised rows re-render only when a prop changes identity). Actions are immutable.
const stepPlates = new WeakMap<LogActionPlate, LogActionPlate>();
export function logRowPlates(rows: readonly { action?: LogActionPlate | null; indent?: number }[]): (LogActionPlate | null | undefined)[] {
  const kinds: (LogActionKind | null)[] = [];
  return rows.map(({ action, indent = 0 }) => {
    const kind = action?.kind ?? null;
    let parent: LogActionKind | null | undefined;
    for (let level = Math.min(indent, kinds.length) - 1; level >= 0 && parent === undefined; level--) parent = kinds[level];
    kinds.length = indent;
    kinds[indent] = kind;
    if (!indent || !action || !kind) return action;
    if (kind !== 'reroll' && kind !== parent) return action;
    let step = stepPlates.get(action);
    if (!step) stepPlates.set(action, step = action.source ? { kind: null, side: action.side, source: action.source } : { kind: null, side: action.side });
    return step;
  });
}

function logActionKindPlate(report: Report, game: GameJson | null, context: LogActionContext | null): { kind: LogActionKind; side: ServerSide | null; skill?: string } | null {
  const id = String(report.reportId ?? '');
  const plate = (kind: LogActionKind, side: ServerSide | null) => ({ kind, side });
  const rollerSide = () => sideOfFirst(game, report.playerId) ?? teamServerSide(game, report.teamId);
  switch (id) {
    case 'block': case 'blockRoll': case 'blockChoice':
      return plate('block', blockAttackerSide(report, game, context));
    case 'pushback':
      // The pushed player is the defender; the action is the attacker's.
      return plate('block', sideOfFirst(game, actingPlayerId(game), context?.lastBlockAttackerId));
    case 'blockReRoll':
      return plate('reroll', sideOfFirst(game, report.playerId) ?? teamServerSide(game, report.choosingTeamId) ?? blockAttackerSide(report, game, context));
    case 'reRoll':
      return plate('reroll', rollerSide());
    case 'passRoll':
      return plate('pass', rollerSide());
    case 'passDeviate': case 'modifiedPassResult':
      return plate('pass', sideOfFirst(game, report.playerId, actingPlayerId(game)));
    case 'handOver':
      // ReportHandOver names only the receiver; the giver is the acting player, a team-mate of the receiver.
      return plate('handoff', sideOfFirst(game, actingPlayerId(game), report.catcherId));
    case 'catchRoll': {
      // The receiver's catch roll right after a `handOver` report belongs to the Hand-off sequence, and so does its
      // reroll: a failed first attempt leaves a RETRY latch that only the receiver's next catch flagged reRolled
      // matches. Owner 10-15 (later): the hand-off row itself now shows (the handOver report), so its catch wears the
      // Catch icon, indented under it in the Graphical style (formatReportLines asks isHandoffCatch before this
      // consumes the latch). Anything else (a bounce, a later unrelated catch) clears the latch.
      const latch = context?.lastHandOverCatcherId ?? null;
      const catcher = str(report.playerId);
      if (context) context.lastHandOverCatcherId = null;
      if (catcher && latch === catcher && context && report.successful === false) context.lastHandOverCatcherId = `${HANDOFF_RETRY}${catcher}`;
      return plate('catch', rollerSide());
    }
    case 'interceptionRoll':
      return plate('catch', rollerSide());
    case 'dodgeRoll':
      return plate('dodge', rollerSide());
    case 'modifiedDodgeResultSuccessful':
      return plate('dodge', sideOfFirst(game, report.playerId, actingPlayerId(game)));
    case 'goForItRoll':
      return plate('rush', rollerSide());
    case 'pickUpRoll':
      return plate('pickup', rollerSide());
    case 'breatheFire':
      // owner 10-15: the Graphical style shows a fire emoji for it
      return plate('breatheFire', rollerSide());
    case 'projectileVomit':
      // owner 10-15: the pitch's Projectile Vomit marker (an emoji there too)
      return plate('vomit', rollerSide());
    // owner 10-15: these show their skill icon from the active skill icon family
    case 'bloodLustRoll':
      return plate('bloodlust', rollerSide());
    case 'hypnoticGazeRoll':
      return plate('gaze', rollerSide());
    case 'foulAppearanceRoll':
      return plate('foulAppearance', rollerSide());
    case 'animosityRoll':
      return plate('animosity', rollerSide());
    case 'steadyFootingRoll':
      return plate('steadyFooting', rollerSide());
    case 'teamCaptainRoll':
      return plate('teamCaptain', rollerSide());
    case 'gettingEvenRoll':
      return plate('gettingEven', rollerSide());
    case 'chainsawRoll':
      return plate('chainsaw', rollerSide());
    case 'foul':
      return plate('foul', sideOfFirst(game, report.playerId, report.attackerId, actingPlayerId(game)));
    case 'referee':
      // ReportReferee names no fouler; it is the acting player (the same source the formatter's line uses).
      return plate('foul', sideOfFirst(game, actingPlayerId(game)));
    case 'mascotUsed':
      return plate('mascot', teamServerSide(game, report.teamId) ?? sideOfFirst(game, report.playerId));
    case 'playerAction': case 'playerActionCancelled': {
      const kind = logActionForPlayerAction(report.playerAction);
      return kind ? plate(kind, sideOfFirst(game, report.actingPlayerId, report.playerId)) : null;
    }
    case 'injury': {
      const type = String(report.injuryType ?? '').toLowerCase();
      if (type.startsWith('foul')) return plate('foul', sideOfFirst(game, report.attackerId, actingPlayerId(game)));
      if (type.startsWith('block')) return plate('block', sideOfFirst(game, report.attackerId));
      // A failed dodge / rush: the falling player is the one acting.
      if (type === 'dropdodge') return plate('dodge', sideOfFirst(game, report.defenderId, report.playerId));
      if (type === 'dropgfi') return plate('rush', sideOfFirst(game, report.defenderId, report.playerId));
      // the vomit's armour / injury roll: the vomiter's action (on a self-vomit the vomiter is the victim)
      if (type === 'projectilevomit') return plate('vomit', sideOfFirst(game, report.attackerId, actingPlayerId(game), report.defenderId));
      // a chainsaw injury (the hit's step, or the kickback head - the chainsaw player hit by their own saw)
      if (type === 'chainsaw' || type === 'chainsawforspp') return plate('chainsaw', sideOfFirst(game, report.attackerId, actingPlayerId(game), report.defenderId));
      // owner 10-15: any other injury takes its cause's icon (INJURY_ACTION_KIND); the icon does not change the row's
      // tint (Astra 10-15): side null keeps the report's dice owner (logActionPlate's fallbackSide, reportDiceOwner)
      const kind = INJURY_ACTION_KIND[injuryTypeFamilyKey(type)];
      return kind ? plate(kind, null) : null;
    }
    case 'tentaclesShadowingRoll':
      // one report for two skills: the Shadowing or the Tentacles icon (the shadower / holder is defenderId)
      // (side null: the icon keeps the row's existing dice-owner tint)
      return plate(/shadow/i.test(String(report.skill ?? '')) ? 'shadowing' : 'tentacles', null);
    default: {
      // Owner 10-16 ("Genesis Besur uses Dodge" wore stars): a skill-use row carries the skill it names - its icon
      if (id === 'skillUse' || id === 'skillUseOtherPlayer' || id === 'skillWasted') {
        // Astra 10-16: only a string names a skill (a malformed report must not throw inside checkpoint reduction)
        const skill = typeof report.skill === 'string' ? report.skill.trim() : '';
        return skill ? { ...plate('skill', null), skill } : plate('skill', null);
      }
      // owner 10-15: every other report type takes its icon from REPORT_ACTION_KIND (null = no icon). Astra 10-15: the
      // icon never changes the row's tint - side null keeps the report's dice owner (fallbackSide, reportDiceOwner)
      const kind = REPORT_ACTION_KIND[id];
      if (kind === 'jump') return plate(jumpKindFor(game, report.playerId), null); // owner 10-16: Leap / Pogo by the mover's skill
      if (id === 'spellEffectRoll') return plate(String(report.specialEffect ?? '').toLowerCase() === 'bomb' ? 'bomb' : 'wizard', null); // owner 10-19: a bomb's explosion roll wears the bomb
      return kind ? plate(kind, null) : null;
    }
  }
}

/** A stored row decoration is trusted only in exactly this shape (spectator checkpoint rows are validated field by
 *  field): kind + side, plus a non-empty source string when present; never all-empty. */
export function isLogActionPlate(value: unknown): value is LogActionPlate {
  if (!value || typeof value !== 'object') return false;
  const keys = Object.keys(value).sort().join(',');
  const plate = value as { kind?: unknown; side?: unknown; source?: unknown; skill?: unknown };
  const kindOk = plate.kind === null || (LOG_ACTION_KINDS as readonly unknown[]).includes(plate.kind);
  const sideOk = plate.side === null || plate.side === 'home' || plate.side === 'away';
  const nonEmpty = (v: unknown) => typeof v === 'string' && v.length > 0;
  // optional keys: source (a reroll source) and skill (owner 10-16: the skill a skill-use row names)
  const sourceOk = keys === 'kind,side' || (keys === 'kind,side,source' && nonEmpty(plate.source))
    || (keys === 'kind,side,skill' && nonEmpty(plate.skill)) || (keys === 'kind,side,skill,source' && nonEmpty(plate.skill) && nonEmpty(plate.source));
  return kindOk && sideOk && sourceOk && (plate.kind !== null || plate.side !== null || plate.source !== undefined);
}
