<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { buildBladeSections, firstBladeCategory, groupByCategory, type LegalSkill, type LegalSkillSet } from './skillBladeSections';
import { DEFAULT_SKILL_COSTS, goldK, packDetail, packShort, packageRulesFrom, playerSkillSp, rulesetPanel, type PackageRules, type SkillCosts } from './teamBuilderRuleset';
import {
  explicitLeagueSelection,
  explicitLeagueSpecialRule,
  leagueFieldPresentation,
  normalizeLeagueOptions,
  reconcileLeagueSelection,
  starEligibleForLeagueSelection,
  type LeagueSelection,
} from './teamBuilderLeaguePresentation';
import {
  normalizeSlotsForPositionGroups,
  positionGroupCapState,
  type PositionGroupCap,
  type PositionGroupCapState,
} from './positionGroupCaps';
import {
  addStarChoiceToSlots,
  buildTeamBuilderStarChoices,
  removeStarChoiceFromSlots,
  starChoiceIsComplete,
  starChoiceMissingMembers,
  type TeamBuilderStarChoice,
} from './teamBuilderStarPairs';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { teamLogoUrl } from '../../game/teamLogos';
import { loadIconsetManifest } from '@fumbbl40k/ffb-pitch';
import { markerGlyph } from '../../game/skillDisplay';
import { playerSkillCategoryClass } from '../../game/skillCategory';
import { reactiveSkillIconUrl } from '../../game/assetModUi';
import { walkerPortraitUrl } from '../../game/walkerPortrait';
import { botConfigBaseUrl, configWebUnreachableMessage, resolveJoinCreds, settings } from '../../game/settings';
import { coachPassword } from '../../game/credentials';
import { authorizeForkRequest, shouldRetryAfterUnauthorized } from '../../game/configWebAuth';
import {
  fetchFumbblCoachTeams,
  ingestFumbblCoachTeam,
  type FumbblCoachTeam,
  type FumbblCoachTeamsResult,
} from '../../game/fumbblCoachTeams';
// Commission #5 (owner 08-12): elite skills get a pixel-art diamond sprite in place of the "◆" text glyph.
import eliteDiamondUrl from '../../assets/resources/elite-diamond.png';

type BuilderMode = 'create' | 'custom' | 'tournament' | 'import';
const props = withDefaults(defineProps<{ initialMode?: BuilderMode; initialPackageName?: string; launchRevision?: number }>(), {
  initialMode: 'create', initialPackageName: '', launchRevision: 0,
});

interface Position {
  positionId: string;
  name: string;
  cost: number;
  quantity?: number;
  max?: number;
  type?: string;
  MA?: number;
  ST?: number;
  AG?: string;
  PA?: string;
  AV?: string;
  skills?: string[];
  urlIconSet?: string;
  isStar?: boolean;
  playsFor?: string[];
  /** Upstream roster XML pairing contract. Older config-web projections omit it; the pair helper has a narrow fallback. */
  teamWithPositionId?: string | null;
}

interface Roster {
  rosterId: string;
  raceName: string;
  reRollCost?: number;
  maxReRolls?: number;
  apothecaryAllowed?: boolean;
  positions: Position[];
  positionGroups?: PositionGroupCap[];
  leagueOptions?: string[];
}

interface LibraryTeam {
  teamId: string;
  teamName: string;
  race: string;
  coach: string;
  teamValue: number;
  gold: number;
  rerolls?: number;
  fanFactor?: number;
  apothecary?: boolean;
  forkLoadable: boolean;
  ingestedAt: string;
}

interface LibraryPlayerDetail {
  id: string;
  number: number;
  name: string;
  position: string | null;
  positionId: string;
  skills: string[];
  /** Bare strings today; the widened emit carries {name, recovering} (recovering = the fresh injury). */
  injuries: Array<string | { name: string; recovering?: boolean }>;
  /** Veers's live emit (5719526): per-injury objects with the recovering flag — the temp-retire gate's source. */
  injuryDetails?: Array<{ name: string; recovering: boolean }>;
  spp: number;
  earnedSpp: number | null;
  advancements: number;
  rank: string;
  advancementCosts: { randomPrimary: number; chosenPrimary: number; chosenSecondary: number; characteristic: number } | null;
  advancementMethods: Record<AdvancementMethod, { available: boolean; reason?: string }>;
  pendingAdvancement: PendingAdvancementRoll | null;
  primaryCategories: string[];
  secondaryCategories: string[];
  primarySkills: string[];
  secondarySkills: string[];
  movement: number | null;
  strength: number | null;
  agility: number | null;
  passing: number | null;
  armour: number | null;
  currentValue: number;
  mng: boolean;
  status: string | null;
}

interface LibraryTeamDetail {
  id: string;
  name: string;
  race: string;
  rerolls: number;
  assistantCoaches: number;
  cheerleaders: number;
  apothecary: boolean;
  fanFactor: number;
  treasury: number;
  teamValue: number;
  rulesetPackName: string | null;
  leagues: string[];
  specialRules: string[];
  canEditRoster: { available: boolean; reason?: string };
  revision: string;
  players: LibraryPlayerDetail[];
  /** Owner ruling: resurrection-style team — earned SPP is suppressed (display + advancement affordance).
   *  Optional: absent on older config-web = not resurrection. Flag storage/toggle = Veers's half. */
  resurrection?: boolean;
  /** Raw stored status ("0" new / "1" active / upstream values, e.g. "REDRAFTING"). Emitted by newer config-web. */
  teamStatus?: string;
  /** Session-auth echo: the viewer holds organizer (admin/TO) access. Widening ask to Veers. */
  organizer?: boolean;
  /** The stored XML's inducementSet (widening ask to Veers; absent on older config-web). */
  inducements?: Array<{ type: string; value?: number }>;
}

interface PendingAdvancementRoll {
  token: string;
  playerId: string;
  method: 'randomPrimary' | 'characteristic';
  cost: number;
  choices: string[];
  roll?: number;
  revision: string;
  primaryFallbacks: string[];
  secondaryFallbacks: string[];
  expiresAt: string;
}

interface Slot {
  positionId: string;
  name: string;
  chosenSkills: string[];
}

interface TeamBuilderPick {
  positionId: string;
  count: number;
  chosenSkills?: string[];
}

interface Inducement {
  key: string;
  label: string;
  price: number;
  max: number | null;
  allowed: boolean;
}

interface InducementPick {
  key: string;
  count: number;
}

interface TeamBuilderBody {
  teamId?: string;
  rosterId: string;
  coach: string;
  teamName: string;
  picks: TeamBuilderPick[];
  reRolls?: number;
  apothecary?: boolean;
  cheerleaders?: number;
  assistantCoaches?: number;
  dedicatedFans?: number;
  budget?: number;
  password?: string;
  custom?: boolean;
  packageName?: string;
  specialRule?: string;
  inducements?: InducementPick[];
  /** Owner: the coach's chosen skill pack (label) when the package offers choose-one packs.
   *  Recording/fits-chosen validation = Veers's half; today's server validates fits-any and
   *  ignores the field, so sending it is forward-compatible. */
  skillPack?: string;
}

/** Echoed by preview/build only when a tournament package was selected (server: teamBuilderPackage.ts
 *  packageResponseInfo). Absent on plain baseline calls, and absent from an old server that doesn't
 *  yet understand packageName — the two "no package echo" cases the UI must tell apart. */
interface TournamentPackageInfo {
  name: string;
  description?: string;
  budget: number | null;
}

interface TeamBuilderSummary {
  skillPointsUsed: number;
  skillPointBudget: number;
  goldUsed: number;
  goldBudget: number;
  playerCount: number;
  primarySkillCount: number;
  secondarySkillCount: number;
  // Owner 08-10 (Veers 99822cf): the authoritative gold breakdown composing goldUsed. Optional — a server
  // that predates the field leaves them absent and the 3 lines simply don't render (goldUsed total stands).
  staffCost?: number;
  inducementsCost?: number;
  skillsCost?: number;
}

type FindingEntry = string | Record<string, unknown>;

interface PreviewResponse {
  valid: boolean;
  errors: FindingEntry[];
  warnings: FindingEntry[];
  players: unknown;
  summary: TeamBuilderSummary;
}

interface TournamentPackageListing {
  name: string;
  date?: string;
  description?: string;
}

interface BuildResult {
  kind: 'success' | 'error';
  message: string;
  teamId?: string;
}

type StaffKey = 'reRolls' | 'assistantCoaches' | 'cheerleaders' | 'dedicatedFans' | 'apothecary';
const ADVANCEMENT_METHODS = ['randomPrimary', 'chosenPrimary', 'chosenSecondary', 'characteristic'] as const;
type AdvancementMethod = typeof ADVANCEMENT_METHODS[number];

const inTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
const inlineCoach = ref('');
const inlinePassword = ref('');
const resolvedCreds = computed(() => resolveJoinCreds());
const needsInlineCreds = computed(() => !resolvedCreds.value.coach.trim());
const coach = computed(() => needsInlineCreds.value ? inlineCoach.value.trim() : resolvedCreds.value.coach);
const password = computed(() => needsInlineCreds.value ? inlinePassword.value : resolvedCreds.value.password);
const mode = ref<BuilderMode>(props.initialMode);
const teamName = ref('');
// SR-27 follow-up (owner 08-17): teamName is required server-side (composeFromBody throws "teamName is
// required." on preview/build) — an unnamed team's preview call 400s every debounce cycle, so the Team
// Value panel sits on UNAVAILABLE forever. Gate player-adding on a name so that failure mode is unreachable
// in normal flow, and surface a status-copy notice (the builder's existing status-copy idiom) on the attempt.
const addPlayerNotice = ref('');
let addPlayerNoticeTimer: ReturnType<typeof setTimeout> | null = null;
const rosterId = ref('');
const rosters = ref<Roster[]>([]);
const rosterStatus = ref('Loading rosters…');
const leagueSelection = ref<LeagueSelection>({ selectedLeague: '', explicit: false });
const selectedLeague = computed(() => leagueSelection.value.selectedLeague);
const leagueChangeNotice = ref('');
const library = ref<LibraryTeam[]>([]);
const libraryStatus = ref('');
const selectedLibraryTeam = ref<LibraryTeam | null>(null);
const selectedLibraryTeamDetail = ref<LibraryTeamDetail | null>(null);
const libraryDetailStatus = ref('');
const libraryIngestOpen = ref(false);
const libraryIngestDialog = ref<HTMLElement | null>(null);
const advancementPlayer = ref<LibraryPlayerDetail | null>(null);
const advancementDialog = ref<HTMLElement | null>(null);
const advancementMethod = ref<AdvancementMethod>('chosenPrimary');
const advancementCategory = ref('');
const advancementSkill = ref('');
const characteristicFallbackAccess = ref<'primary' | 'secondary'>('primary');
const pendingAdvancementRoll = ref<PendingAdvancementRoll | null>(null);
const advancementBusy = ref(false);
const advancementStatus = ref('');
let libraryIngestReturnFocus: HTMLElement | null = null;
let advancementReturnFocus: HTMLElement | null = null;
const editingLibraryTeamId = ref<string | null>(null);
const editRulesetHint = ref('');
const selectedLibraryTeamEditUnavailable = computed(() => (
  selectedLibraryTeamDetail.value !== null
  && (selectedLibraryTeamDetail.value.canEditRoster.available !== true || rosterForRace(selectedLibraryTeamDetail.value.race) === null)
));
const selectedLibraryTeamEditTitle = computed(() => (
  selectedLibraryTeamDetail.value?.canEditRoster.available !== true
    ? selectedLibraryTeamDetail.value?.canEditRoster.reason ?? "Your server role doesn't allow whole-roster editing for this team."
    : selectedLibraryTeamEditUnavailable.value
      ? "This race has no builder roster; editing isn't available."
      : undefined
));
let libraryDetailRequestId = 0;
const retiringTeamIds = ref<ReadonlySet<string>>(new Set());
const retireStatus = ref('');
const slots = ref<Array<Slot | null>>(Array.from({ length: 16 }, () => null));
const rosterGoldBudget = ref<number | null>(null);
const budgetOverride = ref<number | null>(null);
const budgetEditorOpen = ref(false);
// Tournament ruleset picker (owner GO). packages = GET /api/packages listing (name/description, no auth
// needed — a public read like /api/skills). selectedPackageName rides preview/build as packageName.
// tournamentPackageInfo is the LANDED preview echo (name/description/budget) — the authoritative source
// once a preview has succeeded; the listing's description is only a placeholder until then.
const tournamentPackages = ref<TournamentPackageListing[]>([]);
const tournamentPackagesStatus = ref('');
const selectedPackageName = ref(props.initialPackageName);
const tournamentPackageInfo = ref<TournamentPackageInfo | null>(null);
// Derived ruleset rules (owner 08-18): GET /api/packages/<name>?roster=<race> `rules` block —
// tier summary + the selected race's rules + its budget. Unlike the preview echo above, this
// lands WITHOUT a composed sheet (a preview 400s until picks + coach + team name exist), so
// the budget can lock and the ruleset panels render the moment the ruleset/roster is chosen.
const packageRules = ref<PackageRules | null>(null);
let packageRulesRequestId = 0;
const preview = ref<PreviewResponse | null>(null);
const previewStatus = ref('Waiting for a roster to preview.');
const previewPending = ref(false);
// SR-27 (owner 08-17): the roster a landed preview.value belongs to. schedulePreview only wipes preview.value
// when the roster itself changes (stale numbers from the OLD team would be meaningless) — an in-place edit on
// the SAME roster keeps showing the last-landed values (stale-while-revalidate) instead of flashing to 0/—.
const previewRosterId = ref<string | null>(null);
const buildBusy = ref(false);
const buildResult = ref<BuildResult | null>(null);
const buildErrors = ref<FindingEntry[]>([]);
const inducements = ref<Inducement[]>([]);
const inducementCounts = ref<Record<string, number>>({});
const inducementStatus = ref('');
const failedSpriteUrls = ref<ReadonlySet<string>>(new Set());
const fumbblCoachName = ref('');
const fumbblCoachTeams = ref<FumbblCoachTeam[]>([]);
const fumbblCoachTeamsStatus = ref('');
const fumbblCoachTeamsBusy = ref(false);
const importingFumbblTeamIds = ref<ReadonlySet<number>>(new Set());
const importedFumbblTeamIds = ref<ReadonlySet<number>>(new Set());
const fumbblCoachTeamsCache = ref(new Map<string, FumbblCoachTeamsResult>());
let previewTimer: ReturnType<typeof setTimeout> | null = null;
let previewController: AbortController | null = null;
let previewRequestId = 0;
let inducementRequestId = 0;

const staff = reactive<Record<StaffKey, number>>({
  reRolls: 0,
  assistantCoaches: 0,
  cheerleaders: 0,
  dedicatedFans: 0,
  apothecary: 0,
});

const fantasyNames = [
  'Aldric Ashfall', 'Brunna Blackbriar', 'Corvin Crowmantle', 'Dagna Doomwhistle',
  'Eldric Emberhelm', 'Fenra Frostfoot', 'Garrik Grimward', 'Hesta Hexblade',
  'Ivor Ironroot', 'Jora Jadefang', 'Kestrel Knucklebone', 'Ludo Lightfoot',
  'Mara Moonscar', 'Nim Nightjar', 'Orin Oathkeeper', 'Petra Pike',
];

const staffRows: Array<{ key: StaffKey; label: string; min: number; max: number; cost: number }> = [
  { key: 'reRolls', label: 'Re-rolls', min: 0, max: 8, cost: 0 },
  { key: 'assistantCoaches', label: 'Assistant Coaches', min: 0, max: 6, cost: 10_000 },
  { key: 'cheerleaders', label: 'Cheerleaders', min: 0, max: 12, cost: 10_000 },
  { key: 'dedicatedFans', label: 'Dedicated Fans', min: 0, max: 7, cost: 10_000 },
  { key: 'apothecary', label: 'Apothecary', min: 0, max: 1, cost: 50_000 },
];

function errText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return String(error);
}

// Owner ruling 08-17: config-web calls authenticate with a session token, not a password parameter.
// Third of three copies of this helper pair (forkChallenge.ts, TeamManagement.vue) — all three now
// attach auth through the shared configWebAuth seam; folding them into one helper is a follow-up.
const transport: (input: string, init?: RequestInit) => Promise<Response> =
  (input, init) => (inTauri ? tauriFetch(input, init) : fetch(input, init));
function forkCreds(): { coach: string; password: string } {
  return { coach: settings.coach40k ?? '', password: coachPassword() };
}

async function botGet(path: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  let retried = false;
  for (;;) {
    const auth = await authorizeForkRequest(path, params, forkCreds(), transport, botConfigBaseUrl());
    const query = new URLSearchParams(auth.payload as Record<string, string>).toString();
    let response: Response;
    try {
      response = await transport(`${botConfigBaseUrl()}/api/fork/${path}?${query}`, { headers: auth.headers });
    } catch (error) {
      throw new Error(configWebUnreachableMessage(botConfigBaseUrl(), errText(error)));
    }
    if (shouldRetryAfterUnauthorized(response.status, auth.authorized, retried)) { retried = true; continue; }
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok || data.error) throw new Error(String(data.error ?? `HTTP ${response.status}`));
    return data;
  }
}

class TeamApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly data: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'TeamApiError';
  }
}

async function teamDetailGet(teamId: string): Promise<Record<string, unknown>> {
  const path = `teams/${encodeURIComponent(teamId)}/detail`;
  let retried = false;
  for (;;) {
    const auth = await authorizeForkRequest(path, {}, forkCreds(), transport, botConfigBaseUrl());
    let response: Response;
    try {
      response = await transport(`${botConfigBaseUrl()}/api/${path}`, { headers: auth.headers });
    } catch (error) {
      throw new Error(configWebUnreachableMessage(botConfigBaseUrl(), errText(error)));
    }
    if (shouldRetryAfterUnauthorized(response.status, auth.authorized, retried)) { retried = true; continue; }
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok || data.error) throw new TeamApiError(String(data.error ?? `HTTP ${response.status}`), response.status, data);
    return data;
  }
}

async function teamAdvancementPost(teamId: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const path = `teams/${encodeURIComponent(teamId)}/advancement`;
  let retried = false;
  for (;;) {
    const auth = await authorizeForkRequest(path, body, forkCreds(), transport, botConfigBaseUrl());
    let response: Response;
    try {
      response = await transport(`${botConfigBaseUrl()}/api/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth.headers },
        body: JSON.stringify(auth.payload),
      });
    } catch (error) {
      throw new Error(configWebUnreachableMessage(botConfigBaseUrl(), errText(error)));
    }
    if (shouldRetryAfterUnauthorized(response.status, auth.authorized, retried)) { retried = true; continue; }
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok || data.error) throw new TeamApiError(String(data.error ?? `HTTP ${response.status}`), response.status, data);
    return data;
  }
}

async function apiGet(path: string): Promise<Record<string, unknown>> {
  const url = `${botConfigBaseUrl()}/api/${path}`;
  let response: Response;
  try {
    response = inTauri ? await tauriFetch(url) : await fetch(url);
  } catch (error) {
    throw new Error(configWebUnreachableMessage(botConfigBaseUrl(), errText(error)));
  }
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok || data.error) throw new Error(String(data.error ?? `HTTP ${response.status}`));
  return data;
}

class BotPostError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly data: Record<string, unknown>,
  ) {
    super(message);
  }
}

async function botPost(path: string, body: object, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const url = `${botConfigBaseUrl()}/api/fork/${path}`;
  let retried = false;
  for (;;) {
    const auth = await authorizeForkRequest(path, body as Record<string, unknown>, forkCreds(), transport, botConfigBaseUrl());
    let response: Response;
    try {
      const init: RequestInit = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth.headers },
        body: JSON.stringify(auth.payload),
        signal,
      };
      response = await transport(url, init);
    } catch (error) {
      throw new Error(configWebUnreachableMessage(botConfigBaseUrl(), errText(error)));
    }
    if (shouldRetryAfterUnauthorized(response.status, auth.authorized, retried)) { retried = true; continue; }
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok || data.error) {
      throw new BotPostError(String(data.error ?? `HTTP ${response.status}`), response.status, data);
    }
    return data;
  }
}

async function loadRosters(): Promise<void> {
  try {
    const data = await botGet('rosters', {});
    rosters.value = (data.rosters as Roster[]) ?? [];
    const returnedBudget = Number(data.goldBudget);
    rosterGoldBudget.value = Number.isFinite(returnedBudget) && returnedBudget >= 0 ? returnedBudget : null;
    rosterId.value = rosters.value[0]?.rosterId ?? '';
    rosterStatus.value = rosters.value.length ? '' : 'No buildable rosters were returned.';
  } catch (error) {
    rosters.value = [];
    rosterGoldBudget.value = null;
    rosterStatus.value = `Couldn't load rosters (${errText(error)}).`;
  }
}

async function loadTournamentPackages(): Promise<void> {
  try {
    const data = await apiGet('packages');
    const list = Array.isArray(data.packages) ? data.packages : Array.isArray(data) ? data : [];
    tournamentPackages.value = (list as TournamentPackageListing[]).filter((p) => typeof p?.name === 'string');
    if (!selectedPackageName.value) selectedPackageName.value = tournamentPackages.value[0]?.name ?? '';
    tournamentPackagesStatus.value = tournamentPackages.value.length ? '' : 'No tournament packages are saved yet.';
  } catch (error) {
    tournamentPackages.value = [];
    tournamentPackagesStatus.value = `Couldn't load tournament packages (${errText(error)}).`;
  }
}

// Fetch the selected package's derived rules (+ the current race's, when one is chosen).
// Failure or an old server (no `rules` block) leaves packageRules null — the view then
// falls back to the prose description note and manual budget entry, never blocks.
async function loadPackageRules(): Promise<void> {
  const requestId = ++packageRulesRequestId;
  if (mode.value !== 'tournament' || !selectedPackageName.value) {
    packageRules.value = null;
    return;
  }
  const race = currentRoster.value?.raceName ?? '';
  const path = `packages/${encodeURIComponent(selectedPackageName.value)}${race ? `?roster=${encodeURIComponent(race)}` : ''}`;
  try {
    const data = await apiGet(path);
    if (requestId !== packageRulesRequestId) return;
    packageRules.value = packageRulesFrom(data.rules);
  } catch {
    if (requestId === packageRulesRequestId) packageRules.value = null;
  }
}

async function loadLibrary(): Promise<void> {
  if (!coach.value) {
    libraryStatus.value = 'Set your Super FUMBBL coach name in Settings → Connection.';
    return;
  }
  try {
    const data = await botGet('library', { coach: coach.value });
    library.value = (data.teams as LibraryTeam[]) ?? [];
    libraryStatus.value = library.value.length ? '' : 'No teams are currently in your fork library.';
  } catch (error) {
    library.value = [];
    libraryStatus.value = `Couldn't load your teams (${errText(error)}).`;
  }
}

async function loadInducements(packageName = ''): Promise<void> {
  const requestId = ++inducementRequestId;
  inducementStatus.value = 'Loading inducements...';
  try {
    const data = await botGet('team-builder/inducements', { packageName });
    if (requestId !== inducementRequestId) return;
    inducements.value = (data.inducements as Inducement[]) ?? [];
    const nextCounts: Record<string, number> = {};
    for (const item of inducements.value) {
      const count = item.allowed ? Math.max(0, Math.floor(inducementCounts.value[item.key] ?? 0)) : 0;
      nextCounts[item.key] = item.max === null ? count : Math.min(count, Math.max(0, item.max));
    }
    inducementCounts.value = nextCounts;
    inducementStatus.value = inducements.value.length ? '' : 'No inducements are available for this package.';
  } catch (error) {
    if (requestId !== inducementRequestId) return;
    inducements.value = [];
    inducementCounts.value = {};
    inducementStatus.value = `Couldn't load inducements (${errText(error)}).`;
  }
}

async function selectLibraryTeam(team: LibraryTeam): Promise<void> {
  const requestId = ++libraryDetailRequestId;
  selectedLibraryTeam.value = team;
  selectedLibraryTeamDetail.value = null;
  libraryDetailStatus.value = 'Loading player roster…';
  try {
    const data = await teamDetailGet(team.teamId);
    if (requestId !== libraryDetailRequestId || selectedLibraryTeam.value?.teamId !== team.teamId) return;
    if (!data.team || typeof data.team !== 'object') throw new Error('Team detail response was incomplete.');
    const detail = data.team as LibraryTeamDetail;
    selectedLibraryTeamDetail.value = detail;
    library.value = library.value.map((entry) => entry.teamId === detail.id
      ? { ...entry, teamName: detail.name, race: detail.race, teamValue: detail.teamValue, gold: detail.treasury, rerolls: detail.rerolls, fanFactor: detail.fanFactor, apothecary: detail.apothecary }
      : entry);
    selectedLibraryTeam.value = library.value.find((entry) => entry.teamId === detail.id) ?? team;
    libraryDetailStatus.value = '';
    resumePendingAdvancement(detail);
  } catch (error) {
    if (requestId !== libraryDetailRequestId) return;
    libraryDetailStatus.value = `Couldn't load player roster (${errText(error)}).`;
  }
}

function resumePendingAdvancement(detail: LibraryTeamDetail): void {
  const player = detail.players.find((entry) => entry.pendingAdvancement !== null);
  const pending = player?.pendingAdvancement ?? null;
  if (!pending) return;
  if (!player || player.id !== pending.playerId) {
    pendingAdvancementRoll.value = null;
    advancementStatus.value = 'The server returned an advancement choice for a player that is no longer on this roster. Refresh before continuing.';
    return;
  }
  advancementReturnFocus ??= document.activeElement instanceof HTMLElement ? document.activeElement : null;
  advancementPlayer.value = player;
  advancementMethod.value = pending.method;
  advancementCategory.value = player.primaryCategories[0] ?? '';
  pendingAdvancementRoll.value = pending;
  characteristicFallbackAccess.value = pending.primaryFallbacks.length ? 'primary' : 'secondary';
  advancementSkill.value = pending.primaryFallbacks[0] ?? pending.secondaryFallbacks[0] ?? '';
  advancementStatus.value = 'Finish this server-held advancement choice before leaving or starting another advancement.';
}

function returnToLibraryList(): void {
  if (pendingAdvancementRoll.value) {
    advancementStatus.value = 'Finish this server-held advancement choice before leaving the team.';
    return;
  }
  libraryDetailRequestId += 1;
  selectedLibraryTeam.value = null;
  selectedLibraryTeamDetail.value = null;
  libraryDetailStatus.value = '';
  closeAdvancement();
}

function openLibraryIngest(trigger?: HTMLElement): void {
  libraryIngestReturnFocus = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  libraryIngestOpen.value = true;
}

function closeLibraryIngest(): void {
  libraryIngestOpen.value = false;
}

function focusableElements(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  return Array.from(container.querySelectorAll<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
  )).filter((entry) => !entry.hidden && entry.getAttribute('aria-hidden') !== 'true');
}

function trapModalFocus(event: KeyboardEvent, container: HTMLElement | null): void {
  if (event.key !== 'Tab') return;
  const focusable = focusableElements(container);
  if (!focusable.length) {
    event.preventDefault();
    container?.focus();
    return;
  }
  const first = focusable[0]!;
  const last = focusable[focusable.length - 1]!;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function onIngestDialogKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    closeLibraryIngest();
    return;
  }
  trapModalFocus(event, libraryIngestDialog.value);
}

function onAdvancementDialogKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    if (!pendingAdvancementRoll.value && !advancementBusy.value) closeAdvancement();
    else advancementStatus.value = 'Finish this server-held advancement choice before closing.';
    return;
  }
  trapModalFocus(event, advancementDialog.value);
}

function onAdvancementTabsKeydown(event: KeyboardEvent): void {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const tabs = Array.from((event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('[role="tab"]:not([disabled])'));
  if (!tabs.length) return;
  event.preventDefault();
  const current = tabs.indexOf(document.activeElement as HTMLButtonElement);
  const index = event.key === 'Home'
    ? 0
    : event.key === 'End'
      ? tabs.length - 1
      : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  const tab = tabs[index]!;
  const method = tab.id.replace('advancement-tab-', '') as AdvancementMethod;
  advancementMethod.value = method;
  tab.focus();
}

watch(libraryIngestOpen, async (open) => {
  if (open) {
    await nextTick();
    (libraryIngestDialog.value?.querySelector<HTMLInputElement>('input') ?? focusableElements(libraryIngestDialog.value)[0])?.focus();
  } else {
    const target = libraryIngestReturnFocus;
    libraryIngestReturnFocus = null;
    await nextTick();
    target?.focus();
  }
});

watch(advancementPlayer, async (player, previous) => {
  if (player && !previous) {
    await nextTick();
    (advancementDialog.value?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]') ?? focusableElements(advancementDialog.value)[0])?.focus();
  } else if (!player && previous) {
    const target = advancementReturnFocus;
    advancementReturnFocus = null;
    await nextTick();
    target?.focus();
  }
});

function openAdvancement(player: LibraryPlayerDetail, trigger?: HTMLElement): void {
  advancementReturnFocus = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  advancementPlayer.value = player;
  advancementMethod.value = ADVANCEMENT_METHODS.find((method) => player.advancementMethods[method]?.available) ?? 'chosenPrimary';
  advancementCategory.value = player.primaryCategories[0] ?? '';
  advancementSkill.value = player.primarySkills[0] ?? '';
  characteristicFallbackAccess.value = 'primary';
  pendingAdvancementRoll.value = null;
  advancementStatus.value = '';
}

function canAdvancePlayer(player: LibraryPlayerDetail): boolean {
  if (!player.advancementCosts) return false;
  return ADVANCEMENT_METHODS.some((method) => (
    player.advancementMethods[method]?.available === true && player.advancementCosts![method] <= player.spp
  ));
}

function closeAdvancement(): void {
  if (advancementBusy.value || pendingAdvancementRoll.value) {
    if (pendingAdvancementRoll.value) advancementStatus.value = 'Finish this server-held advancement choice before closing.';
    return;
  }
  advancementPlayer.value = null;
  pendingAdvancementRoll.value = null;
  advancementStatus.value = '';
}

const advancementMethodSkills = computed(() => {
  const player = advancementPlayer.value;
  if (!player) return [];
  if (pendingAdvancementRoll.value?.method === 'characteristic') {
    return characteristicFallbackAccess.value === 'secondary'
      ? pendingAdvancementRoll.value.secondaryFallbacks
      : pendingAdvancementRoll.value.primaryFallbacks;
  }
  return advancementMethod.value === 'chosenSecondary' ? player.secondarySkills : player.primarySkills;
});

watch(advancementMethod, () => {
  advancementSkill.value = advancementMethodSkills.value[0] ?? '';
  if (!pendingAdvancementRoll.value) advancementStatus.value = '';
});
watch(characteristicFallbackAccess, () => {
  advancementSkill.value = advancementMethodSkills.value[0] ?? '';
});

async function refreshSelectedLibraryTeam(): Promise<void> {
  const selected = selectedLibraryTeam.value;
  if (selected) await selectLibraryTeam(selected);
}

function advancementMethodAvailable(method: AdvancementMethod): boolean {
  return advancementPlayer.value?.advancementMethods[method]?.available === true;
}

function advancementMethodReason(method: AdvancementMethod): string | undefined {
  return advancementPlayer.value?.advancementMethods[method]?.reason;
}

async function submitAdvancement(body: Record<string, unknown>, revisionOverride?: string): Promise<Record<string, unknown> | null> {
  const team = selectedLibraryTeamDetail.value;
  const player = advancementPlayer.value;
  if (!team || !player || advancementBusy.value) return null;
  advancementBusy.value = true;
  advancementStatus.value = '';
  try {
    return await teamAdvancementPost(team.id, { playerId: player.id, revision: revisionOverride ?? team.revision, ...body });
  } catch (error) {
    if (error instanceof TeamApiError && error.status === 409) {
      const playerId = player.id;
      pendingAdvancementRoll.value = null;
      await refreshSelectedLibraryTeam();
      const refreshedPlayer = selectedLibraryTeamDetail.value?.players.find((entry) => entry.id === playerId) ?? null;
      advancementPlayer.value = refreshedPlayer;
      advancementStatus.value = 'The team changed on the server. The latest roster and SPP have been loaded; review them and try again. Nothing was submitted twice.';
    } else if (error instanceof TeamApiError && error.status === 401) {
      advancementStatus.value = 'Your coach session is no longer authorized. Reconnect in Settings, then retry this advancement.';
    } else {
      advancementStatus.value = errText(error);
    }
    return null;
  } finally {
    advancementBusy.value = false;
  }
}

async function applyChosenAdvancement(): Promise<void> {
  if (!advancementSkill.value || (advancementMethod.value !== 'chosenPrimary' && advancementMethod.value !== 'chosenSecondary')) return;
  const data = await submitAdvancement({ action: 'applySkill', method: advancementMethod.value, skill: advancementSkill.value });
  if (!data?.ok) return;
  closeAdvancement();
  await refreshSelectedLibraryTeam();
}

async function rollAdvancement(): Promise<void> {
  const player = advancementPlayer.value;
  if (!player) return;
  const body = advancementMethod.value === 'randomPrimary'
    ? { action: 'rollRandomPrimary', category: advancementCategory.value }
    : { action: 'rollCharacteristic' };
  const data = await submitAdvancement(body);
  if (data?.pending && typeof data.pending === 'object') {
    pendingAdvancementRoll.value = data.pending as PendingAdvancementRoll;
    advancementStatus.value = 'This roll is held by the server. Choose an offered result to finish the advancement.';
  }
}

async function commitRolledSkill(skill: string, access?: 'primary' | 'secondary'): Promise<void> {
  const pending = pendingAdvancementRoll.value;
  if (!pending) return;
  const data = await submitAdvancement({ action: 'commitRoll', token: pending.token, choice: { type: 'skill', skill, ...(access ? { access } : {}) } }, pending.revision);
  if (!data?.ok) return;
  closeAdvancement();
  await refreshSelectedLibraryTeam();
}

async function commitRolledCharacteristic(characteristic: string): Promise<void> {
  const pending = pendingAdvancementRoll.value;
  if (!pending) return;
  const data = await submitAdvancement({ action: 'commitRoll', token: pending.token, choice: { type: 'characteristic', characteristic } }, pending.revision);
  if (!data?.ok) return;
  closeAdvancement();
  await refreshSelectedLibraryTeam();
}

// Owner ruling 08-18 "Retire Team": config-web's authenticated POST soft-flags the
// library row (never a hard delete — game history keeps resolving the teamId) and only the
// OWNING coach may retire (enforced server-side against the authenticated coach). Confirm is a
// plain window.confirm — the app's existing destructive-action idiom (App.vue replay-swap,
// SpectateView.vue delete-saved-setup) — before the irreversible-feeling drop from the grid.
async function confirmRetireTeam(team: LibraryTeam): Promise<void> {
  if (retiringTeamIds.value.has(team.teamId)) return;
  if (!window.confirm(`Retire "${team.teamName}"? It will drop out of your fork team library.`)) return;
  retiringTeamIds.value = new Set([...retiringTeamIds.value, team.teamId]);
  retireStatus.value = '';
  try {
    await botPost('library/retire', { teamId: team.teamId });
    library.value = library.value.filter((t) => t.teamId !== team.teamId);
    if (selectedLibraryTeam.value?.teamId === team.teamId) {
      libraryDetailRequestId += 1;
      selectedLibraryTeam.value = null;
      selectedLibraryTeamDetail.value = null;
      libraryDetailStatus.value = '';
    }
    retireStatus.value = `✓ Retired "${team.teamName}".`;
  } catch (error) {
    retireStatus.value = `Couldn't retire "${team.teamName}" (${errText(error)}).`;
  } finally {
    retiringTeamIds.value = new Set([...retiringTeamIds.value].filter((id) => id !== team.teamId));
  }
}

onMounted(() => {
  fumbblCoachName.value = settings.coach.trim();
  void (async () => {
    // Load the metadata-only register before resolving legacy named iconset keys.
    // Media is supplied only by an installed local pack; missing rows use placeholders.
    await loadIconsetManifest();
    await Promise.all([loadRosters(), loadLibrary(), loadTournamentPackages()]);
  })();
});

watch(() => props.launchRevision, () => {
  mode.value = props.initialMode;
  selectedPackageName.value = props.initialPackageName;
  tournamentPackageInfo.value = null;
});

const currentRoster = computed(() => rosters.value.find((roster) => roster.rosterId === rosterId.value) ?? null);
const leagueOptions = computed(() => normalizeLeagueOptions(currentRoster.value?.leagueOptions));
const leaguePresentation = computed(() => leagueFieldPresentation(leagueOptions.value, leagueSelection.value));
const hasLeagueField = computed(() => leaguePresentation.value.visible);
const hasLeagueMenu = computed(() => leaguePresentation.value.interactive);
const leagueSelectionRequired = computed(() => leaguePresentation.value.selectionRequired);
const activeLeague = computed(() => leaguePresentation.value.selectedValid ? selectedLeague.value : '');
const leagueSelectModel = computed<string>({
  get: () => activeLeague.value,
  set: (league) => { leagueSelection.value = explicitLeagueSelection(leagueOptions.value, league); },
});
const selectedLeagueSpecialRule = computed(() => explicitLeagueSpecialRule(leagueOptions.value, leagueSelection.value));
const isBuildMode = computed(() => mode.value === 'create' || mode.value === 'custom');
const isEditingLibraryTeam = computed(() => editingLibraryTeamId.value !== null);
// Owner: Tournament Team gains Create + validation. The preview already runs in tournament mode and
// teamBuilderBody already threads packageName/budget/inducements — only these two gates excluded it.
const canValidateTeam = computed(() => isBuildMode.value || mode.value === 'tournament');
const canSubmitTeam = computed(() => canValidateTeam.value || isEditingLibraryTeam.value);
const teamNameMissing = computed(() => canSubmitTeam.value && !teamName.value.trim());
// TB2 (owner 08-11): per-player skill editing (the "+ Skill" affordance) is a Custom/Tournament feature only —
// a plain Create build takes printed rosters as-is, so Create suppresses it.
const canEditSkills = computed(() => mode.value === 'custom' || mode.value === 'tournament');
// Star players have their own curated card, so keep them out of the standard Add Players grid. The slot resolver
// still reads the unfiltered roster positions, allowing star picks to ride the existing slot/picks flow.
const positions = computed(() => [...(currentRoster.value?.positions ?? [])].filter((p) => !p.isStar).sort((a, b) => b.cost - a.cost));
// Star packages are roster choices, not individual position rows: upstream teamWithPositionId pairs occupy two
// slots and serialize two position ids, but appear as one purchase in the builder.
const allStarChoices = computed(() => buildTeamBuilderStarChoices(currentRoster.value?.positions ?? []));
const starChoices = computed(() => allStarChoices.value
  .filter((choice) => choice.members.every((position) => starEligibleForLeague(position)))
  .sort((left, right) => left.label.localeCompare(right.label)));
// Owner: Tournament stars feed from the Tournament Rules logic (packageRaceRules via the race view):
// the allowed flag, the banned list, tier SP pricing — which also DEFINES the available set when the
// package prices stars per tier ("stars with no price in the tier are omitted") — and the maxCount cap.
const tournamentStarRules = computed(() => (
  mode.value === 'tournament' && rulesetPanelView.value.kind === 'race' ? rulesetPanelView.value.race : null
));
const normStarName = (value: string) => value.toLocaleLowerCase().trim();
const tournamentStarChoices = computed(() => {
  const rules = tournamentStarRules.value;
  if (!rules || !rules.stars.allowed) return [];
  const banned = new Set(rules.bannedStars.map(normStarName));
  const priced = rules.stars.spCosts?.length ? new Set(rules.stars.spCosts.map((star) => normStarName(star.name))) : null;
  return allStarChoices.value
    // Owner 09-09: the pick-one league rule gates tournament stars exactly as it gates custom builds — Rodney
    // Roachbait (Woodland League) was offered to a Halfling Thimble Cup team because only bans/pricing filtered here.
    .filter((choice) => choice.members.every((member) => starEligibleForLeague(member)))
    .filter((choice) => choice.members.every((member) => !banned.has(normStarName(member.name))))
    .filter((choice) => !priced || choice.members.some((member) => priced.has(normStarName(member.name))))
    .sort((left, right) => left.label.localeCompare(right.label));
});
/** Tier SP price for a star choice (pairs sum their priced members); null = gold-priced package. */
function tournamentStarSp(choice: { members: Position[] }): number | null {
  const costs = tournamentStarRules.value?.stars.spCosts;
  if (!costs?.length) return null;
  const byName = new Map(costs.map((star) => [normStarName(star.name), star.sp]));
  return choice.members.reduce((sum, member) => sum + (byName.get(normStarName(member.name)) ?? 0), 0);
}
const displayedStarChoices = computed(() => (mode.value === 'tournament' ? tournamentStarChoices.value : starChoices.value));
const rosterStarCount = computed(() => filledSlots.value.filter((slot) => positionById(slot.positionId)?.isStar).length);
const tournamentStarCapReached = computed(() => {
  const max = tournamentStarRules.value?.stars.maxCount;
  return max != null && rosterStarCount.value >= max;
});
const starSectionVisible = computed(() => mode.value === 'custom' || (mode.value === 'tournament' && tournamentStarRules.value?.stars.allowed === true));
const tournamentRaceDataNote = computed(() => (rulesetPanelView.value.kind === 'race' ? rulesetPanelView.value.dataNote ?? null : null));
// Owner 09-09: the live "SP used/remaining" tracker prices skills from the PACK's skillCosts (config-web
// packageRaceRules) — primary/secondary base, elite surcharge, and the per-player stacking surcharge for every
// skill beyond the first — so World Cup (6/10, +2 elite, +2 stacking) reads 6 → 14 for two primaries, not 1 → 2.
// An older server without skillCosts keeps the owner default model (1 / 2 / +0.5).
const skillCosts = computed<SkillCosts>(() => tournamentStarRules.value?.skillCosts ?? DEFAULT_SKILL_COSTS);
function slotSkillSp(slot: Slot): number {
  const set = legalSkillsCache.get(`${rosterId.value}:${slot.positionId}`);
  return playerSkillSp(slot.chosenSkills, (name) => !!set?.secondary.find((entry) => entry.skill === name), skillCosts.value);
}
/** Star SP spend (paid-in-SP packages): each filled star slot priced from the tier's spCosts table. */
const starSpUsed = computed(() => {
  const rules = tournamentStarRules.value;
  if (!rules?.stars.paidInSkillPoints || !rules.stars.spCosts?.length) return 0;
  const byName = new Map(rules.stars.spCosts.map((star) => [normStarName(star.name), star.sp]));
  return filledSlots.value.reduce((sum, slot) => {
    const position = positionById(slot.positionId);
    return sum + (position?.isStar ? byName.get(normStarName(position.name)) ?? 0 : 0);
  }, 0);
});
const spUsed = computed(() => filledSlots.value.reduce((sum, slot) => sum + slotSkillSp(slot), 0) + starSpUsed.value);
const spBudget = computed(() => selectedPackSummary.value?.skillPointBudget ?? tournamentStarRules.value?.skillPointBudget ?? null);
const spRemaining = computed(() => (spBudget.value != null ? spBudget.value - spUsed.value : null));
// Owner: the SP table lists only the stars THIS roster can actually field (the offered star choices,
// bans already applied) — not every star priced in the tier — and the whole block is collapsible.
const starSpOpen = ref(false);
const teamStarSpRows = computed(() => {
  const costs = tournamentStarRules.value?.stars.spCosts;
  if (!costs?.length) return [];
  const offered = new Set(tournamentStarChoices.value.flatMap((choice) => choice.members.map((member) => normStarName(member.name))));
  return costs.filter((star) => offered.has(normStarName(star.name)));
});
const filledSlots = computed(() => slots.value.filter((slot): slot is Slot => slot !== null));
const picks = computed<TeamBuilderPick[]>(() => {
  // Owner 2026-08-05: a player with chosen skills rides as its OWN pick (count:1 + chosenSkills) so per-player
  // skills reach the server; skill-less players still group by position. The server preview/build sums the picks.
  const grouped = new Map<string, number>();
  const skilled: TeamBuilderPick[] = [];
  for (const slot of filledSlots.value) {
    // Kallus item 593: per-player skills only ride the build in a skill-editing mode (custom/tournament). In Create
    // any retained chosenSkills are ignored so the plain build takes the roster as-is (belt-and-suspenders with the
    // watch(mode) reset above).
    if (canEditSkills.value && slot.chosenSkills.length) skilled.push({ positionId: slot.positionId, count: 1, chosenSkills: slot.chosenSkills });
    else grouped.set(slot.positionId, (grouped.get(slot.positionId) ?? 0) + 1);
  }
  return [...Array.from(grouped, ([positionId, count]) => ({ positionId, count })), ...skilled];
});
const inducementPicks = computed<InducementPick[]>(() => Object.entries(inducementCounts.value)
  .filter(([, count]) => count > 0)
  .map(([key, count]) => ({ key, count })));
const inducementGoldTotal = computed(() => inducementPicks.value.reduce((sum, pick) => {
  const item = inducements.value.find((candidate) => candidate.key === pick.key);
  return sum + pick.count * (item?.price ?? 0);
}, 0));
const visibleSlotCount = computed(() => Math.min(16, Math.max(12, filledSlots.value.length + 1)));
const visibleSlots = computed(() => slots.value.slice(0, visibleSlotCount.value));
// Owner bucket ruling: Players = RAW position gold; added-skill gold is its OWN Skills bucket; the
// Subtotal stays pre-skills (Players + Stars + Staff + Inducements). clientEstimate (the budget check)
// keeps the full total including skills.
const rawPlayerCost = computed(() => filledSlots.value.reduce((sum, slot) => sum + (positionById(slot.positionId)?.cost ?? 0), 0));
const addedSkillGold = computed(() => filledSlots.value.reduce((sum, slot) => sum + slotSkillCost(slot), 0));
const playerCost = computed(() => rawPlayerCost.value + addedSkillGold.value);
const preSkillsEstimate = computed(() => rawPlayerCost.value + staffCost.value + inducementGoldTotal.value);
const reRollCost = computed(() => currentRoster.value?.reRollCost ?? 0);
const staffCost = computed(() => staffRows.reduce((sum, row) => {
  const unitCost = row.key === 'reRolls' ? reRollCost.value : row.cost;
  return sum + staff[row.key] * unitCost;
}, 0));
const clientEstimate = computed(() => playerCost.value + staffCost.value + inducementGoldTotal.value);
const budget = computed(() => {
  const defaultBudget = isBuildMode.value ? (rosterGoldBudget.value ?? 1_000_000) : 1_000_000;
  const requestedBudget = budgetOverride.value === null ? defaultBudget : Number(budgetOverride.value) * 1_000;
  return Number.isFinite(requestedBudget) ? Math.max(0, requestedBudget) : defaultBudget;
});
const overBudget = computed(() => clientEstimate.value > budget.value);
// ⚖ BUDGET BINDING (owner ruling, tournament ruleset MVS): once a package is selected AND its
// per-roster budget has landed (via a successful preview echo — see tournamentPackageInfo), that
// budget WINS over any manual budgetOverride for DISPLAY purposes. Kept OUT of `budget`/`teamBuilderBody`
// on purpose — teamBuilderBody is deep-watched to (re)trigger preview requests, and the resolved
// budget itself only ever arrives FROM a preview response, so folding it back into the request body
// would loop preview → new resolved budget → new request body → preview forever. body.budget is
// SL-intrinsic-only server-side anyway (composeFromBody ignores it on this path — see
// apps/config-web/src/server.ts composeFromBody), so there is no functional loss in keeping it display-only.
// The preview echo remains preferred when landed; the packageRules fetch supplies the same
// resolved budget WITHOUT needing a composed sheet (owner 08-18: the input sat empty/manual
// until picks + coach + team name existed, because a preview 400s before then).
// Owner: when the package offers choose-one skill packs (Spike-style), the coach picks one here.
// The choice is a per-(package, roster) selection: it drives the DISPLAYED budgets (same display-only
// doctrine as the budget binding below) and rides the body as `skillPack` for recording; the server
// keeps validating fits-any until Veers lands fits-chosen.
const selectedSkillPack = ref<string | null>(null);
watch([() => selectedPackageName.value, () => rosterId.value], () => { selectedSkillPack.value = null; });
const selectedPackSummary = computed(() => {
  if (mode.value !== 'tournament' || !selectedSkillPack.value) return null;
  const view = rulesetPanelView.value;
  return view.kind === 'race' ? view.race.packs.find((pack) => pack.label === selectedSkillPack.value) ?? null : null;
});
const packageResolvedBudget = computed(() => (
  mode.value === 'tournament' && selectedPackageName.value
    ? selectedPackSummary.value?.gold ?? tournamentPackageInfo.value?.budget ?? packageRules.value?.budget ?? null
    : null
));
// Owner comment on the struck budget-source row (08-18): "manual budget entry until ruleset-pack
// ingestion lands" — this slice IS that landing. Once a package's per-roster budget has resolved,
// the k-input becomes a locked DISPLAY of the pack value (auto-filled, disabled); manual entry only
// when no package is selected (or none has resolved yet).
const tournamentBudgetLocked = computed(() => packageResolvedBudget.value != null);
const tournamentBudgetInputValue = computed<number | null>({
  get: () => (tournamentBudgetLocked.value ? Math.round((packageResolvedBudget.value ?? 0) / 1_000) : budgetOverride.value),
  set: (v) => { if (!tournamentBudgetLocked.value) budgetOverride.value = v; },
});
const teamBuilderBody = computed<TeamBuilderBody>(() => ({
  ...(editingLibraryTeamId.value ? { teamId: editingLibraryTeamId.value } : {}),
  rosterId: rosterId.value,
  coach: coach.value,
  teamName: teamName.value,
  picks: picks.value,
  reRolls: staff.reRolls,
  apothecary: currentRoster.value?.apothecaryAllowed === true && staff.apothecary > 0,
  cheerleaders: staff.cheerleaders,
  assistantCoaches: staff.assistantCoaches,
  dedicatedFans: staff.dedicatedFans,
  budget: budget.value,
  ...(mode.value === 'custom' ? { custom: true } : {}),
  ...(mode.value === 'tournament' && selectedPackageName.value ? { packageName: selectedPackageName.value } : {}),
  ...(mode.value === 'tournament' && selectedSkillPack.value ? { skillPack: selectedSkillPack.value } : {}),
  ...(selectedLeagueSpecialRule.value ? { specialRule: selectedLeagueSpecialRule.value } : {}),
  ...((mode.value === 'tournament' || mode.value === 'custom') && inducementPicks.value.length ? { inducements: inducementPicks.value } : {}),
}));
// The ruleset note: prefer the LANDED preview echo (authoritative, race-aware description come from
// the same field either way); fall back to the packages-list description so the note isn't blank
// while the first preview is still in flight. Empty string ⇒ template hides the note entirely.
const rulesetNoteText = computed(() => {
  if (mode.value !== 'tournament' || !selectedPackageName.value) return '';
  if (tournamentPackageInfo.value) return tournamentPackageInfo.value.description ?? '';
  return tournamentPackages.value.find((p) => p.name === selectedPackageName.value)?.description ?? '';
});
// Which derived panel the note area shows (owner 08-18): tier summary by default, the
// selected race's rules once a roster is chosen. 'none' (old server / non-tiered pack with
// no race resolved) falls back to the prose rulesetNoteText above.
const rulesetPanelView = computed(() => (
  mode.value === 'tournament' && selectedPackageName.value
    ? rulesetPanel(packageRules.value, currentRoster.value !== null)
    : { kind: 'none' as const }
));
// Degradation (graceful, same pattern as the finished-games wire): a package is selected and a preview
// has landed for the CURRENT roster, but the response carried no `package` echo — the deployed server
// predates packageName support and silently ignored it. Tell the coach honestly rather than pretend
// the ruleset applied.
const packageValidationPending = computed(() => (
  mode.value === 'tournament'
  && !!selectedPackageName.value
  && preview.value !== null
  && previewRosterId.value === rosterId.value
  && !tournamentPackageInfo.value
));
const previewSummary = computed(() => preview.value?.summary ?? null);
// W32 (owner 08-14): the Team Value box row-set must be STATIC in build mode (create/custom) — every edit briefly
// nulls preview.value while a fresh preview is in flight (schedulePreview), which used to swap the whole box
// between a "skeleton" template and the full authoritative-preview template, mounting/unmounting rows on every
// keystroke. These three computeds let ONE unchanging row-set (rendered below) just update its text in place
// across pending/loaded/unavailable, instead of the box growing/shrinking.
// Owner ruling 08-18 (annotated screenshot): the old unavailable state doubled up "UNAVAILABLE" — once as
// the row label ("Team value unavailable") and again as the value ("unavailable"). Deleted. Unavailable now
// splits honestly on teamNameMissing (the R13 finding: an empty team name means the preview call never even
// runs, so "unavailable" forever was really just "not named yet") vs. a named team whose preview genuinely
// failed (server unreachable etc.) — the latter gets a quiet em-dash, no unavailable/error copy restated here
// (the validity card and status-copy notices carry that).
const buildTotalLabel = computed(() => {
  // Owner (annotated Create card, follow-up): NO label at all in Create — the numbers stand alone.
  // Custom keeps the authoritative wording.
  if (previewSummary.value) return mode.value === 'create' ? '' : 'Authoritative preview';
  if (previewPending.value) return 'Calculating team value…';
  if (teamNameMissing.value) return 'Please name your team';
  return 'Team value';
});
const buildTotalValue = computed(() => {
  if (previewSummary.value) return `${formatGold(previewSummary.value.goldUsed)} / ${formatGold(previewSummary.value.goldBudget)}`;
  if (previewPending.value) return `${formatGold(clientEstimate.value)} / ${formatGold(budget.value)}`;
  return '—';
});
const buildTotalOver = computed(() => previewSummary.value ? previewSummary.value.goldUsed > previewSummary.value.goldBudget : overBudget.value);
// SR-27 (owner 08-17): a fresh preview is in flight but the panel is still showing the PREVIOUS landed values
// (stale-while-revalidate) — subtle pending indicator only, never a value swap. Distinct from validityChecking
// / the "Calculating…" label, which are the true first-load case (no previous values to fall back to).
const previewRefreshing = computed(() => previewPending.value && previewSummary.value !== null);
const previewErrors = computed(() => preview.value?.errors ?? []);
const previewWarnings = computed(() => preview.value?.warnings ?? []);
const displayedErrors = computed(() => [...buildErrors.value, ...previewErrors.value]);
// TB18 (owner 08-11): the fixes shown under an invalid/custom team — errors first, then warnings.
const validityFixes = computed(() => [...displayedErrors.value, ...previewWarnings.value]);
// Transient: a preview is in flight and none has landed yet.
const validityChecking = computed(() => mode.value !== 'custom' && previewPending.value && !preview.value);
// The preview attempt finished without a result (config-web unreachable) — not the same as "invalid".
const validityUnavailable = computed(() => mode.value !== 'custom' && !previewPending.value && !preview.value);
const teamValid = computed(() => mode.value !== 'custom'
  && preview.value?.valid === true
  && displayedErrors.value.length === 0);
const validityClass = computed(() => {
  if (mode.value === 'custom') return 'custom';
  if (validityChecking.value || validityUnavailable.value) return 'checking';
  return teamValid.value ? 'valid' : 'invalid';
});

watch(
  () => ({ rosterId: rosterId.value, leagueOptions: leagueOptions.value }),
  (next, previous) => {
    const rosterChanged = next.rosterId !== (previous?.rosterId ?? '');
    if (rosterChanged) {
      resetSkillPicker();
      slots.value = Array.from({ length: 16 }, () => null);
      staff.reRolls = 0;
      staff.apothecary = 0;
      leagueChangeNotice.value = '';
      // TB5 (owner 08-11): the Team Name field starts EMPTY — no "<Race> Team" pre-populate on roster select.
    }
    const current = rosterChanged ? { selectedLeague: '', explicit: false } : leagueSelection.value;
    leagueSelection.value = reconcileLeagueSelection(next.leagueOptions, current);
  },
  { immediate: true },
);

watch(selectedLeague, (league, previousLeague) => {
  leagueChangeNotice.value = '';
  if (league === previousLeague) return;
  const choiceByMemberId = new Map<string, TeamBuilderStarChoice<Position>>();
  for (const choice of allStarChoices.value) {
    for (const member of choice.members) choiceByMemberId.set(member.positionId, choice);
  }
  const removeIds = new Set<string>();
  for (const slot of filledSlots.value) {
    const position = positionById(slot.positionId);
    if (!position?.isStar || starEligibleForLeague(position, league)) continue;
    const choice = choiceByMemberId.get(position.positionId);
    if (choice) for (const member of choice.members) removeIds.add(member.positionId);
    else removeIds.add(position.positionId);
  }
  let removed = 0;
  const next = slots.value.map((slot) => {
    if (!slot) return slot;
    if (!removeIds.has(slot.positionId)) return slot;
    removed += 1;
    return null;
  });
  if (!removed) return;
  resetSkillPicker();
  slots.value = next;
  leagueChangeNotice.value = `${removed} ineligible star player${removed === 1 ? '' : 's'} removed.`;
});

function positionById(positionId: string): Position | undefined {
  return currentRoster.value?.positions.find((position) => position.positionId === positionId);
}

function starEligibleForLeague(position: Position, league = activeLeague.value): boolean {
  return starEligibleForLeagueSelection(position.playsFor, leagueOptions.value, league);
}

function positionMax(position: Position): number {
  return Math.max(0, Number(position.max ?? position.quantity ?? 0));
}

function positionCount(positionId: string): number {
  return filledSlots.value.filter((slot) => slot.positionId === positionId).length;
}

function currentPositionCounts(): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const slot of filledSlots.value) counts.set(slot.positionId, (counts.get(slot.positionId) ?? 0) + 1);
  return counts;
}

function positionGroupState(positionId: string): PositionGroupCapState {
  return positionGroupCapState(
    positionId,
    currentRoster.value?.positionGroups,
    currentPositionCounts(),
    mode.value === 'custom',
  );
}

function positionGroupTitle(positionId: string): string | undefined {
  const state = positionGroupState(positionId);
  if (!state.capped) return undefined;
  const label = state.blockingGroups[0]?.label?.trim();
  return label ? `${label} limit reached` : 'Position group limit reached';
}

function requireTeamName(): boolean {
  if (!teamNameMissing.value) return true;
  addPlayerNotice.value = 'You must name your team.';
  if (addPlayerNoticeTimer) clearTimeout(addPlayerNoticeTimer);
  addPlayerNoticeTimer = setTimeout(() => { addPlayerNotice.value = ''; }, 3000);
  return false;
}

function addPosition(position: Position): void {
  if (!requireTeamName()) return;
  if (position.isStar && !starEligibleForLeague(position)) return;
  if (positionCount(position.positionId) >= positionMax(position)) return;
  if (positionGroupState(position.positionId).capped) return;
  const openIndex = slots.value.findIndex((slot) => slot === null);
  if (openIndex < 0) return;
  const next = [...slots.value];
  next[openIndex] = {
    positionId: position.positionId,
    name: position.isStar ? position.name : (fantasyNames[openIndex] ?? `Player ${openIndex + 1}`),
    chosenSkills: [],
  };
  slots.value = next;
}

function starChoiceHasAny(choice: TeamBuilderStarChoice<Position>): boolean {
  return choice.members.some((member) => positionCount(member.positionId) > 0);
}

function starChoiceStatus(choice: TeamBuilderStarChoice<Position>): string {
  const present = choice.members.filter((member) => positionCount(member.positionId) > 0).length;
  if (!choice.paired) return `${present} / ${positionMax(choice.members[0]!)}`;
  if (present === 0) return '0 / 1';
  if (present === choice.members.length) return '1 / 1';
  return `${present} of ${choice.members.length} present`;
}

function canAddStarChoice(choice: TeamBuilderStarChoice<Position>): boolean {
  if (starChoiceIsComplete(choice, positionCount)) return false;
  if (choice.members.some((member) => !member.isStar || !starEligibleForLeague(member))) return false;
  const missing = starChoiceMissingMembers(choice, positionCount);
  if (slots.value.filter((slot) => slot === null).length < missing.length) return false;

  // Evaluate every member against a prospective shared count map so an atomic pair cannot step over a
  // position-group cap merely because each member was legal in isolation before the click.
  const counts = new Map(currentPositionCounts());
  for (const member of missing) {
    if ((counts.get(member.positionId) ?? 0) >= positionMax(member)) return false;
    const groupState = positionGroupCapState(
      member.positionId,
      currentRoster.value?.positionGroups,
      counts,
      mode.value === 'custom',
    );
    if (groupState.capped) return false;
    counts.set(member.positionId, (counts.get(member.positionId) ?? 0) + 1);
  }
  return true;
}

function addStarChoice(choice: TeamBuilderStarChoice<Position>): void {
  if (!requireTeamName() || !canAddStarChoice(choice)) return;
  slots.value = addStarChoiceToSlots(slots.value, choice, (member) => ({
    positionId: member.positionId,
    name: member.name,
    chosenSkills: [],
  }));
}

function removeStarChoice(choice: TeamBuilderStarChoice<Position>): void {
  resetSkillPicker();
  slots.value = removeStarChoiceFromSlots(slots.value, choice);
}

function removeSlot(index: number): void {
  const slot = slots.value[index];
  const pairedChoice = slot
    ? allStarChoices.value.find((choice) => choice.paired && choice.members.some((member) => member.positionId === slot.positionId))
    : undefined;
  if (pairedChoice) {
    removeStarChoice(pairedChoice);
    return;
  }
  if (skillPickerIndex.value === index) resetSkillPicker();
  const next = [...slots.value];
  next[index] = null;
  slots.value = next;
}

function updateSlotName(index: number, event: Event): void {
  const slot = slots.value[index];
  if (!slot) return;
  const next = [...slots.value];
  next[index] = { ...slot, name: (event.target as HTMLInputElement).value };
  slots.value = next;
}

function stepStaff(key: StaffKey, delta: number, min: number, max: number): void {
  if (key === 'apothecary' && !currentRoster.value?.apothecaryAllowed) return;
  staff[key] = Math.max(min, Math.min(max, staff[key] + delta));
}

function stepInducement(item: Inducement, delta: number): void {
  if (!item.allowed) return;
  const current = inducementCounts.value[item.key] ?? 0;
  const max = item.max === null ? Number.MAX_SAFE_INTEGER : Math.max(0, item.max);
  inducementCounts.value = {
    ...inducementCounts.value,
    [item.key]: Math.max(0, Math.min(max, current + delta)),
  };
}

function findingEntries(value: unknown): FindingEntry[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    if (typeof entry === 'string') return entry;
    if (entry && typeof entry === 'object') return entry as Record<string, unknown>;
    return String(entry);
  });
}

function findingText(finding: FindingEntry): string {
  if (typeof finding === 'string') return finding;
  if (typeof finding.message === 'string' && finding.message) return finding.message;
  if (typeof finding.text === 'string' && finding.text) return finding.text;
  try {
    return JSON.stringify(finding) || String(finding);
  } catch {
    return String(finding);
  }
}

function summaryFrom(value: unknown): TeamBuilderSummary | null {
  if (!value || typeof value !== 'object') return null;
  const summary = value as Record<string, unknown>;
  const skillPointsUsed = Number(summary.skillPointsUsed);
  const skillPointBudget = Number(summary.skillPointBudget);
  const goldUsed = Number(summary.goldUsed);
  const goldBudget = Number(summary.goldBudget);
  const playerCount = Number(summary.playerCount);
  const primarySkillCount = Number(summary.primarySkillCount);
  const secondarySkillCount = Number(summary.secondarySkillCount);
  if (![skillPointsUsed, skillPointBudget, goldUsed, goldBudget, playerCount, primarySkillCount, secondarySkillCount].every(Number.isFinite)) return null;
  // Owner 08-10: parse the gold buckets WITHOUT gating the required-field check on them — absent ⇒ undefined
  // (the 3 lines drop out), so an older server never blanks the whole preview.
  const num = (v: unknown): number | undefined => { const n = Number(v); return Number.isFinite(n) ? n : undefined; };
  return { skillPointsUsed, skillPointBudget, goldUsed, goldBudget, playerCount, primarySkillCount, secondarySkillCount,
    staffCost: num(summary.staffCost), inducementsCost: num(summary.inducementsCost), skillsCost: num(summary.skillsCost) };
}

// Absent (undefined) on a baseline call or an old server that doesn't echo packageName yet — both
// read as "no info", and packageValidationPending tells those two apart from context (selection made).
function packageInfoFrom(value: unknown): TournamentPackageInfo | null {
  if (!value || typeof value !== 'object') return null;
  const info = value as Record<string, unknown>;
  if (typeof info.name !== 'string') return null;
  const budget = Number(info.budget);
  return {
    name: info.name,
    description: typeof info.description === 'string' ? info.description : undefined,
    budget: Number.isFinite(budget) ? budget : null,
  };
}

function schedulePreview(): void {
  if (previewTimer) clearTimeout(previewTimer);
  previewTimer = null;
  previewController?.abort();
  previewController = null;
  const requestId = ++previewRequestId;
  buildResult.value = null;
  buildErrors.value = [];

  // Tournament mode also previews now (owner GO, ruleset MVS) — NOT full isBuildMode (no validity
  // card / build-submit gained here, unchanged), but a preview is how packageName resolves to a
  // per-roster budget + note (see tournamentPackageInfo). Its OWN validation-verdict rendering is
  // untouched — this only feeds the ruleset note + budget-binding computeds.
  if (!(isBuildMode.value || mode.value === 'tournament') || !rosterId.value) {
    preview.value = null;
    previewRosterId.value = null;
    previewPending.value = false;
    previewStatus.value = 'Waiting for a roster to preview.';
    tournamentPackageInfo.value = null;
    return;
  }

  // SR-27: a different roster than the one the current preview.value describes — those numbers are for a
  // different team, so they must NOT linger. Same roster ⇒ keep displaying the last-landed values while the
  // fresh preview is in flight (see the value-card / validity-card templates for the pending-dim treatment).
  if (rosterId.value !== previewRosterId.value) {
    preview.value = null;
    tournamentPackageInfo.value = null;
  }

  previewPending.value = true;
  previewStatus.value = 'Updating live preview…';
  previewTimer = setTimeout(() => {
    previewTimer = null;
    void requestPreview(requestId);
  }, 350);
}

async function requestPreview(requestId: number): Promise<void> {
  if (mode.value === 'import') return;
  const controller = new AbortController();
  previewController = controller;
  try {
    const data = await botPost('team-builder/preview', teamBuilderBody.value, controller.signal);
    if (requestId !== previewRequestId || controller.signal.aborted) return;
    const summary = summaryFrom(data.summary);
    if (!summary) throw new Error('Preview response did not include a usable summary.');
    preview.value = {
      valid: data.valid === true,
      errors: findingEntries(data.errors),
      warnings: findingEntries(data.warnings),
      players: data.players,
      summary,
    };
    previewRosterId.value = rosterId.value;
    previewStatus.value = preview.value.valid ? 'Live preview is valid.' : 'Live preview found issues.';
    tournamentPackageInfo.value = packageInfoFrom(data.package);
  } catch (error) {
    if (requestId !== previewRequestId || controller.signal.aborted) return;
    // SR-27: leave preview.value (and previewRosterId) alone — a transient fetch failure on the SAME roster
    // should not blank the panel; the last-landed numbers stay on screen until either a fresh preview lands
    // or the roster changes (schedulePreview clears it then).
    previewStatus.value = `Live preview unavailable (${errText(error)}). Client estimate remains active.`;
  } finally {
    if (requestId === previewRequestId) {
      previewPending.value = false;
      previewController = null;
    }
  }
}

async function buildTeam(): Promise<void> {
  if (mode.value === 'import' || buildBusy.value) return;
  const editedTeamId = editingLibraryTeamId.value;
  buildBusy.value = true;
  buildResult.value = null;
  buildErrors.value = [];
  try {
    const body: TeamBuilderBody = {
      ...teamBuilderBody.value,
      coach: coach.value,
      password: password.value,
    };
    const data = await botPost('team-builder/build', body);
    if (data.ok !== true) throw new Error('Build response did not confirm success.');
    const teamId = String(data.teamId ?? '');
    buildResult.value = {
      kind: 'success',
      message: isEditingLibraryTeam.value ? `Team ${teamId || editingLibraryTeamId.value} saved.` : `Team created with ID ${teamId}.`,
      teamId,
    };
    await loadLibrary();
    if (editedTeamId) {
      const refreshedTeam = library.value.find((team) => team.teamId === editedTeamId)
        ?? (selectedLibraryTeam.value?.teamId === editedTeamId ? selectedLibraryTeam.value : null);
      if (refreshedTeam) await selectLibraryTeam(refreshedTeam);
    }
  } catch (error) {
    const data = error instanceof BotPostError ? error.data : null;
    const message = String(data?.error ?? errText(error));
    buildErrors.value = findingEntries(data?.errors);
    buildResult.value = { kind: 'error', message: `${isEditingLibraryTeam.value ? 'Team save' : 'Team creation'} failed: ${message}` };
  } finally {
    buildBusy.value = false;
  }
}

function libraryPlayerStatus(player: LibraryPlayerDetail): string {
  if (player.status) return player.status;
  return player.mng ? 'MNG' : 'Ready';
}

// Owner: sprite portraits return to the library rows (unify with the builder). Resolve the player's roster
// Position so the row rides the SAME visibleSpriteUrl chain as the Roster Slots. Fork positionId first; a
// normalized-name fallback covers ingested teams whose position ids drifted (the same failure class as the
// null-stats server finding — the portrait shouldn't die with the id).
// ── Team management mutations (owner: build the client half NOW against the FUMBBLUI contract —
// docs/team-management-page-gap-analysis.md P2; the contract IS the pin, both sides build to it).
// Paths/bodies verbatim from fumbblui-team-api-contract.md §3B/§3C; auth = our fork session
// (authorizeForkRequest), errors = server `{error}` verbatim, PLUS the floor's "Error:"-prefixed
// 200-string convention tolerated on read (contract §1). One mutation in flight (PromiseQueue floor);
// on success the detail refreshes in place (no flicker) — optimistic-then-reload, server-authoritative.
async function teamManagementPost(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  let retried = false;
  for (;;) {
    const auth = await authorizeForkRequest(path, body, forkCreds(), transport, botConfigBaseUrl());
    let response: Response;
    try {
      response = await transport(`${botConfigBaseUrl()}/api/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth.headers },
        body: JSON.stringify(auth.payload),
      });
    } catch (error) {
      throw new Error(configWebUnreachableMessage(botConfigBaseUrl(), errText(error)));
    }
    if (shouldRetryAfterUnauthorized(response.status, auth.authorized, retried)) { retried = true; continue; }
    const text = await response.text().catch(() => '');
    let data: Record<string, unknown> = {};
    try { data = JSON.parse(text) as Record<string, unknown>; } catch { /* floor: plain-string bodies */ }
    if (typeof text === 'string' && /^"?Error:?/.test(text.trim())) throw new TeamApiError(text.replace(/^"|"$/g, ''), response.status, data);
    if (!response.ok || data.error) throw new TeamApiError(String(data.error ?? `HTTP ${response.status}`), response.status, data);
    return data;
  }
}
const managementBusy = ref(false);
const managementStatus = ref('');
/** Re-fetch the selected team's detail IN PLACE (no null flash) + sync the library list entry. */
async function refreshSelectedLibraryDetail(): Promise<void> {
  const team = selectedLibraryTeam.value;
  if (!team) return;
  const data = await teamDetailGet(team.teamId);
  if (selectedLibraryTeam.value?.teamId !== team.teamId) return;
  if (!data.team || typeof data.team !== 'object') return;
  const detail = data.team as LibraryTeamDetail;
  selectedLibraryTeamDetail.value = detail;
  library.value = library.value.map((entry) => entry.teamId === detail.id
    ? { ...entry, teamName: detail.name, race: detail.race, teamValue: detail.teamValue, gold: detail.treasury, rerolls: detail.rerolls, fanFactor: detail.fanFactor, apothecary: detail.apothecary }
    : entry);
  selectedLibraryTeam.value = library.value.find((entry) => entry.teamId === detail.id) ?? team;
}
/** Run one contract mutation with the shared busy/error/refresh envelope. Returns the response (null on error). */
async function runManagement(path: string, body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const team = selectedLibraryTeam.value;
  if (!team || managementBusy.value) return null;
  managementBusy.value = true;
  managementStatus.value = '';
  try {
    const data = await teamManagementPost(path, { teamId: team.teamId, ...body });
    await refreshSelectedLibraryDetail();
    return data;
  } catch (error) {
    managementStatus.value = errText(error);
    return null;
  } finally {
    managementBusy.value = false;
  }
}
// Staff/goods (§3B). Veers's landed dispatcher (b84cc1a) serves `fire*` for AC/cheer/apo (his "no
// refunds, absent status=NEW" ruling — a contract-vocabulary variant) and both removeReroll +
// discardReroll for rerolls; the client matches his live route names.
// Owner ruling: re-rolls can only be REMOVED at redraft or by an admin. Neither is client-provable
// today (no pure organizer echo on the detail; the fork has no redraft provenance yet), so the minus
// stays disabled until the server emits `organizer`/a REDRAFTING teamStatus — both consumed here the
// moment they exist. Server-side enforcement of the same rule is asked of Veers (his dispatcher is
// currently permissive, so this gate is the live enforcement).
const canRemoveReroll = computed(() => {
  const detail = selectedLibraryTeamDetail.value;
  return detail?.organizer === true || /^redrafting$/i.test(detail?.teamStatus ?? '');
});
function adjustRerolls(delta: 1 | -1): void { void runManagement(delta > 0 ? 'team/addReroll' : 'team/removeReroll', {}); }
function adjustAssistantCoaches(delta: 1 | -1): void { void runManagement(delta > 0 ? 'team/addAssistantCoach' : 'team/fireAssistantCoach', {}); }
function adjustCheerleaders(delta: 1 | -1): void { void runManagement(delta > 0 ? 'team/addCheerleader' : 'team/fireCheerleader', {}); }
function toggleApothecary(): void { void runManagement(selectedLibraryTeamDetail.value?.apothecary ? 'team/fireApothecary' : 'team/addApothecary', {}); }
function adjustDedicatedFans(delta: 1 | -1): void {
  const current = selectedLibraryTeamDetail.value?.fanFactor ?? 0;
  void runManagement('team/changeDedicatedFans', { newDf: Math.max(0, current + delta) }); // ⚠ contract field is `newDf`
}
// Rename (§3C). The server owns uniqueness/profanity (`checkName` is its own pre-flight; rename re-checks).
const renamingTeam = ref(false);
const renameDraft = ref('');
function startRenameTeam(): void {
  renameDraft.value = selectedLibraryTeamDetail.value?.name ?? '';
  renamingTeam.value = true;
}
async function commitRenameTeam(): Promise<void> {
  const newName = renameDraft.value.trim();
  renamingTeam.value = false;
  if (!newName || newName === selectedLibraryTeamDetail.value?.name) return;
  // checkName pre-flight (live on Veers's b84cc1a): its verdict surfaces early; rename re-checks anyway.
  try {
    await teamManagementPost('team/checkName', { name: newName });
  } catch (error) {
    managementStatus.value = errText(error);
    return;
  }
  await runManagement('team/rename', { newName });
}
// Renumber (§3C): {teamId, playerNumbers:{[playerId]: number}} — writes <number> into the team XML.
async function commitPlayerNumber(player: LibraryPlayerDetail, raw: string): Promise<void> {
  const next = Number.parseInt(raw, 10);
  if (!Number.isFinite(next) || next < 1 || next > 99 || next === player.number) { await refreshSelectedLibraryDetail().catch(() => undefined); return; }
  await runManagement('team/renumber', { playerNumbers: { [player.id]: next } });
}

// ── P3: player lifecycle (contract §3C) + ready/unready. Client-ahead per the owner ruling; routes not
// yet on Veers's dispatcher surface the server's error verbatim. Deferred until §3E schema widening:
// player rename (player/update REQUIRES gender — detail doesn't emit it), hireJourneyman (no JM flag),
// firedPlayers section (not emitted).
const hireOpen = ref(false);
const hireDraft = reactive({ positionId: '', name: '', gender: 'male' });
const hirePositions = computed(() => [...(libraryRoster.value?.positions ?? [])].filter((position) => !position.isStar).sort((a, b) => b.cost - a.cost));
function openHire(): void {
  hireDraft.positionId = hirePositions.value[0]?.positionId ?? '';
  hireDraft.name = '';
  hireOpen.value = true;
}
/** name/generate/{generator}/{gender} (§3A; POST). No roster generator id in our detail — 'default'. */
async function generateHireName(): Promise<void> {
  try {
    const data = await teamManagementPost(`name/generate/default/${encodeURIComponent(hireDraft.gender)}`, {});
    const name = typeof data.name === 'string' ? data.name : typeof (data as { result?: unknown }).result === 'string' ? String((data as { result?: unknown }).result) : '';
    if (name) hireDraft.name = name;
  } catch (error) {
    managementStatus.value = errText(error);
  }
}
async function commitHire(): Promise<void> {
  const name = hireDraft.name.trim();
  if (!hireDraft.positionId || !name) return;
  const done = await runManagement('team/addPlayer', { positionId: hireDraft.positionId, gender: hireDraft.gender, name });
  if (done) hireOpen.value = false;
}
// Per-row actions menu (fire/retire/temp-retire/undo/rehire/refund — legality is the server's call;
// an illegal pick surfaces its rejection verbatim).
const playerActionsFor = ref<string | null>(null);
function togglePlayerActions(playerId: string): void {
  playerActionsFor.value = playerActionsFor.value === playerId ? null : playerId;
}
// Owner ruling (refined): Temporarily retire is offered ONLY at the time the stat reduction occurred —
// i.e. the player's RECOVERING injury (the XML's per-injury recovering="true", marking the fresh one) is
// itself a stat reduction. "mng ∧ any old reduction" is NOT sufficient. The detail API emits injuries as
// bare strings today, so the exact predicate can't fire — the entry stays HIDDEN (never over-offers)
// until the widened {name, recovering} emit lands (asked of Veers); the client already consumes both shapes.
// Owner: rows were showing raw numeric position IDs — the detail's `position` is null for teams whose
// roster the SERVER fails to match (the positionBlock class routed to Veers). The BUILDER roster resolves
// those same ids fine (the sprites prove it — libraryPlayerPosition feeds them), so the label chain is:
// server name → builder-roster name → only then the bare id.
function libraryPositionLabel(player: LibraryPlayerDetail): string {
  return displayPositionName(player.position ?? libraryPlayerPosition(player)?.name ?? player.positionId);
}
// Owner: Available reads {spp}/{N} where N = the max SPP the CURRENT advancement can cost — the
// Characteristic column of the BB2025 table (adv 0 → 14, 1 → 16, …). advancementCosts is the
// server-computed cost row for the player's NEXT advancement, so N = its max; a maxed/ineligible
// player (null costs) shows the bare number.
function sppLabel(player: LibraryPlayerDetail): string {
  const costs = player.advancementCosts;
  if (!costs) return String(player.spp);
  return `${player.spp}/${Math.max(costs.randomPrimary, costs.chosenPrimary, costs.chosenSecondary, costs.characteristic)}`;
}
// Owner: "Lineman" drops from positional names ("Dwarf Blocker Lineman" → "Dwarf Blocker") — EXCEPT
// "Human Lineman", which keeps its full name. Display-only; ids/wire untouched.
function displayPositionName(name: string): string {
  if (/^human\s+lineman$/i.test(name.trim())) return name;
  const stripped = name.replace(/\s+Lineman\s*$/i, '');
  return stripped.trim() ? stripped : name;
}
function injuryName(injury: LibraryPlayerDetail['injuries'][number]): string {
  return typeof injury === 'string' ? injury : injury.name;
}
function injuryRecovering(injury: LibraryPlayerDetail['injuries'][number]): boolean {
  return typeof injury === 'string' ? false : injury.recovering === true;
}
function canTemporarilyRetire(player: LibraryPlayerDetail): boolean {
  if (!player.mng) return false;
  // Veers's live shape (injuryDetails) preferred; the widened-injuries union stays as the fallback.
  const details = player.injuryDetails ?? player.injuries.map((injury) => (typeof injury === 'string' ? { name: injury, recovering: false } : { name: injury.name, recovering: injury.recovering === true }));
  return details.some((injury) => injury.recovering && /\(-(?:MA|ST|AG|PA|AV)\)/i.test(injury.name));
}
const PLAYER_ACTIONS: ReadonlyArray<{ path: string; label: string; show?: (player: LibraryPlayerDetail) => boolean }> = [
  { path: 'team/firePlayer', label: 'Fire' },
  { path: 'team/retirePlayer', label: 'Retire' },
  { path: 'team/temporaryRetirePlayer', label: 'Temporarily retire', show: canTemporarilyRetire },
  { path: 'team/undoTemporaryRetire', label: 'Undo temporary retire' },
  { path: 'team/rehirePlayer', label: 'Re-hire' },
  { path: 'team/refundPlayer', label: 'Refund' },
];
async function runPlayerAction(path: string, player: LibraryPlayerDetail): Promise<void> {
  playerActionsFor.value = null;
  await runManagement(path, { playerId: player.id });
}
// Ready/unready (§3C). Journeymen picks need a JM flag the detail doesn't emit yet — send none; a
// team that requires picks gets the server's message. Expensive Mistakes result surfaces when returned.
async function readyTeam(): Promise<void> {
  const data = await runManagement('team/ready', { journeymen: [] });
  const em = data?.expensiveMistakes as { roll?: number; effect?: string; treasuryLoss?: number } | undefined;
  if (em) managementStatus.value = `Expensive Mistakes! Roll ${em.roll ?? '?'} — ${em.effect ?? 'effect unknown'}${em.treasuryLoss ? `, treasury −${formatGold(em.treasuryLoss)}` : ''}.`;
}
function unreadyTeam(): void { void runManagement('team/unready', {}); }

// Owner ruling: a resurrection-style team suppresses earned SPP — the SPP cell mutes and the
// advancement affordance gates off (spending hidden SPP would be incoherent). History stays in the XML.
const isResurrectionTeam = computed(() => selectedLibraryTeamDetail.value?.resurrection === true);
const libraryRoster = computed(() => (selectedLibraryTeamDetail.value ? rosterForRace(selectedLibraryTeamDetail.value.race) : null));
// Owner: "Rostered Inducements & Stars" right-rail sub-category. Stars derive from the roster positions;
// inducements consume the detail's optional inducementSet emit (Veers widening — hidden until it lands).
const rosteredStars = computed(() => (selectedLibraryTeamDetail.value?.players ?? [])
  .filter((player) => libraryPlayerPosition(player)?.isStar === true)
  .map((player) => ({ id: player.id, name: player.name })));
const rosteredInducements = computed(() => (selectedLibraryTeamDetail.value?.inducements ?? [])
  .map((item) => ({
    label: item.type.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase()),
    count: item.value ?? 1,
  })));
function libraryPlayerPosition(player: LibraryPlayerDetail): Position | undefined {
  const roster = libraryRoster.value;
  if (!roster) return undefined;
  const byId = roster.positions.find((position) => position.positionId === player.positionId);
  if (byId) return byId;
  const normalize = (value: string) => value.toLocaleLowerCase().replace(/[^a-z0-9]/g, '');
  const name = player.position ? normalize(player.position) : '';
  return name ? roster.positions.find((position) => normalize(position.name) === name) : undefined;
}

function formatEarnedSpp(value: number | null): string {
  return value === null ? '—' : String(value);
}

function rosterForRace(race: string): Roster | null {
  const normalized = race.toLocaleLowerCase().replace(/[^a-z0-9]/g, '');
  return rosters.value.find((roster) => (
    roster.raceName.toLocaleLowerCase().replace(/[^a-z0-9]/g, '') === normalized
    || roster.rosterId.toLocaleLowerCase().replace(/[^a-z0-9]/g, '') === normalized
  )) ?? null;
}

function slotsFromLibraryTeam(detail: LibraryTeamDetail, roster: Roster): Array<Slot | null> {
  const next: Array<Slot | null> = Array.from({ length: 16 }, () => null);
  for (const player of detail.players) {
    const numberedIndex = Number.isInteger(player.number) && player.number >= 1 && player.number <= next.length
      ? player.number - 1
      : -1;
    const index = numberedIndex >= 0 && next[numberedIndex] === null ? numberedIndex : next.findIndex((slot) => slot === null);
    if (index < 0) break;
    const printed = new Set(roster.positions.find((position) => position.positionId === player.positionId)?.skills ?? []);
    next[index] = {
      positionId: player.positionId,
      name: player.name,
      chosenSkills: player.skills.filter((skill) => !printed.has(skill)),
    };
  }
  return next;
}

async function editSelectedLibraryTeam(): Promise<void> {
  const detail = selectedLibraryTeamDetail.value;
  if (!detail) return;
  const roster = rosterForRace(detail.race);
  if (!roster) {
    libraryDetailStatus.value = `Couldn't edit this team (no builder roster matched ${detail.race}).`;
    return;
  }

  const rosterLeagues = [...new Set(roster.leagueOptions?.map((entry) => entry.trim()).filter(Boolean) ?? [])];
  const storedLeagueMatches = [...new Set([...detail.leagues, ...detail.specialRules].map((entry) => entry.trim()).filter((entry) => rosterLeagues.includes(entry)))];
  if (rosterLeagues.length && storedLeagueMatches.length !== 1) {
    libraryDetailStatus.value = storedLeagueMatches.length > 1
      ? `Couldn't edit this team because more than one stored league matches ${detail.race}. No substitute was selected.`
      : `Couldn't edit this team because its exact stored league was not returned or is no longer available. No substitute was selected.`;
    return;
  }
  const storedLeague = storedLeagueMatches[0] ?? '';

  editingLibraryTeamId.value = detail.id;
  teamName.value = detail.name;
  leagueSelection.value = explicitLeagueSelection(rosterLeagues, storedLeague);
  const fallbackPackage = tournamentPackages.value[0]?.name ?? '';
  const originatingPackageAvailable = detail.rulesetPackName !== null
    && tournamentPackages.value.some((pkg) => pkg.name === detail.rulesetPackName);
  selectedPackageName.value = originatingPackageAvailable && detail.rulesetPackName
    ? detail.rulesetPackName
    : fallbackPackage;
  if (detail.rulesetPackName && !originatingPackageAvailable) {
    editRulesetHint.value = `This team's ruleset pack '${detail.rulesetPackName}' is no longer available; using ${fallbackPackage || 'the current default ruleset'}.`;
  } else {
    editRulesetHint.value = detail.rulesetPackName
      ? ''
      : `No originating ruleset pack was recorded; using the current default ruleset${fallbackPackage ? ` (${fallbackPackage})` : ''}.`;
  }
  mode.value = 'tournament';
  rosterId.value = roster.rosterId;
  budgetOverride.value = null;
  buildResult.value = null;
  await nextTick();
  leagueSelection.value = explicitLeagueSelection(rosterLeagues, storedLeague);
  staff.reRolls = detail.rerolls;
  staff.assistantCoaches = detail.assistantCoaches;
  staff.cheerleaders = detail.cheerleaders;
  staff.apothecary = detail.apothecary ? 1 : 0;
  staff.dedicatedFans = detail.fanFactor;
  slots.value = slotsFromLibraryTeam(detail, roster);
}

function selectBuilderMode(nextMode: BuilderMode): void {
  editingLibraryTeamId.value = null;
  editRulesetHint.value = '';
  mode.value = nextMode;
}

function formatGold(value: number | undefined): string {
  if (!Number.isFinite(value)) return '—';
  return `${Math.round(Number(value) / 1_000).toLocaleString()}k`;
}

function formatTeamValue(value: number | undefined): string {
  if (!Number.isFinite(value)) return '—';
  return formatGold(Number(value) * 1_000);
}


function skillClass(skill: string): string {
  return playerSkillCategoryClass(skill);
}

// --- SKILL PICKER (owner 2026-08-05): per-player skill selection off the LIVE legal-skills endpoint.
// GET /api/fork/team-builder/legal-skills?rosterId=&positionId= → { primary:[{skill,category,elite}], secondary:[…] }.
// Primary = +20k, Secondary = +40k (client estimate; the server preview/build is authoritative). Cache per
// rosterId:positionId so re-opening a picker is instant; the chosen skills ride each slot + the per-player picks. ---
const SKILL_PRIMARY_COST = 20_000;
const SKILL_SECONDARY_COST = 40_000;
// Owner: elite skills ring in +10k over the access cost (matches the validator's gold model).
const SKILL_ELITE_SURCHARGE = 10_000;
const legalSkillsCache = new Map<string, LegalSkillSet>();
const customSkillsCache = ref<LegalSkillSet | null>(null);
const skillPickerIndex = ref<number | null>(null);
const skillPickerSet = ref<LegalSkillSet | null>(null);
const skillPickerLoading = ref(false);
const skillPickerError = ref('');
const pickerCategory = ref<string | null>(null);
function resetSkillPicker(): void {
  skillPickerIndex.value = null;
  pickerCategory.value = null;
  skillPickerSet.value = null;
  skillPickerError.value = '';
}
function categoryClass(category: string): string {
  const k = (category || '').toLowerCase();
  if (k.startsWith('gen')) return 'skill-general';
  if (k.startsWith('agi')) return 'skill-agility';
  if (k.startsWith('str')) return 'skill-strength';
  if (k.startsWith('pass') || k.startsWith('dev')) return 'skill-passing';
  if (k.startsWith('mut')) return 'skill-mutation';
  return 'skill-trait';
}
// Blades (owner 08-18): category blades in PRIMARY/SECONDARY notebook-tab rows replace the old
// category-menu + Back subview; partition/order logic lives pure in skillBladeSections.ts.
const bladeSections = computed(() => buildBladeSections(skillPickerSet.value, mode.value === 'custom'));
// The pane lands on the first blade directly (no menu step); blades handle every later switch.
watch(skillPickerSet, (set) => {
  if (set && pickerCategory.value === null) pickerCategory.value = firstBladeCategory(bladeSections.value);
});
type PickerSkill = LegalSkill & { tierLabel: 'Primary' | 'Secondary' | 'All skills & traits'; priceLabel: string };
const pickerCategorySkills = computed<PickerSkill[]>(() => {
  const set = skillPickerSet.value;
  const category = pickerCategory.value;
  if (!set || !category) return [];
  const inCategory = (skills: LegalSkill[]) => groupByCategory(skills).find((group) => group.category === category)?.skills ?? [];
  if (mode.value === 'custom') {
    return inCategory(set.primary).map((skill) => ({ ...skill, tierLabel: 'All skills & traits', priceLabel: '' }));
  }
  return [
    ...inCategory(set.primary).map((skill) => ({ ...skill, tierLabel: 'Primary' as const, priceLabel: '+20k' })),
    ...inCategory(set.secondary).map((skill) => ({ ...skill, tierLabel: 'Secondary' as const, priceLabel: '+40k' })),
  ];
});
function pickerSkillIconUrl(skill: string): string | null {
  if (settings.skillDisplay !== 'icons') return null;
  const slot = skillPickerIndex.value == null ? null : slots.value[skillPickerIndex.value];
  return reactiveSkillIconUrl(skill, 'bb3', { positionId: slot?.positionId ?? null });
}
async function toggleSkillPicker(index: number): Promise<void> {
  if (skillPickerIndex.value === index) {
    resetSkillPicker();
    return;
  }
  const slot = slots.value[index];
  if (!slot || positionById(slot.positionId)?.isStar) return;
  skillPickerIndex.value = index;
  pickerCategory.value = null;
  skillPickerSet.value = null;
  skillPickerError.value = '';
  if (mode.value === 'custom') {
    if (customSkillsCache.value) { skillPickerSet.value = customSkillsCache.value; return; }
    skillPickerLoading.value = true;
    try {
      const data = await apiGet('skills');
      const deduped = new Map<string, LegalSkill>();
      for (const group of Object.values(data)) {
        if (!Array.isArray(group)) continue;
        for (const entry of group) {
          if (!entry || typeof entry !== 'object') continue;
          const raw = entry as Record<string, unknown>;
          const skill = typeof raw.name === 'string' ? raw.name.trim() : '';
          if (!skill || deduped.has(skill)) continue;
          deduped.set(skill, {
            skill,
            category: typeof raw.category === 'string' ? raw.category : '',
            elite: raw.elite === true,
          });
        }
      }
      const set: LegalSkillSet = { primary: [...deduped.values()], secondary: [] };
      customSkillsCache.value = set;
      if (skillPickerIndex.value === index) skillPickerSet.value = set;
    } catch (error) {
      if (skillPickerIndex.value === index) skillPickerError.value = `Couldn't load all skills & traits (${errText(error)}).`;
    } finally {
      skillPickerLoading.value = false;
    }
    return;
  }
  const key = `${rosterId.value}:${slot.positionId}`;
  const cached = legalSkillsCache.get(key);
  if (cached) { skillPickerSet.value = cached; return; }
  skillPickerLoading.value = true;
  try {
    const data = await botGet('team-builder/legal-skills', { rosterId: rosterId.value, positionId: slot.positionId });
    const set: LegalSkillSet = { primary: (data.primary as LegalSkill[]) ?? [], secondary: (data.secondary as LegalSkill[]) ?? [] };
    legalSkillsCache.set(key, set);
    if (skillPickerIndex.value === index) skillPickerSet.value = set;
  } catch {
    if (skillPickerIndex.value === index) skillPickerSet.value = { primary: [], secondary: [] };
  } finally {
    skillPickerLoading.value = false;
  }
}
// Owned matrix (owner 08-18): INNATE printed roster skills = dimmed + green ✓, inert · ADDED builder
// skills = dimmed + ✕ that un-adds (reuses removeSkill, the slot-row chip's removal path) · unowned = selectable.
function isInnateSkill(index: number, skill: string): boolean {
  const slot = slots.value[index];
  return slot ? (positionById(slot.positionId)?.skills ?? []).includes(skill) : false;
}
function isAddedSkill(index: number, skill: string): boolean {
  return slots.value[index]?.chosenSkills.includes(skill) ?? false;
}
function addSkill(index: number, skill: string): void {
  const slot = slots.value[index];
  if (!slot || slot.chosenSkills.includes(skill) || isInnateSkill(index, skill)) return;
  const next = [...slots.value];
  next[index] = { ...slot, chosenSkills: [...slot.chosenSkills, skill] };
  slots.value = next;
}
function removeSkill(index: number, skill: string): void {
  const slot = slots.value[index];
  if (!slot) return;
  const next = [...slots.value];
  next[index] = { ...slot, chosenSkills: slot.chosenSkills.filter((s) => s !== skill) };
  slots.value = next;
}
/** Client-side skill cost estimate for a slot — reads the cached legal-skills tiers (populated when its picker
 *  was opened, the only way to add a skill). The server preview/build recomputes authoritatively. */
function slotSkillCost(slot: Slot): number {
  const set = legalSkillsCache.get(`${rosterId.value}:${slot.positionId}`);
  return slot.chosenSkills.reduce((sum, sk) => {
    const secondary = set?.secondary.find((entry) => entry.skill === sk);
    const entry = secondary ?? set?.primary.find((candidate) => candidate.skill === sk);
    // Owner: elite skills were ringing in at the plain access cost — the +10k surcharge applies
    // (legal-skills' elite flag; same source the SP mirror uses).
    return sum + (secondary ? SKILL_SECONDARY_COST : SKILL_PRIMARY_COST) + (entry?.elite ? SKILL_ELITE_SURCHARGE : 0);
  }, 0);
}

/** Owner 09-09: builder portraits ride the pitch's own chain — pack player sprite > pack walk sheet > bundled
 *  Super FUMBBL walk sheet (idle frame) — via walkerPortraitUrl; absent rows keep the initials fallback. A builder
 *  team has no match seat yet, so the home kit previews. */
function spriteUrl(position: Position): string | null {
  const roster = currentRoster.value;
  if (!roster) return null;
  return walkerPortraitUrl({ teamId: roster.rosterId, positionId: position.positionId, positionName: position.name, race: roster.raceName, side: 'home' });
}

function visibleSpriteUrl(position: Position): string | null {
  const url = spriteUrl(position);
  return url && !failedSpriteUrls.value.has(url) ? url : null;
}

function markSpriteFailed(position: Position): void {
  const url = spriteUrl(position);
  if (url) failedSpriteUrls.value = new Set([...failedSpriteUrls.value, url]);
}

function fumbblTeamIconUrl(team: FumbblCoachTeam): string | null {
  void team;
  return null;
}

function markFumbblTeamIconFailed(team: FumbblCoachTeam): void {
  void team;
}

async function loadFumbblCoachTeams(): Promise<void> {
  const name = fumbblCoachName.value.trim();
  if (!name || fumbblCoachTeamsBusy.value) return;

  fumbblCoachTeamsBusy.value = true;
  fumbblCoachTeamsStatus.value = 'Fetching FUMBBL teams…';
  try {
    const cacheKey = name.toLowerCase();
    const result = fumbblCoachTeamsCache.value.get(cacheKey) ?? await fetchFumbblCoachTeams(name);
    fumbblCoachTeamsCache.value.set(cacheKey, result);
    if (result.kind === 'not-found') {
      fumbblCoachTeams.value = [];
      fumbblCoachTeamsStatus.value = `No FUMBBL coach named “${name}” was found.`;
      return;
    }

    fumbblCoachTeams.value = result.teams;
    fumbblCoachTeamsStatus.value = result.teams.length
      ? ''
      : `No FUMBBL teams were returned for “${result.coachName || name}”.`;
  } catch (error) {
    fumbblCoachTeams.value = [];
    fumbblCoachTeamsStatus.value = `Could not reach fumbbl.com (${errText(error)}).`;
  } finally {
    fumbblCoachTeamsBusy.value = false;
  }
}

async function importFumbblTeam(team: FumbblCoachTeam): Promise<void> {
  if (importingFumbblTeamIds.value.has(team.id)) return;
  if (!coach.value) {
    fumbblCoachTeamsStatus.value = 'Set your Super FUMBBL coach name in Settings → Connection.';
    return;
  }

  importingFumbblTeamIds.value = new Set([...importingFumbblTeamIds.value, team.id]);
  fumbblCoachTeamsStatus.value = `Importing “${team.name}” onto the fork…`;
  try {
    const data = await ingestFumbblCoachTeam(botPost, coach.value, team.id);
    const importedTeam = data.team as LibraryTeam | undefined;
    importedFumbblTeamIds.value = new Set([...importedFumbblTeamIds.value, team.id]);
    fumbblCoachTeamsStatus.value = `✓ Imported “${importedTeam?.teamName ?? team.name}”.`
      + (data.raceWarning ? ` ⚠ ${String(data.raceWarning)}` : '')
      + (data.needsRestart ? ' (playable after the next fork restart)' : '');
    await loadLibrary();
  } catch (error) {
    fumbblCoachTeamsStatus.value = `Import failed (${errText(error)}).`;
  } finally {
    importingFumbblTeamIds.value = new Set([...importingFumbblTeamIds.value].filter((id) => id !== team.id));
  }
}

// Owner 08-18: fork-library crests derive from the race via the shared teamLogos map (af397c69 idiom).
const failedForkCrests = ref(new Set<string>());
function forkCrestUrl(team: { teamId: string | number; race?: string | null }): string | null {
  if (failedForkCrests.value.has(String(team.teamId))) return null;
  return teamLogoUrl({ race: team.race ?? undefined });
}
function markForkCrestFailed(team: { teamId: string | number }): void {
  const next = new Set(failedForkCrests.value);
  next.add(String(team.teamId));
  failedForkCrests.value = next;
}

function initials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map((word) => word[0]?.toLocaleUpperCase() ?? '').join('') || '—';
}
watch([mode, teamBuilderBody], schedulePreview, { deep: true, immediate: true });
// Derived ruleset rules re-fetch: ruleset picked or race changed. Deliberately NOT keyed on
// the composed sheet — the rules block depends only on (package, race).
watch([mode, selectedPackageName, currentRoster], () => { void loadPackageRules(); }, { immediate: true });
watch(selectedPackageName, (packageName) => {
  if (mode.value === 'tournament') void loadInducements(packageName);
});
watch(mode, (m) => {
  resetSkillPicker();
  // Kallus item 593 (TB2/TB3 gate completeness): `mode` is switchable in-view, so a richer mode's customisations
  // must not ride into a plainer build — Create takes the roster as-is. Strip what the NEW mode doesn't support so
  // what's shown == what's built: stars are a custom-only affordance; per-player skills are custom/tournament-only.
  const canEdit = m === 'custom' || m === 'tournament';
  if (canEdit) {
    void loadInducements(m === 'tournament' ? selectedPackageName.value : '');
  } else {
    inducementRequestId += 1;
    inducements.value = [];
    inducementCounts.value = {};
    inducementStatus.value = '';
  }
  const cleanedSlots = slots.value.map((slot) => {
    if (!slot) return slot;
    if (m !== 'custom' && positionById(slot.positionId)?.isStar) return null;              // drop custom-only stars
    if (!canEdit && slot.chosenSkills.length) return { ...slot, chosenSkills: [] };          // drop per-player skills
    return slot;
  });
  // Custom can intentionally exceed normal roster legality. On transition back, retain the earliest legal
  // positions in stable slot order and discard only later group overflow before preview/build can observe it.
  slots.value = m === 'custom'
    ? cleanedSlots
    : normalizeSlotsForPositionGroups(cleanedSlots, currentRoster.value?.positionGroups);
});

onBeforeUnmount(() => {
  if (previewTimer) clearTimeout(previewTimer);
  previewController?.abort();
  previewRequestId += 1;
  inducementRequestId += 1;
});
</script>

<template>
  <main class="team-builder-view" aria-labelledby="team-builder-title">
    <header class="view-header">
      <div>
        <h1 id="team-builder-title"><span>T</span>eam <span>M</span>anagement</h1>
        <p>Coach: <strong>{{ coach || 'Not configured' }}</strong>.</p>
      </div>
      <div class="skill-key" aria-label="Skill category key">
        <span class="key-label"><b>S</b>kill <b>K</b>ey</span>
        <span class="skill-general">General</span>
        <span class="skill-agility">Agility</span>
        <span class="skill-strength">Strength</span>
        <span class="skill-passing">Passing</span>
        <span class="skill-mutation">Mutations</span>
        <span class="skill-trait">Traits</span>
      </div>
    </header>

    <aside class="test-environment-notice" role="note" aria-label="Test environment notice">
      <strong>Test environment</strong>
      <span> — Teams created or managed here are for the Super FUMBBL test environment and do not alter official FUMBBL teams.</span>
    </aside>

    <!-- Owner: mode cards are titles only (descriptions struck), Custom/Tournament gain "Create",
         and the library card reads "Your Fork Teams". -->
    <nav class="mode-grid" aria-label="Team management mode">
      <button :class="{ active: mode === 'create' }" type="button" @click="selectBuilderMode('create')">
        <strong>Create Team</strong>
      </button>
      <button :class="{ active: mode === 'custom' }" type="button" @click="selectBuilderMode('custom')">
        <strong>Create Custom Team</strong>
      </button>
      <button :class="{ active: mode === 'tournament' }" type="button" @click="selectBuilderMode('tournament')">
        <strong>Create Tournament Team</strong>
      </button>
      <button :class="{ active: mode === 'import' }" type="button" @click="selectBuilderMode('import')">
        <strong>Your Fork Teams</strong>
      </button>
    </nav>

    <section v-if="mode === 'import'" class="builder-panel import-panel">
      <header class="library-toolbar">
        <button v-if="selectedLibraryTeam" class="library-back-button" type="button" @click="returnToLibraryList">← Your Fork Teams</button>
        <div class="section-title"><span>F</span>ork <span>L</span>ibrary</div>
        <button class="library-ingest-button" type="button" @click="openLibraryIngest($event.currentTarget as HTMLElement)">Ingest Team</button>
      </header>
      <p v-if="libraryStatus" class="status-copy">{{ libraryStatus }}</p>
      <p v-if="retireStatus" class="status-copy">{{ retireStatus }}</p>

      <div v-else class="library-workspace">
        <aside class="library-sidebar" aria-label="Known teams">
          <button
            v-for="team in library"
            :key="team.teamId"
            class="library-sidebar-team"
            :class="{ selected: selectedLibraryTeam?.teamId === team.teamId }"
            type="button"
            :aria-pressed="selectedLibraryTeam?.teamId === team.teamId"
            @click="selectLibraryTeam(team)"
          >
            <span class="library-crest">
              <img v-if="forkCrestUrl(team)" :src="forkCrestUrl(team) ?? undefined" :alt="`${team.race} crest`" @error="markForkCrestFailed(team)" />
              <template v-else>{{ initials(team.teamName) }}</template>
            </span>
            <span><strong :title="team.teamName">{{ team.teamName }}</strong><small>{{ team.race }} · {{ formatTeamValue(team.teamValue) }}</small></span>
          </button>
        </aside>

        <main class="library-detail-pane">
          <div v-if="!selectedLibraryTeam" class="library-empty-state">
            <div class="section-title"><span>T</span>eam <span>M</span>anagement</div>
            <p>Select a team from the library to inspect its stored roster and manage advancements.</p>
          </div>
          <p v-else-if="libraryDetailStatus" class="status-copy">{{ libraryDetailStatus }}</p>
          <div v-else-if="selectedLibraryTeamDetail" class="builder-layout import-team-display">
            <div class="builder-main">
              <!-- Owner: team crest joins the detail heading (unify with the library list); the name segment
                   wraps instead of overflowing the pane. -->
              <div class="builder-heading library-detail-heading">
                <span v-if="selectedLibraryTeam" class="library-crest" aria-hidden="true">
                  <img v-if="forkCrestUrl(selectedLibraryTeam)" :src="forkCrestUrl(selectedLibraryTeam) ?? undefined" :alt="`${selectedLibraryTeamDetail.race} crest`" @error="markForkCrestFailed(selectedLibraryTeam)" />
                  <template v-else>{{ initials(selectedLibraryTeamDetail.name) }}</template>
                </span>
                <span class="library-heading-name">{{ selectedLibraryTeamDetail.name }} — {{ selectedLibraryTeamDetail.race }}</span>
                <!-- Owner: tournament-built teams carry a banner top-right of the heading, named by the
                     ruleset (e.g. "SPIKE! 2026 TOURNAMENT"; rulesetPackName = the signal). -->
                <span v-if="selectedLibraryTeamDetail.rulesetPackName" class="tournament-banner">{{ selectedLibraryTeamDetail.rulesetPackName }} Tournament</span>
              </div>
              <section class="roster-section">
                <div class="section-title"><span>P</span>layer <span>R</span>oster</div>
                <div class="roster-scroll">
                  <!-- Owner annotation pass (library row): every value sits OVER its descriptor (stacked chips);
                       the Earned cell, the rank word ("Legend"), the "Active" status noise, and the
                       "No added skills" placeholder are all gone. Null stats stay muted em dashes. -->
                  <div class="roster-header roster-grid library-roster-grid"><span>#</span><span>Player</span><span>Stats</span><span>Skills &amp; Traits</span><span>Value</span><span>SPP</span><span>Advancement</span></div>
                  <div v-for="player in selectedLibraryTeamDetail.players" :key="player.id" class="roster-stack">
                    <div class="roster-row roster-grid library-roster-grid library-roster-row">
                      <!-- P2 renumber (contract §3C): the number is an editor; commit on change/blur sends
                           team/renumber and the server-refreshed detail re-sorts. Out-of-range just re-syncs. -->
                      <input class="slot-number slot-number-input" type="number" min="1" max="99" :value="player.number"
                        :disabled="managementBusy" :aria-label="`Player number for ${player.name}`"
                        @change="commitPlayerNumber(player, ($event.target as HTMLInputElement).value)" />
                      <div class="player-cell">
                        <!-- Owner: position sprite portrait back in the row (Roster Slots idiom — same frame,
                             same resolve chain, initials fallback). -->
                        <span class="sprite-frame roster-sprite" aria-hidden="true">
                          <span class="sprite-fallback">{{ initials(player.position ?? libraryPlayerPosition(player)?.name ?? player.name) }}</span>
                          <img
                            v-if="libraryPlayerPosition(player) && visibleSpriteUrl(libraryPlayerPosition(player)!)"
                            class="sprite-image"
                            :src="visibleSpriteUrl(libraryPlayerPosition(player)!) ?? ''"
                            alt=""
                            @error="markSpriteFailed(libraryPlayerPosition(player)!)"
                          />
                        </span>
                        <span class="player-copy"><strong class="fixed-player-name">{{ player.name }}</strong><small>{{ libraryPositionLabel(player) }}<template v-if="!['Active', 'Ready'].includes(libraryPlayerStatus(player))"> · {{ libraryPlayerStatus(player) }}</template></small>
                          <!-- Gap-analysis P1: injuries were emitted by /detail but never rendered. -->
                          <small v-if="player.injuries.length" class="player-injuries">{{ player.injuries.map(injuryName).join(' · ') }}</small>
                        </span>
                      </div>
                      <div class="row-stats"><span><b :class="{ 'stat-missing': player.movement == null }">{{ player.movement ?? '—' }}</b><small>MA</small></span><span><b :class="{ 'stat-missing': player.strength == null }">{{ player.strength ?? '—' }}</b><small>ST</small></span><span><b :class="{ 'stat-missing': player.agility == null }">{{ player.agility ? `${player.agility}+` : '—' }}</b><small>AG</small></span><span><b :class="{ 'stat-missing': player.passing == null }">{{ player.passing ? `${player.passing}+` : '—' }}</b><small>PA</small></span><span><b :class="{ 'stat-missing': player.armour == null }">{{ player.armour ? `${player.armour}+` : '—' }}</b><small>AV</small></span></div>
                      <div class="row-skills">
                        <span v-for="skill in player.skills" :key="skill" :class="skillClass(skill)">{{ skill }}</span>
                      </div>
                      <div class="library-num-cell"><b>{{ formatGold(player.currentValue) }}</b><small>Current</small></div>
                      <!-- Owner ruling: resurrection-style team ⇒ earned SPP suppressed (history stays in the XML). -->
                      <!-- Owner: Available = spp/N (N = this advancement's max SPP cost); the standalone
                           advancement count is retired — Available + Add Skill carry the progression story. -->
                      <div class="library-num-cell"><b :class="{ 'stat-missing': isResurrectionTeam }" :title="isResurrectionTeam ? 'Resurrection-style team — SPP is not tracked.' : undefined">{{ isResurrectionTeam ? '—' : sppLabel(player) }}</b><small>Available</small></div>
                      <div class="library-advancement-cell">
                        <button class="add-skill-btn" type="button" :disabled="isResurrectionTeam || !canAdvancePlayer(player)" :title="isResurrectionTeam ? 'Resurrection-style team — SPP advancement is off.' : player.advancementCosts ? 'Spend SPP on a BB2025 advancement' : 'This player cannot take another advancement'" @click="openAdvancement(player, $event.currentTarget as HTMLElement)">Add Skill</button>
                        <!-- P3 (contract §3C): player lifecycle menu — legality is the server's call. -->
                        <span class="player-actions">
                          <button class="mgmt-step" type="button" :title="`Manage ${player.name}`" :disabled="managementBusy" @click="togglePlayerActions(player.id)">⋯</button>
                          <span v-if="playerActionsFor === player.id" class="player-actions-menu">
                            <button v-for="action in PLAYER_ACTIONS.filter((a) => !a.show || a.show(player))" :key="action.path" type="button" @click="runPlayerAction(action.path, player)">{{ action.label }}</button>
                          </span>
                        </span>
                      </div>
                    </div>
                  </div>
                  <p v-if="!selectedLibraryTeamDetail.players.length" class="status-copy">No players are registered for this team.</p>
                  <!-- P3 (contract §3C): hire flow — team/addPlayer {teamId, positionId, gender, name}. -->
                  <div class="hire-row">
                    <button v-if="!hireOpen" class="mgmt-hire-button" type="button" :disabled="managementBusy || !hirePositions.length" :title="hirePositions.length ? 'Hire a new player' : 'No builder roster matched this race — hiring unavailable'" @click="openHire">+ Hire Player</button>
                    <div v-else class="hire-form">
                      <select v-model="hireDraft.positionId" aria-label="Position to hire">
                        <option v-for="position in hirePositions" :key="position.positionId" :value="position.positionId">{{ displayPositionName(position.name) }} — {{ formatGold(position.cost) }}</option>
                      </select>
                      <input v-model="hireDraft.name" type="text" maxlength="60" placeholder="Player name" aria-label="New player name" @keydown.enter.prevent="commitHire" />
                      <button class="mgmt-step" type="button" title="Generate a name" :disabled="managementBusy" @click="generateHireName">🎲</button>
                      <select v-model="hireDraft.gender" aria-label="Player gender">
                        <option value="male">Male</option>
                        <option value="female">Female</option>
                        <option value="neutral">Neutral</option>
                      </select>
                      <button class="mgmt-hire-button" type="button" :disabled="managementBusy || !hireDraft.name.trim() || !hireDraft.positionId" @click="commitHire">Hire</button>
                      <button class="mgmt-step" type="button" title="Cancel hire" @click="hireOpen = false">✕</button>
                    </div>
                  </div>
                </div>
              </section>
            </div>

            <aside class="right-rail">
              <section class="value-card">
                <div class="section-title"><span>T</span>eam <span>S</span>ummary</div>
                <!-- P2 (FUMBBLUI contract §3B/§3C): the summary rail is interactive — steppers per staff line
                     (server-authoritative costs/caps; errors render verbatim below), inline team rename. -->
                <div v-if="!renamingTeam" class="value-line wrappable"><span>Team name</span><strong>{{ selectedLibraryTeamDetail.name }}<button class="mgmt-edit" type="button" title="Rename team" :disabled="managementBusy" @click="startRenameTeam">✎</button></strong></div>
                <div v-else class="value-line wrappable rename-line"><span>Team name</span>
                  <span class="rename-controls">
                    <input v-model="renameDraft" type="text" maxlength="60" aria-label="New team name" @keydown.enter.prevent="commitRenameTeam" @keydown.escape.prevent="renamingTeam = false" />
                    <button class="mgmt-step" type="button" title="Save name" :disabled="managementBusy" @click="commitRenameTeam">✓</button>
                    <button class="mgmt-step" type="button" title="Cancel rename" @click="renamingTeam = false">✕</button>
                  </span>
                </div>
                <div class="value-line"><span>Race</span><strong>{{ selectedLibraryTeamDetail.race }}</strong></div>
                <div v-if="isResurrectionTeam" class="value-line"><span>Progression</span><strong title="Earned SPP is suppressed for this team.">Resurrection</strong></div>
                <div class="value-line"><span>Re-rolls</span><strong class="mgmt-value"><button class="mgmt-step" type="button" :title="canRemoveReroll ? 'Remove a re-roll' : 'Re-rolls can only be removed at redraft or by an admin.'" :disabled="managementBusy || !selectedLibraryTeamDetail.rerolls || !canRemoveReroll" @click="adjustRerolls(-1)">−</button>{{ selectedLibraryTeamDetail.rerolls }}<button class="mgmt-step" type="button" title="Buy a re-roll" :disabled="managementBusy" @click="adjustRerolls(1)">+</button></strong></div>
                <div class="value-line"><span>Assistant coaches</span><strong class="mgmt-value"><button class="mgmt-step" type="button" title="Remove an assistant coach" :disabled="managementBusy || !selectedLibraryTeamDetail.assistantCoaches" @click="adjustAssistantCoaches(-1)">−</button>{{ selectedLibraryTeamDetail.assistantCoaches }}<button class="mgmt-step" type="button" title="Hire an assistant coach" :disabled="managementBusy" @click="adjustAssistantCoaches(1)">+</button></strong></div>
                <div class="value-line"><span>Cheerleaders</span><strong class="mgmt-value"><button class="mgmt-step" type="button" title="Remove a cheerleader" :disabled="managementBusy || !selectedLibraryTeamDetail.cheerleaders" @click="adjustCheerleaders(-1)">−</button>{{ selectedLibraryTeamDetail.cheerleaders }}<button class="mgmt-step" type="button" title="Hire a cheerleader" :disabled="managementBusy" @click="adjustCheerleaders(1)">+</button></strong></div>
                <div class="value-line"><span>Fan factor</span><strong class="mgmt-value"><button class="mgmt-step" type="button" title="Reduce dedicated fans" :disabled="managementBusy || !selectedLibraryTeamDetail.fanFactor" @click="adjustDedicatedFans(-1)">−</button>{{ selectedLibraryTeamDetail.fanFactor }}<button class="mgmt-step" type="button" title="Increase dedicated fans" :disabled="managementBusy" @click="adjustDedicatedFans(1)">+</button></strong></div>
                <div class="value-line"><span>Apothecary</span><strong class="mgmt-value">{{ selectedLibraryTeamDetail.apothecary ? 'Yes' : 'No' }}<button class="mgmt-step" type="button" :title="selectedLibraryTeamDetail.apothecary ? 'Remove the apothecary' : 'Hire an apothecary'" :disabled="managementBusy" @click="toggleApothecary">{{ selectedLibraryTeamDetail.apothecary ? '−' : '+' }}</button></strong></div>
                <div class="value-line"><span>Treasury</span><strong>{{ formatGold(selectedLibraryTeamDetail.treasury) }}</strong></div>
                <div class="value-line total"><span>Team value</span><strong>{{ formatTeamValue(selectedLibraryTeamDetail.teamValue) }}</strong></div>
                <p v-if="managementStatus" class="status-copy mgmt-status">{{ managementStatus }}</p>
              </section>
              <!-- Owner: rostered inducements & stars join the right rail as their own sub-category. Stars
                   derive from the roster positions; inducements consume the detail's optional emit (the XML's
                   inducementSet — the field is a Veers widening ask, section hides until it arrives). -->
              <section v-if="rosteredStars.length || rosteredInducements.length" class="live-card">
                <div class="section-title"><span>R</span>ostered <span>I</span>nducements &amp; <span>S</span>tars</div>
                <div v-for="star in rosteredStars" :key="`star-${star.id}`" class="value-line"><span>{{ star.name }}</span><strong>Star</strong></div>
                <div v-for="(item, index) in rosteredInducements" :key="`ind-${index}`" class="value-line"><span>{{ item.label }}</span><strong>{{ item.count }}</strong></div>
              </section>
              <section class="live-card">
                <div class="section-title"><span>T</span>eam <span>M</span>anagement</div>
                <!-- Owner: the Team ID / Coach / Ingested rows are removed — the card keeps its actions. -->
                <div v-if="!selectedLibraryTeam.forkLoadable" class="finding warning-finding">This library team is not currently fork-loadable.</div>
                <!-- P3 (contract §3C): ready/unready — journeymen picks ride once the detail emits a JM flag. -->
                <div class="ready-actions">
                  <button class="edit-team-button ready-button" type="button" :disabled="managementBusy" title="Mark this team ready to play (rolls Expensive Mistakes when due)" @click="readyTeam">Ready Team</button>
                  <button class="retire-team-button" type="button" :disabled="managementBusy" title="Take this team back out of the ready state" @click="unreadyTeam">Unready</button>
                </div>
                <button v-if="selectedLibraryTeamDetail.canEditRoster.available" class="edit-team-button" type="button" :disabled="selectedLibraryTeamEditUnavailable" :title="selectedLibraryTeamEditTitle" @click="editSelectedLibraryTeam">Edit Team</button>
                <p v-else class="status-copy">{{ selectedLibraryTeamDetail.canEditRoster.reason ?? 'Whole-roster editing is unavailable for your server role.' }}</p>
                <button class="retire-team-button detail-retire-button" type="button" :disabled="retiringTeamIds.has(selectedLibraryTeam.teamId)" @click="confirmRetireTeam(selectedLibraryTeam)">{{ retiringTeamIds.has(selectedLibraryTeam.teamId) ? 'Retiring…' : 'Retire Team' }}</button>
              </section>
            </aside>
          </div>
        </main>
      </div>

      <div v-if="libraryIngestOpen" class="library-modal-backdrop" @click.self="closeLibraryIngest">
        <section ref="libraryIngestDialog" class="library-modal" role="dialog" aria-modal="true" aria-labelledby="library-ingest-title" tabindex="-1" @keydown="onIngestDialogKeydown">
          <header><h2 id="library-ingest-title" class="section-title"><span>I</span>ngest <span>T</span>eam</h2><button type="button" aria-label="Close ingest team" @click="closeLibraryIngest">×</button></header>
          <form class="fumbbl-team-search" @submit.prevent="loadFumbblCoachTeams">
            <input v-model="fumbblCoachName" type="text" aria-label="FUMBBL coach name" placeholder="FUMBBL coach name" />
            <button type="submit" :disabled="fumbblCoachTeamsBusy || !fumbblCoachName.trim()">{{ fumbblCoachTeamsBusy ? 'Fetching…' : 'Fetch teams' }}</button>
          </form>
          <p v-if="fumbblCoachTeamsStatus" class="status-copy">{{ fumbblCoachTeamsStatus }}</p>
          <div v-if="fumbblCoachTeams.length" class="library-grid fumbbl-team-grid">
            <article v-for="team in fumbblCoachTeams" :key="team.id" class="library-team fumbbl-team-card">
              <span class="library-crest"><img v-if="fumbblTeamIconUrl(team)" :src="fumbblTeamIconUrl(team) ?? undefined" :alt="`${team.race} crest`" @error="markFumbblTeamIconFailed(team)" /><template v-else>{{ initials(team.name) }}</template></span>
              <span class="fumbbl-team-copy"><strong :title="team.name">{{ team.name }}</strong><small>{{ team.race }} · {{ formatTeamValue(team.teamValue) }} · #{{ team.id }}</small></span>
              <button class="fumbbl-import-button" type="button" :disabled="importingFumbblTeamIds.has(team.id) || importedFumbblTeamIds.has(team.id)" @click="importFumbblTeam(team)">{{ importingFumbblTeamIds.has(team.id) ? 'Importing…' : importedFumbblTeamIds.has(team.id) ? 'Imported' : 'Import' }}</button>
            </article>
          </div>
        </section>
      </div>

      <div v-if="advancementPlayer" class="library-modal-backdrop" @click.self="closeAdvancement">
        <section ref="advancementDialog" class="library-modal advancement-modal" role="dialog" aria-modal="true" aria-labelledby="advancement-title" tabindex="-1" @keydown="onAdvancementDialogKeydown">
          <header><h2 id="advancement-title" class="section-title"><span>A</span>dvance {{ advancementPlayer.name }}</h2><button type="button" aria-label="Close advancement" :disabled="advancementBusy || !!pendingAdvancementRoll" :title="pendingAdvancementRoll ? 'Finish the server-held choice before closing' : undefined" @click="closeAdvancement">×</button></header>
          <div class="advancement-summary"><span>Available SPP <b>{{ advancementPlayer.spp }}</b></span><span>Earned SPP <b :title="advancementPlayer.earnedSpp === null ? 'Exact lifetime Earned SPP is unavailable for this imported player.' : undefined">{{ formatEarnedSpp(advancementPlayer.earnedSpp) }}</b></span><span>{{ advancementPlayer.rank }} <b>{{ advancementPlayer.advancements }}/6</b></span></div>
          <div class="advancement-methods" role="tablist" aria-label="Advancement type" @keydown="onAdvancementTabsKeydown">
            <button v-for="method in ADVANCEMENT_METHODS" :id="`advancement-tab-${method}`" :key="method" type="button" role="tab" :aria-selected="advancementMethod === method" :aria-controls="`advancement-panel-${method}`" :aria-disabled="!!pendingAdvancementRoll || !advancementMethodAvailable(method)" :tabindex="advancementMethod === method ? 0 : -1" :disabled="!!pendingAdvancementRoll || !advancementMethodAvailable(method)" :title="advancementMethodReason(method)" :class="{ active: advancementMethod === method }" @click="advancementMethod = method">
              {{ method === 'randomPrimary' ? 'Random Primary' : method === 'chosenPrimary' ? 'Chosen Primary' : method === 'chosenSecondary' ? 'Chosen Secondary' : 'Characteristic' }}
              <small>{{ advancementPlayer.advancementCosts?.[method] ?? '—' }} SPP</small>
            </button>
          </div>
          <p v-if="!pendingAdvancementRoll && advancementMethodReason(advancementMethod)" class="finding warning-finding">{{ advancementMethodReason(advancementMethod) }}</p>
          <div :id="`advancement-panel-${advancementMethod}`" role="tabpanel" :aria-labelledby="`advancement-tab-${advancementMethod}`">
          <template v-if="!pendingAdvancementRoll && (advancementMethod === 'chosenPrimary' || advancementMethod === 'chosenSecondary')">
            <label class="advancement-field">Skill<select v-model="advancementSkill"><option v-for="skill in advancementMethodSkills" :key="skill" :value="skill">{{ skill }}</option></select></label>
            <button class="advancement-confirm" type="button" :disabled="advancementBusy || !advancementSkill || (advancementPlayer.advancementCosts?.[advancementMethod] ?? Infinity) > advancementPlayer.spp" @click="applyChosenAdvancement">Add Skill</button>
          </template>
          <template v-else-if="!pendingAdvancementRoll && advancementMethod === 'randomPrimary'">
            <label class="advancement-field">Primary category<select v-model="advancementCategory"><option v-for="category in advancementPlayer.primaryCategories" :key="category" :value="category">{{ category }}</option></select></label>
            <button class="advancement-confirm" type="button" :disabled="advancementBusy || !advancementCategory || (advancementPlayer.advancementCosts?.randomPrimary ?? Infinity) > advancementPlayer.spp" @click="rollAdvancement">Roll two Skills</button>
          </template>
          <template v-else-if="!pendingAdvancementRoll">
            <p class="status-copy">The server rolls the D8. You may take an offered Characteristic or decline it for a legal Primary or Secondary Skill at the Characteristic SPP cost.</p>
            <button class="advancement-confirm" type="button" :disabled="advancementBusy || (advancementPlayer.advancementCosts?.characteristic ?? Infinity) > advancementPlayer.spp" @click="rollAdvancement">Roll D8</button>
          </template>
          <template v-else-if="pendingAdvancementRoll.method === 'randomPrimary'">
            <p class="status-copy">Choose one of the two server-rolled Primary Skills.</p>
            <div class="advancement-roll-choices"><button v-for="(skill, index) in pendingAdvancementRoll.choices" :key="`${skill}-${index}`" type="button" :disabled="advancementBusy" @click="commitRolledSkill(skill)">{{ skill }}</button></div>
          </template>
          <template v-else>
            <p class="status-copy">D8 result: <b>{{ pendingAdvancementRoll.roll }}</b>. Choose an available Characteristic, or take a Skill instead.</p>
            <div class="advancement-roll-choices"><button v-for="characteristic in pendingAdvancementRoll.choices" :key="characteristic" type="button" :disabled="advancementBusy" @click="commitRolledCharacteristic(characteristic)">+1 {{ characteristic }}</button></div>
            <div class="characteristic-fallback"><label class="advancement-field">Fallback access<select v-model="characteristicFallbackAccess"><option value="primary">Primary</option><option value="secondary">Secondary</option></select></label><label class="advancement-field">Skill<select v-model="advancementSkill"><option v-for="skill in advancementMethodSkills" :key="skill" :value="skill">{{ skill }}</option></select></label><button class="advancement-confirm" type="button" :disabled="advancementBusy || !advancementSkill" @click="commitRolledSkill(advancementSkill, characteristicFallbackAccess)">Take Skill</button></div>
          </template>
          </div>
          <p v-if="advancementStatus" class="finding warning-finding" role="status" aria-live="polite">{{ advancementStatus }}</p>
        </section>
      </div>
    </section>

    <section v-else class="builder-panel">
      <div class="builder-heading">
        <span>{{ mode === 'tournament' ? 'Tournament Slot Builder' : mode === 'custom' ? 'Custom Team — Slot Builder' : 'Create Team — Slot Builder' }}</span>
        <span v-if="mode === 'custom'" class="custom-badge">Custom — validation off</span>
      </div>
      <div class="form-grid">
        <label><span>Team Name</span><input v-model="teamName" type="text" /></label>
        <label v-if="mode === 'tournament'" class="field-placeholder">
          <span>Ruleset</span>
          <select v-model="selectedPackageName" :disabled="!tournamentPackages.length">
            <option v-for="pkg in tournamentPackages" :key="pkg.name" :value="pkg.name">{{ pkg.name }}</option>
          </select>
        </label>
        <label>
          <span>Roster</span>
          <select v-model="rosterId" :disabled="!rosters.length">
            <optgroup label="Available Rosters">
              <option v-for="roster in rosters" :key="roster.rosterId" :value="roster.rosterId">{{ roster.raceName }}</option>
            </optgroup>
          </select>
        </label>
        <label v-if="hasLeagueField" class="field-placeholder">
          <span>League</span>
          <select
            v-model="leagueSelectModel"
            class="league-select"
            :disabled="leaguePresentation.disabled"
            :required="leaguePresentation.required"
          >
            <option v-if="hasLeagueMenu" disabled value="">Choose a league</option>
            <option v-for="league in leagueOptions" :key="league" :value="league">{{ league }}</option>
          </select>
          <small v-if="selectedLeagueSpecialRule" class="league-rule-display">Special rule: {{ selectedLeagueSpecialRule }}</small>
        </label>
      </div>
      <p v-if="leagueChangeNotice" class="status-copy league-change-notice" role="status">{{ leagueChangeNotice }}</p>
      <p v-if="mode === 'tournament' && tournamentPackagesStatus" class="status-copy">{{ tournamentPackagesStatus }}</p>
      <p v-if="editRulesetHint" class="status-copy edit-ruleset-hint">{{ editRulesetHint }}</p>
      <!-- Derived ruleset panels (owner 08-18): data from the package config replaces the prose
           description wall. Race panel once a roster is chosen; tier summary otherwise; the old
           prose note survives only as the fallback for a server that predates the rules block. -->
      <div v-if="mode === 'tournament' && rulesetPanelView.kind === 'race'" class="ruleset-note ruleset-derived">
        <div class="ruleset-line ruleset-head">
          <strong>{{ rulesetPanelView.race.roster }}</strong>
          <span v-if="rulesetPanelView.race.tierLabel"> — {{ rulesetPanelView.race.tierLabel }}</span>
          <span> · Budget {{ goldK(rulesetPanelView.race.gold) }}</span>
          <span v-if="!rulesetPanelView.race.packs.length"> · {{ rulesetPanelView.race.skillPointBudget }} SP</span>
          <span v-else-if="selectedPackSummary"> · {{ selectedPackSummary.skillPointBudget }} SP ({{ selectedPackSummary.label }})</span>
          <span v-if="rulesetPanelView.race.maxPerPlayer != null"> · {{ rulesetPanelView.race.maxPerPlayer }} skill{{ rulesetPanelView.race.maxPerPlayer === 1 ? '' : 's' }}/player</span>
        </div>
        <!-- Owner: the choose-one packs are a real SELECTION — big design-language buttons (mode-card
             idiom); picking one shades the others out. The chosen pack drives the displayed budget and
             rides the build body as skillPack. Click again to deselect. -->
        <div v-if="rulesetPanelView.race.packs.length" class="ruleset-line pack-choice-line">
          <div class="pack-grid" :class="{ 'has-selection': !!selectedSkillPack }">
            <button v-for="pack in rulesetPanelView.race.packs" :key="pack.label" type="button"
              class="pack-choice-btn" :class="{ selected: selectedSkillPack === pack.label }"
              :aria-pressed="selectedSkillPack === pack.label"
              @click="selectedSkillPack = selectedSkillPack === pack.label ? null : pack.label">
              <strong>{{ pack.label }}</strong>
              <small>{{ packDetail(pack) }}</small>
            </button>
          </div>
          <span v-if="!selectedSkillPack" class="ruleset-caveat pack-hint">Pick your skill pack.</span>
        </div>
        <!-- Owner: the Star SP table (+ banned/caveat lines) moved to its own section below Star Players. -->
        <div v-if="rulesetPanelView.race.stars.allowed" class="ruleset-line ruleset-stars">
          <div>Stars<template v-if="rulesetPanelView.race.stars.maxCount != null"> (max {{ rulesetPanelView.race.stars.maxCount }})</template><template v-if="rulesetPanelView.race.stars.paidInSkillPoints">, paid in SP</template></div>
        </div>
        <div v-else class="ruleset-line">No star players</div>
      </div>
      <div v-else-if="mode === 'tournament' && rulesetPanelView.kind === 'summary'" class="ruleset-note ruleset-derived">
        <div class="ruleset-line ruleset-head"><strong>{{ rulesetPanelView.name }}</strong> — {{ rulesetPanelView.tiers.length }} tiers</div>
        <div v-for="tier in rulesetPanelView.tiers" :key="tier.tier" class="ruleset-line">
          <strong>{{ tier.label }}</strong>
          <span v-if="tier.packs.length"> · Packs {{ tier.packs.map(packShort).join(' / ') }}</span>
          <span v-else> · {{ goldK(tier.gold) }} / {{ tier.skillPointBudget }} SP</span>
          <span class="ruleset-rosters"> — {{ tier.rosters.join(', ') }}</span>
        </div>
        <div v-if="rulesetPanelView.dataNote" class="ruleset-caveat">{{ rulesetPanelView.dataNote }}</div>
      </div>
      <div v-else-if="mode === 'tournament' && rulesetNoteText" class="ruleset-note">{{ rulesetNoteText }}</div>
      <div v-if="mode === 'tournament' && packageValidationPending" class="ruleset-note muted">Ruleset validation pending server update.</div>
      <p v-if="rosterStatus" class="status-copy">{{ rosterStatus }}</p>

      <div v-if="currentRoster" class="builder-layout">
        <div class="builder-main">
          <section class="add-players-panel">
            <div class="section-title"><span>A</span>dd <span>P</span>layers</div>
            <!-- Owner ruling (08-18): the R13 name-gate notice floats as a toast over this panel
                 instead of an inline status-copy line, so it never shifts the position grid below
                 it. Same 3s auto-clear (addPlayerNoticeTimer, unchanged); click dismisses early. -->
            <Transition name="name-gate-toast-fade">
              <div v-if="addPlayerNotice" class="name-gate-toast" role="status" @click="addPlayerNotice = ''">
                {{ addPlayerNotice }}
              </div>
            </Transition>
            <div class="position-grid">
              <button
                v-for="position in positions"
                :key="position.positionId"
                class="position-card"
                :class="{ exhausted: positionCount(position.positionId) >= positionMax(position) || positionGroupState(position.positionId).capped, 'name-required': teamNameMissing }"
                :disabled="positionCount(position.positionId) >= positionMax(position) || positionGroupState(position.positionId).capped || filledSlots.length >= 16"
                :title="teamNameMissing ? 'You must name your team.' : positionGroupTitle(position.positionId)"
                type="button"
                @click="addPosition(position)"
              >
                <div class="position-head">
                  <span class="sprite-frame" aria-hidden="true">
                    <span class="sprite-fallback">{{ initials(position.name) }}</span>
                    <img
                      v-if="visibleSpriteUrl(position)"
                      class="sprite-image"
                      :src="visibleSpriteUrl(position) ?? ''"
                      alt=""
                      @error="markSpriteFailed(position)"
                    />
                  </span>
                  <span class="position-name"><strong>{{ position.name }}</strong><small>{{ positionMax(position) - positionCount(position.positionId) }} of {{ positionMax(position) }} left</small></span>
                  <span class="cost">{{ formatGold(position.cost) }}</span>
                </div>
                <div class="stat-strip">
                  <span><b>{{ position.MA ?? '—' }}</b><small>MA</small></span>
                  <span><b>{{ position.ST ?? '—' }}</b><small>ST</small></span>
                  <span><b>{{ position.AG ?? '—' }}</b><small>AG</small></span>
                  <span><b>{{ position.PA ?? '—' }}</b><small>PA</small></span>
                  <span><b>{{ position.AV ?? '—' }}</b><small>AV</small></span>
                </div>
                <div class="printed-skills">
                  <span v-for="skill in position.skills ?? []" :key="skill" :class="skillClass(skill)">{{ skill }}</span>
                  <span v-if="!position.skills?.length" class="muted">No printed skills</span>
                </div>
              </button>
            </div>
          </section>

          <section class="roster-section">
            <div class="section-title"><span>R</span>oster <span>S</span>lots</div>
            <div class="roster-scroll">
              <div class="roster-header roster-grid"><span>#</span><span>Player</span><span>Stats</span><span>Skills &amp; Traits</span><span>Cost</span><span /></div>
              <div v-for="(slot, index) in visibleSlots" :key="index" class="roster-stack">
                <div class="roster-row roster-grid">
                  <span class="slot-number">{{ index + 1 }}</span>
                  <div v-if="slot" class="player-cell">
                    <span class="sprite-frame roster-sprite" aria-hidden="true">
                      <span class="sprite-fallback">{{ initials(positionById(slot.positionId)?.name ?? '') }}</span>
                      <img
                        v-if="positionById(slot.positionId) && visibleSpriteUrl(positionById(slot.positionId)!)"
                        class="sprite-image"
                        :src="visibleSpriteUrl(positionById(slot.positionId)!) ?? ''"
                        alt=""
                        @error="markSpriteFailed(positionById(slot.positionId)!)"
                      />
                    </span>
                    <span class="player-copy">
                      <strong v-if="positionById(slot.positionId)?.isStar" class="fixed-player-name">{{ slot.name }}</strong>
                      <input v-else :value="slot.name" aria-label="Player name" @input="updateSlotName(index, $event)" />
                      <small>{{ positionById(slot.positionId)?.name }}</small>
                    </span>
                  </div>
                  <span v-else class="open-slot">— open slot</span>
                  <div class="row-stats">
                    <template v-if="slot">
                      <span v-for="stat in ['MA', 'ST', 'AG', 'PA', 'AV'] as const" :key="stat"><b>{{ positionById(slot.positionId)?.[stat] ?? '—' }}</b><small>{{ stat }}</small></span>
                    </template>
                  </div>
                  <div class="row-skills">
                    <template v-if="slot">
                      <span v-for="skill in positionById(slot.positionId)?.skills ?? []" :key="skill" :class="skillClass(skill)">{{ skill }}</span>
                      <!-- TB7 (owner 08-11): added skills JOIN the printed skills inline here (was a separate row under
                           the slot) as removable chips — composes with the TB6 per-skill cells. Kallus item 594: the
                           removable chip shows ONLY in a skill-editing mode (canEditSkills) so a Custom→Create switch
                           can never surface an editable × on a plain-build roster (belt with the watch(mode) reset). -->
                      <span v-for="sk in ((canEditSkills && !positionById(slot.positionId)?.isStar) ? slot.chosenSkills : [])" :key="'c:' + sk" class="chosen-chip" :class="skillClass(sk)">{{ sk }}<button type="button" aria-label="Remove skill" @click="removeSkill(index, sk)">×</button></span>
                    </template>
                  </div>
                  <span class="cost">{{ slot ? formatGold(positionById(slot.positionId)?.cost) : '' }}</span>
                  <div v-if="slot" class="row-actions">
                    <!-- TB10 (owner 08-11): stacked two-line "Add Skill". -->
                    <button v-if="canEditSkills && !positionById(slot.positionId)?.isStar" type="button" class="skill-add-btn" :class="{ open: skillPickerIndex === index }" @click="toggleSkillPicker(index)"><span>Add</span><span>Skill</span></button>
                    <!-- TB9 (owner 08-11): small red "FIRE" under the delete ✕ (Blood Bowl flavour for releasing a player). -->
                    <span class="fire-cell">
                      <button type="button" aria-label="Remove player" @click="removeSlot(index)">×</button>
                      <small class="fire-label">FIRE</small>
                    </span>
                  </div>
                </div>
                <div v-if="slot && !positionById(slot.positionId)?.isStar && skillPickerIndex === index" class="skill-picker-panel">
                  <!-- TB8 / owner UAT 08-12 (#4): the ✕ lives in a STATIC header row so it stays anchored while the
                       skill list scrolls (was position:absolute inside the scroll body → detached on scroll). -->
                  <div class="skill-picker-head">
                    <span class="skill-picker-heading">{{ mode === 'custom' ? 'All Skills & Traits' : 'Add Skill' }}</span>
                    <button type="button" class="picker-close" aria-label="Collapse skills" @click="toggleSkillPicker(index)">×</button>
                  </div>
                  <div class="skill-picker-body">
                  <div v-if="skillPickerLoading" class="skill-picker-status">{{ mode === 'custom' ? 'Loading all skills & traits…' : 'Loading legal skills…' }}</div>
                  <div v-else-if="skillPickerError" class="skill-picker-status">{{ skillPickerError }}</div>
                  <template v-else-if="skillPickerSet">
                    <!-- Blades (owner 08-18): notebook-tab rows — PRIMARY tab + its category blades, then SECONDARY —
                         replace the category menu + Back; one click switches category from anywhere. -->
                    <div v-if="!bladeSections.length" class="skill-picker-status">{{ mode === 'custom' ? 'No skills or traits were returned.' : 'No selectable skills for this position.' }}</div>
                    <template v-else>
                      <div class="skill-blade-bar">
                        <template v-for="section in bladeSections" :key="section.label ?? 'all'">
                          <div v-if="section.label" class="skill-blade-tab">{{ section.label }}</div>
                          <div class="skill-blade-row">
                            <button v-for="cat in section.categories" :key="cat.category" type="button" class="skill-blade" :class="categoryClass(cat.category)" :data-active="pickerCategory === cat.category" @click="pickerCategory = cat.category">
                              <span>{{ cat.category }}</span><small>{{ cat.count }}</small>
                            </button>
                          </div>
                        </template>
                      </div>
                      <div v-if="pickerCategory !== null" class="skill-picker-grid">
                        <!-- Owned matrix (owner 08-18): innate printed skills dim with a green ✓ (inert); builder-added
                             skills dim with an ✕ that un-adds via removeSkill (the slot-row chip's path); rest selectable. -->
                        <span v-for="s in pickerCategorySkills" :key="s.tierLabel + ':' + s.skill" class="skill-chip-cell">
                          <button type="button" class="skill-chip" :class="[categoryClass(s.category), { innate: isInnateSkill(index, s.skill), added: isAddedSkill(index, s.skill) }]" :disabled="isInnateSkill(index, s.skill) || isAddedSkill(index, s.skill)" @click="addSkill(index, s.skill)">
                            <span class="skill-chip-main">
                              <img v-if="s.elite" class="elite-mark" :src="eliteDiamondUrl" alt="" aria-hidden="true" />
                              <span>{{ s.skill }}</span>
                              <span v-if="isInnateSkill(index, s.skill)" class="skill-owned-check" aria-hidden="true">✓</span>
                            </span>
                            <span class="skill-chip-meta">
                              <img v-if="pickerSkillIconUrl(s.skill)" class="skill-picker-icon" :src="pickerSkillIconUrl(s.skill)!" :alt="s.skill" />
                              <span v-else-if="markerGlyph(s.skill)" class="skill-picker-marker" aria-hidden="true">{{ markerGlyph(s.skill) }}</span>
                              <small v-if="s.priceLabel">{{ s.priceLabel }}</small>
                            </span>
                          </button>
                          <button v-if="isAddedSkill(index, s.skill)" type="button" class="skill-chip-remove" :aria-label="'Remove ' + s.skill" @click="removeSkill(index, s.skill)">×</button>
                        </span>
                      </div>
                    </template>
                  </template>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <!-- TB3 (owner 08-11): the Star Players section is absent from Create Team. Owner (tournament
               build-out): Tournament shows it too, fed by the Tournament Rules logic — allowed flag,
               banned list, tier SP pricing (defines the set + shows SP costs), maxCount cap. -->
          <section v-if="starSectionVisible" class="star-section">
            <div class="section-title"><span>S</span>tar <span>P</span>layers</div>
            <div v-if="displayedStarChoices.length" class="star-card">
              <div v-for="choice in displayedStarChoices" :key="choice.key" class="star-row">
                <span class="star-sprites" :class="{ paired: choice.paired }" aria-hidden="true">
                  <span v-for="star in choice.members" :key="star.positionId" class="sprite-frame">
                    <span class="sprite-fallback">{{ initials(star.name) }}</span>
                    <img
                      v-if="visibleSpriteUrl(star)"
                      class="sprite-image"
                      :src="visibleSpriteUrl(star) ?? ''"
                      alt=""
                      @error="markSpriteFailed(star)"
                    />
                  </span>
                </span>
                <span class="star-copy"><strong>{{ choice.label }}</strong><small>{{ mode === 'tournament' && tournamentStarSp(choice) !== null ? `${tournamentStarSp(choice)} SP` : formatGold(choice.cost) }} · {{ starChoiceStatus(choice) }}</small></span>
                <span class="star-actions">
                  <button type="button" :aria-label="`Remove ${choice.label}`" :disabled="!starChoiceHasAny(choice)" @click="removeStarChoice(choice)">−</button>
                  <button
                    type="button"
                    class="star-add"
                    :class="{ 'name-required': teamNameMissing }"
                    :aria-label="`Add ${choice.label}`"
                    :title="teamNameMissing ? 'You must name your team.' : mode === 'tournament' && tournamentStarCapReached ? 'This ruleset\'s star player limit is reached.' : undefined"
                    :disabled="!canAddStarChoice(choice) || (mode === 'tournament' && tournamentStarCapReached && !starChoiceHasAny(choice))"
                    @click="addStarChoice(choice)"
                  >+</button>
                </span>
              </div>
            </div>
            <p v-else-if="mode === 'tournament'" class="status-copy">No star players are available for this roster under this ruleset.</p>
            <p v-else-if="leagueSelectionRequired" class="status-copy">Choose a league to see star players.</p>
            <p v-else class="status-copy">No star players are available for this roster.</p>
          </section>

          <!-- Owner: the Star SP summary table sits BELOW the Star Players section, at the bottom of the
               page (relocated from the top ruleset note; its banned + transcription-caveat lines ride along). -->
          <section v-if="tournamentStarRules && (teamStarSpRows.length || tournamentStarRules.bannedStars.length)" class="star-sp-section">
            <button class="star-sp-toggle" type="button" :aria-expanded="starSpOpen" @click="starSpOpen = !starSpOpen">
              {{ starSpOpen ? '▾' : '▸' }} Star Player SP costs<template v-if="teamStarSpRows.length"> ({{ teamStarSpRows.length }})</template>
            </button>
            <template v-if="starSpOpen">
              <div v-if="teamStarSpRows.length" class="star-sp-table-wrap">
                <table class="star-sp-table">
                  <thead><tr><th scope="col">Star Player</th><th scope="col">SP Cost</th></tr></thead>
                  <tbody>
                    <tr v-for="star in teamStarSpRows" :key="star.name">
                      <th scope="row">{{ star.name }}</th><td>{{ star.sp }} SP</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div v-if="tournamentStarRules.bannedStars.length" class="ruleset-line">Banned: {{ tournamentStarRules.bannedStars.join(', ') }}</div>
              <div v-if="tournamentRaceDataNote" class="ruleset-caveat">{{ tournamentRaceDataNote }}</div>
            </template>
          </section>

          <section v-if="mode === 'tournament' || mode === 'custom'" class="inducement-section">
            <div class="section-title"><span>I</span>nducements</div>
            <div v-if="inducements.length" class="star-card">
              <!-- Owner: a disallowed inducement is NOT displayed in the tournament builder (custom keeps
                   the greyed row — validation-off mode shows the full catalog). -->
              <div v-for="item in (mode === 'tournament' ? inducements.filter((entry) => entry.allowed) : inducements)" :key="item.key" class="stepper-row" :class="{ unavailable: !item.allowed }">
                <span>{{ item.label }} <small>{{ formatGold(item.price) }}</small></span>
                <button type="button" :disabled="!item.allowed || (inducementCounts[item.key] ?? 0) === 0" :aria-label="`Remove ${item.label}`" @click="stepInducement(item, -1)">−</button>
                <b>{{ inducementCounts[item.key] ?? 0 }}</b>
                <button type="button" class="step-add" :disabled="!item.allowed || (item.max !== null && (inducementCounts[item.key] ?? 0) >= item.max)" :aria-label="`Add ${item.label}`" @click="stepInducement(item, 1)">+</button>
              </div>
            </div>
            <p v-if="inducementStatus" class="status-copy">{{ inducementStatus }}</p>
          </section>
        </div>

        <aside class="right-rail">
          <section class="value-card" :class="{ 'is-refreshing': previewRefreshing, 'custom-summary': mode === 'custom' }">
            <div v-if="mode !== 'custom'" class="section-title"><span>T</span>eam <span>V</span>alue<span v-if="previewRefreshing" class="refresh-dot" aria-hidden="true"></span></div>
            <span v-else-if="previewRefreshing" class="refresh-dot custom-refresh-dot" aria-hidden="true"></span>
            <!-- W32 (owner 08-14): build mode (create/custom) renders ONE fixed row-set regardless of whether
                 previewSummary has landed yet — every edit nulls preview.value briefly (schedulePreview), and this
                 used to swap in a differently-shaped "skeleton" template, mounting/unmounting rows on every
                 keystroke. Values fall back to formatGold's '—' / a '—' placeholder so text updates in place and
                 the box never grows or shrinks. Supersedes the old previewSummary-vs-skeleton branch split. -->
            <!-- Owner (annotated Create card): Create Team keeps only Players / Staff / Skills / total —
                 the skill-point rows, Inducements, and the budget chrome are Custom/Tournament-only. -->
            <template v-if="isBuildMode">
              <div class="value-line"><span>Players</span><strong>{{ previewSummary ? previewSummary.playerCount : filledSlots.length }}</strong></div>
              <div v-if="mode !== 'create'" class="value-line"><span>Skill points</span><strong>{{ previewSummary ? `${previewSummary.skillPointsUsed} / ${previewSummary.skillPointBudget}` : '—' }}</strong></div>
              <div v-if="mode !== 'create'" class="value-line"><span>Primary skills</span><strong>{{ previewSummary ? previewSummary.primarySkillCount : '—' }}</strong></div>
              <div v-if="mode !== 'create'" class="value-line"><span>Secondary skills</span><strong>{{ previewSummary ? previewSummary.secondarySkillCount : '—' }}</strong></div>
              <!-- Owner 08-10 (Veers 99822cf): the authoritative gold breakdown that composes goldUsed. Always
                   rendered now (was v-if per optional field) — formatGold(undefined) already prints '—'. -->
              <div class="value-line"><span>Staff</span><strong>{{ formatGold(previewSummary?.staffCost) }}</strong></div>
              <div v-if="mode !== 'create'" class="value-line"><span>Inducements</span><strong>{{ formatGold(previewSummary?.inducementsCost) }}</strong></div>
              <div class="value-line"><span>Skills</span><strong>{{ formatGold(previewSummary?.skillsCost) }}</strong></div>
              <div class="value-line total"><span>{{ buildTotalLabel }}</span><strong :class="previewSummary || previewPending ? (buildTotalOver ? 'over-budget' : 'within-budget') : 'value-unavailable'">{{ buildTotalValue }}</strong></div>
            </template>
            <template v-else>
              <div class="value-line"><span>Players ({{ filledSlots.length }})</span><strong>{{ formatGold(rawPlayerCost) }}</strong></div>
              <div v-if="mode === 'tournament'" class="value-line"><span>Star players</span><strong>0k</strong></div>
              <div v-if="mode === 'tournament'" class="value-line"><span>Inducements</span><strong>{{ formatGold(inducementGoldTotal) }}</strong></div>
              <div class="value-line"><span>Sideline staff</span><strong>{{ formatGold(staffCost) }}</strong></div>
              <div class="value-line subtotal"><span>Subtotal</span><strong>{{ formatGold(preSkillsEstimate) }}</strong></div>
              <div class="value-line"><span>Skills</span><strong>{{ formatGold(addedSkillGold) }}</strong></div>
              <!-- Owner: the SP counter lives at the BOTTOM of the TV summary — used / remaining against the
                   CHOSEN skill pack's budget (falls back to the race SP budget until a pack is picked).
                   Model: 1 primary / 2 secondary / +0.5 elite (+ star SP when the package pays stars in SP);
                   the validator enforces the same math. -->
              <div v-if="spRemaining != null" class="value-line"><span>Skill points</span><strong :class="{ 'over-budget': spRemaining < 0 }">{{ spUsed }} / {{ spRemaining }}</strong></div>
              <!-- Owner ruling 08-18 (annotated screenshot, Tournament Team Value panel): the
                   "Client-side estimate" total row is struck — dropped in Tournament mode only
                   (this v-else branch is tournament-exclusive; create/custom render the isBuildMode
                   branch above). -->
            </template>
            <!-- Owner ruling 08-18: the budget-source label + Edit toggle row is also struck, but
                 ONLY for Tournament — it's shared markup with Create/Custom (rosterGoldBudget),
                 which weren't annotated, so the row survives there. -->
            <!-- Owner (annotated Create card): the budget row + editor leave Create entirely — the fixed
                 TV-1M default stands; Custom keeps the row/editor, Tournament keeps its locked input. -->
            <div v-if="mode === 'custom'" class="budget-source">
              <span>{{ budgetOverride === null ? (rosterGoldBudget === null ? 'BB2025 budget fallback' : 'Roster budget') : 'Local build budget override' }}</span>
              <button type="button" @click="budgetEditorOpen = !budgetEditorOpen">Edit</button>
            </div>
            <!-- Tournament mode has no Edit toggle now (its row was struck), so the manual budget
                 input — "wasn't struck… the manual budget entry until ruleset-pack ingestion lands" —
                 stays permanently visible there instead of waiting on budgetEditorOpen. Ruleset-pack
                 ingestion HAS now landed (⚖ BUDGET BINDING, tournament ruleset MVS): once a package
                 resolves a budget, the input locks to the pack's value instead of accepting edits. -->
            <label v-if="(mode === 'custom' && budgetEditorOpen) || mode === 'tournament'" class="budget-editor">
              <input
                v-model.number="tournamentBudgetInputValue"
                type="number"
                min="0"
                :disabled="mode === 'tournament' && tournamentBudgetLocked"
              />
              <span>k build budget</span>
            </label>
          </section>
          <!-- TB18 (owner 08-11): ONE plain-language validity panel replaces the "Authoritative TV Preview" + "Validator Findings" internals-speak. Two headline states — valid ✓ / Team is Invalid + the fixes; plus transient checking and the custom validation-off mode. -->
          <!-- Owner ruling 08-18 (annotated screenshot): the "Couldn't check the team just now — edit the
               roster to retry." box is struck outright — deleted, not replaced with new chrome. That state
               (validityUnavailable: no name yet, or a named team whose preview genuinely failed) now renders
               no validity card at all; the Team Value row's own copy (teamNameMissing) and status-copy notices
               elsewhere already cover it honestly. -->
          <section v-if="canValidateTeam && !validityUnavailable" class="live-card validity-card" :class="[validityClass, { 'is-refreshing': previewRefreshing }]">
            <template v-if="mode === 'custom'">
              <div class="validity-headline custom">Custom team — validation off</div>
              <div v-for="(finding, index) in validityFixes" :key="`custom-fix-${index}-${findingText(finding)}`" class="fix-line">{{ findingText(finding) }}</div>
            </template>
            <template v-else-if="validityChecking">
              <div class="validity-headline checking">Checking team…</div>
            </template>
            <template v-else-if="teamValid">
              <div class="validity-headline valid">Team is valid <span class="tick">✓</span></div>
            </template>
            <template v-else>
              <div class="validity-headline invalid">Team is Invalid<span v-if="validityFixes.length">: {{ validityFixes.length }} {{ validityFixes.length === 1 ? 'issue' : 'issues' }} to fix</span></div>
              <div v-for="(finding, index) in validityFixes" :key="`fix-${index}-${findingText(finding)}`" class="fix-line">{{ findingText(finding) }}</div>
              <p v-if="!validityFixes.length" class="fix-line muted">Adjust the roster and try again.</p>
            </template>
          </section>
          <form v-if="canSubmitTeam" class="live-card submit-card" @submit.prevent="buildTeam">
            <div v-if="needsInlineCreds" class="inline-creds">
              <label><span>Coach</span><input v-model="inlineCoach" autocomplete="username" type="text" /></label>
              <label><span>Password</span><input v-model="inlinePassword" autocomplete="current-password" type="password" /></label>
            </div>
            <button class="create-button" type="submit" :disabled="buildBusy">{{ buildBusy ? (isEditingLibraryTeam ? 'Saving…' : 'Creating…') : (isEditingLibraryTeam ? 'Save Team' : 'Create Team') }}</button>
          </form>
          <section v-if="canSubmitTeam && buildResult" class="result-banner" :class="buildResult.kind" role="status">
            <strong>{{ buildResult.kind === 'success' ? 'Team Created ✅' : 'Build failed' }}</strong>
            <!-- Owner 08-12 (⑤): suppress the "Team created with ID tb_…" line on success; keep the failure detail. -->
            <span v-if="buildResult.kind !== 'success'">{{ buildResult.message }}</span>
          </section>

          <section class="rail-section staff-section">
            <div class="section-title"><span>S</span>ideline <span>S</span>taff</div>
            <div v-for="row in staffRows" :key="row.key" class="stepper-row" :class="{ unavailable: row.key === 'apothecary' && !currentRoster.apothecaryAllowed }">
              <span>{{ row.label }} <small>0–{{ row.key === 'reRolls' ? (currentRoster.maxReRolls ?? row.max) : row.max }}</small></span>
              <button
                type="button"
                :disabled="row.key === 'apothecary' && !currentRoster.apothecaryAllowed"
                @click="stepStaff(row.key, -1, row.min, row.key === 'reRolls' ? (currentRoster.maxReRolls ?? row.max) : row.max)"
              >−</button>
              <b>{{ staff[row.key] }}</b>
              <button
                type="button"
                class="step-add"
                :disabled="row.key === 'apothecary' && !currentRoster.apothecaryAllowed"
                @click="stepStaff(row.key, 1, row.min, row.key === 'reRolls' ? (currentRoster.maxReRolls ?? row.max) : row.max)"
              >+</button>
              <small>× {{ formatGold(row.key === 'reRolls' ? reRollCost : row.cost) }} = {{ formatGold(staff[row.key] * (row.key === 'reRolls' ? reRollCost : row.cost)) }}</small>
            </div>
          </section>

        </aside>
      </div>
    </section>
  </main>
</template>

<style scoped>
.team-builder-view {
  box-sizing: border-box;
  width: 100%;
  /* Owner 08-17 (viewport reflow): was a hard 1440px cap that read as fixed-width on wide monitors —
     let the panel keep growing with the window up to a generous ceiling instead of stalling early. */
  max-width: 1800px;
  min-height: 100%;
  margin: 0 auto;
  padding: 18px 20px;
  color: var(--ui-text);
  background: var(--ui-surface);
  font-family: 'Nuffle', system-ui, sans-serif;
}

button,
input,
select { font: inherit; }

.view-header { display: flex; align-items: flex-start; gap: 14px; flex-wrap: wrap; margin-bottom: 16px; }
.view-header > div:first-child { display: flex; flex-direction: column; gap: 4px; }
/* Owner ruling (08-18, viewport reflow): same clamp() curve as the Spectate pass — comfortably
   larger at 1440p+, unchanged floor at ~1280. Applied across tab cards, headings, position/roster
   rows, the Team Value panel, and Sideline Staff steppers below. */
h1 { margin: 0; color: var(--ui-text); font-size: max(var(--ui-min-primary-text-size, 16px), clamp(26px, 1.85vw, 32px)); font-weight: 500; letter-spacing: .06em; text-shadow: 2px 2px 0 rgba(0, 0, 0, .8); }
h1 span,
.section-title span { font-size: max(var(--ui-min-text-size, 12px), 1.2em); }
.view-header p { margin: 0; color: var(--ui-muted); font-size: max(var(--ui-min-primary-text-size, 16px), clamp(13px, 0.95vw, 16px)); letter-spacing: .04em; }
.view-header p strong { color: var(--ui-eggshell); font-weight: 500; }

.test-environment-notice {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin: -2px 0 14px;
  padding: 9px 12px;
  color: var(--ui-eggshell);
  background:
    linear-gradient(90deg, color-mix(in srgb, var(--ui-active) 20%, transparent), transparent 58%),
    var(--ui-surface-2);
  border: 1px solid color-mix(in srgb, var(--ui-gold) 52%, var(--ui-border));
  border-left: 4px solid var(--ui-gold);
  border-radius: 4px;
  box-shadow: 0 3px 9px rgba(0, 0, 0, .35);
  font-size: max(var(--ui-min-text-size, 12px), clamp(12px, .85vw, 15px));
  line-height: 1.4;
  letter-spacing: .035em;
  overflow-wrap: anywhere;
}
.test-environment-notice strong {
  flex: 0 0 auto;
  color: var(--ui-gold);
  font-weight: 500;
  letter-spacing: .12em;
  text-transform: uppercase;
}
.test-environment-notice span { min-width: 0; }

.skill-key { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; margin-left: auto; padding-top: 8px; font-size: max(var(--ui-min-text-size, 12px), clamp(10px, 0.75vw, 13px)); letter-spacing: .06em; }
.key-label { color: var(--ui-muted); }
.key-label b { font-size: max(var(--ui-min-text-size, 12px), 1.2em); font-weight: 500; }
.skill-general { color: var(--ui-skill-general); }
.skill-agility { color: var(--ui-skill-agility); }
.skill-strength { color: var(--ui-skill-strength); }
.skill-passing { color: var(--ui-skill-passing); }
.skill-mutation { color: var(--ui-skill-mutation); }
.skill-trait { color: var(--ui-skill-trait); }

/* Owner 08-17 (viewport reflow): was a fixed repeat(4, 1fr) — auto-fit lets the mode buttons drop to 2-per-row
   at mid widths instead of staying pinned at 4 all the way down to the 680px breakpoint. */
.mode-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px; margin-bottom: 14px; }
.mode-grid button,
.position-card { color: var(--ui-text); text-align: left; background: var(--ui-surface-2); border: 1px solid var(--ui-border); border-radius: 6px; cursor: pointer; }
.mode-grid button { min-height: clamp(78px, 5.5vw, 100px); padding: clamp(13px, 0.95vw, 18px) clamp(16px, 1.15vw, 22px); }
.mode-grid button:hover,
.position-card:hover:not(:disabled) { border-color: var(--ui-primary); background: color-mix(in srgb, var(--ui-primary) 18%, var(--ui-surface-2)); }
.mode-grid button.active { border-color: var(--ui-heading); box-shadow: inset 0 3px 0 var(--ui-active); }
.mode-grid strong { display: block; color: var(--ui-text); font-size: max(var(--ui-min-primary-text-size, 16px), clamp(17px, 1.25vw, 22px)); font-weight: 500; }

.builder-panel { display: flex; flex-direction: column; gap: 14px; padding: clamp(18px, 1.3vw, 26px) clamp(20px, 1.5vw, 28px); border: 1px solid var(--ui-border); border-radius: 6px; background: var(--ui-surface-2); box-shadow: 0 4px 14px rgba(0, 0, 0, .55); }
.builder-heading { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; color: var(--ui-eggshell); font-size: max(var(--ui-min-primary-text-size, 16px), clamp(17px, 1.25vw, 22px)); letter-spacing: .08em; }
/* Owner: library detail heading carries the team crest; the name wraps instead of overflowing the pane. */
.library-detail-heading { flex-wrap: nowrap; }
.library-detail-heading .library-crest { flex: 0 0 auto; }
.library-detail-heading .library-heading-name { min-width: 0; overflow-wrap: anywhere; }
/* Owner: ruleset-named tournament banner, pinned to the heading's right (the annotated square). */
.library-detail-heading .tournament-banner {
  flex: 0 0 auto;
  margin-left: auto;
  padding: 5px 12px;
  color: var(--ui-heading);
  background: color-mix(in srgb, var(--ui-primary) 30%, var(--ui-surface));
  border: 1px solid var(--ui-heading);
  border-radius: 5px;
  font-size: max(var(--ui-min-text-size, 12px), clamp(12px, 0.9vw, 15px));
  letter-spacing: .08em;
  text-transform: uppercase;
  white-space: nowrap;
}
.custom-badge { padding: 3px 7px; color: var(--ui-gold); background: color-mix(in srgb, var(--ui-gold) 10%, var(--ui-surface)); border: 1px solid var(--ui-gold); border-radius: 10px; font-size: max(var(--ui-min-text-size, 12px), clamp(10px, 0.75vw, 13px)); letter-spacing: .06em; }
.form-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
.form-grid label { display: flex; flex-direction: column; gap: 5px; }
.form-grid label > span { color: var(--ui-muted); font-size: max(var(--ui-min-text-size, 12px), clamp(12px, 0.9vw, 15px)); letter-spacing: .1em; }
input,
select { box-sizing: border-box; width: 100%; padding: clamp(9px, 0.65vw, 13px) clamp(10px, 0.75vw, 14px); color: var(--ui-text); background: var(--ui-surface); border: 1px solid color-mix(in srgb, var(--ui-text) 30%, var(--ui-border)); border-radius: 4px; font-size: max(var(--ui-min-primary-text-size, 16px), clamp(13px, 0.95vw, 16px)); }
input:focus,
select:focus,
button:focus-visible { outline: 2px solid var(--ui-focus); outline-offset: 2px; }
.field-placeholder { min-height: 62px; }
.league-select:disabled { color: var(--ui-muted); background: var(--ui-surface-2); cursor: not-allowed; }
.league-rule-display { color: var(--ui-gold); font-size: max(var(--ui-min-text-size, 12px), 11px); }
.league-change-notice { color: var(--ui-gold); }
.ruleset-note { min-height: 38px; color: var(--ui-gold); }
.ruleset-note.muted { color: var(--ui-muted); font-size: max(var(--ui-min-text-size, 12px), 12px); }
.ruleset-derived { display: grid; gap: 3px; font-size: max(var(--ui-min-text-size, 12px), 12px); }
.ruleset-head { display: flex; align-items: baseline; flex-wrap: wrap; gap: 0 4px; font-size: max(var(--ui-min-primary-text-size, 16px), 13px); }
/* (the SP counter moved into the tournament TV summary — value-line idiom, over-budget token reused) */
.ruleset-line strong { color: var(--ui-gold); }
.ruleset-line { color: var(--ui-text); }
.ruleset-chip { display: inline-block; margin: 0 4px 2px 0; padding: 0 6px; border: 1px solid var(--ui-border); border-radius: 8px; color: var(--ui-text); background: var(--ui-surface); white-space: nowrap; }
/* Owner: choose-one skill packs are clickable; the selected pack reads as engaged. */
/* Owner: pack choices are LARGE mode-card-idiom buttons; a selection shades the others out. */
.pack-choice-line { display: flex; flex-direction: column; gap: 5px; }
.pack-grid { display: flex; flex-wrap: wrap; gap: 10px; }
.pack-choice-btn {
  display: flex;
  flex: 0 1 auto;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  min-width: 180px;
  padding: 10px 16px;
  color: var(--ui-text);
  background: var(--ui-surface);
  border: 2px outset color-mix(in srgb, var(--ui-primary) 45%, var(--ui-border));
  border-radius: 6px;
  font: inherit;
  cursor: pointer;
  transition: opacity 120ms ease, filter 120ms ease;
}
.pack-choice-btn:hover { border-color: var(--ui-heading); }
.pack-choice-btn strong { color: var(--ui-eggshell); font-size: max(var(--ui-min-text-size, 12px), clamp(14px, 1.05vw, 18px)); font-weight: 500; }
.pack-choice-btn small { color: var(--ui-muted); font-size: max(var(--ui-min-text-size, 12px), clamp(11px, 0.8vw, 14px)); white-space: nowrap; }
.pack-choice-btn.selected { background: color-mix(in srgb, var(--ui-primary) 42%, var(--ui-surface)); border-style: inset; border-color: var(--ui-heading); box-shadow: inset 0 3px 0 var(--ui-active); }
.pack-choice-btn.selected small { color: var(--ui-text); }
/* One picked ⇒ the rest shade out (still clickable to switch). */
.pack-grid.has-selection .pack-choice-btn:not(.selected) { opacity: 0.38; filter: saturate(0.55); }
.pack-grid.has-selection .pack-choice-btn:not(.selected):hover { opacity: 0.75; }
.pack-hint { display: inline-block; margin-left: 4px; }
.ruleset-stars { display: grid; gap: 5px; }
.star-sp-table-wrap { max-height: min(42vh, 420px); overflow: auto; border: 1px solid var(--ui-border); border-radius: 4px; background: var(--ui-surface); }
/* Owner: the relocated SP-table section (below Star Players) — quiet block, same note styling. */
.star-sp-section { display: flex; flex-direction: column; gap: 6px; margin-top: 14px; }
.star-sp-toggle { align-self: flex-start; padding: 3px 9px; color: var(--ui-muted); background: var(--ui-surface); border: 1px solid var(--ui-border); border-radius: 4px; font-size: max(var(--ui-min-text-size, 12px), 12px); letter-spacing: .04em; cursor: pointer; }
.star-sp-toggle:hover { color: var(--ui-heading); border-color: var(--ui-heading); }
.star-sp-section .ruleset-line,
.star-sp-section .ruleset-caveat { color: var(--ui-muted); font-size: max(var(--ui-min-text-size, 12px), clamp(11px, 0.8vw, 14px)); }
.star-sp-table { width: 100%; border-collapse: collapse; color: var(--ui-text); font-size: max(var(--ui-min-text-size, 12px), 12px); }
.star-sp-table caption { padding: 7px 9px; color: var(--ui-gold); text-align: left; font-weight: 700; }
.star-sp-table th,
.star-sp-table td { padding: 5px 9px; border-top: 1px solid var(--ui-border); text-align: left; }
.star-sp-table thead th { position: sticky; top: 0; z-index: 1; color: var(--ui-heading); background: var(--ui-surface-2); }
.star-sp-table tbody th { width: 100%; color: var(--ui-text); font-weight: 500; }
.star-sp-table td { color: var(--ui-gold); white-space: nowrap; }
.ruleset-rosters { color: var(--ui-muted); }
.ruleset-caveat { color: var(--ui-muted); font-size: max(var(--ui-min-text-size, 12px), 10.5px); }
.status-copy { margin: 0; color: var(--ui-muted); font-size: max(var(--ui-min-text-size, 12px), 12px); }

/* Owner 08-17 (viewport reflow): sidebar column now a fluid minmax band (was a hard 300px) so it eases with
   the window instead of holding one pixel width; still wraps below main content at <=980px (media query below). */
.builder-layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(260px, 320px); gap: 18px; align-items: start; }
.builder-main { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.section-title { margin-bottom: 6px; color: var(--ui-heading); font-size: max(var(--ui-min-text-size, 12px), clamp(12px, 0.9vw, 15px)); font-weight: 500; letter-spacing: .14em; }
.position-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(215px, 1fr)); gap: 8px; }
.position-card { display: flex; flex-direction: column; gap: 7px; min-height: clamp(118px, 8.4vw, 150px); padding: clamp(9px, 0.65vw, 13px) clamp(10px, 0.75vw, 14px); }
.position-card.exhausted { opacity: .55; cursor: default; }
.position-card.name-required,
.star-add.name-required { opacity: .55; cursor: not-allowed; }

/* Owner ruling (08-18): R13 name-gate toast — floats over the panel (no layout shift), same
   3s auto-clear as before plus click-to-dismiss. Existing --ui-danger/--ui-surface-2 tokens,
   no new hex. */
.add-players-panel { position: relative; }
.name-gate-toast {
  position: absolute;
  top: 0;
  left: 50%;
  z-index: 5;
  transform: translate(-50%, -100%);
  margin-top: -8px;
  padding: 8px 16px;
  border: 1px solid var(--ui-danger);
  border-radius: 8px;
  background: color-mix(in srgb, var(--ui-surface-2) 94%, transparent);
  color: var(--ui-danger);
  font-size: max(var(--ui-min-text-size, 12px), 12px);
  font-weight: 600;
  letter-spacing: .02em;
  white-space: nowrap;
  box-shadow: 0 6px 18px rgba(0, 0, 0, .5);
  cursor: pointer;
}
.name-gate-toast-fade-enter-active,
.name-gate-toast-fade-leave-active { transition: opacity .15s ease; }
.name-gate-toast-fade-enter-from,
.name-gate-toast-fade-leave-to { opacity: 0; }

.position-head { display: flex; align-items: center; gap: 9px; }
/* Owner 09-09: a larger frame, and the portrait (cropped to the figure by walkerPortrait.ts) fills it. */
.sprite-frame { position: relative; box-sizing: border-box; width: clamp(54px, 3.8vw, 68px); height: clamp(54px, 3.8vw, 68px); flex: 0 0 auto; overflow: hidden; border: 1px solid var(--ui-border); border-radius: 4px; background-color: var(--ui-surface); }
.sprite-fallback { position: absolute; inset: 0; display: grid; place-items: center; color: var(--ui-muted); font-size: max(var(--ui-min-text-size, 12px), clamp(12px, 0.9vw, 15px)); }
.sprite-image { position: absolute; inset: 2px; width: calc(100% - 4px); height: calc(100% - 4px); object-fit: contain; object-position: center; image-rendering: pixelated; }
.position-name { display: flex; flex: 1; min-width: 0; flex-direction: column; }
.position-name strong { color: var(--ui-text); font-size: max(var(--ui-min-primary-text-size, 16px), clamp(13px, 1vw, 17px)); font-weight: 500; line-height: 1.25; }
.position-name small { color: var(--ui-muted); font-size: max(var(--ui-min-text-size, 12px), clamp(10px, 0.75vw, 13px)); }
.cost { color: var(--ui-eggshell); font-size: max(var(--ui-min-primary-text-size, 16px), clamp(13px, 1vw, 17px)); }
/* Owner 08-17: the stat numeral (6 MA / 4 ST / 3+ AG / 4+ PA / 9+ AV) is the payload of these chips — bumped
   from 11px to 14px (~27%) so it reads at a glance; the MA/ST/AG/PA/AV suffix stays 8px (already proportionately
   smaller). Chip gap/padding widened to match so the bigger numeral doesn't crowd the border. .stat-strip (Add
   Players cards) and .row-stats (Roster Slots rows) share this rule, so both surfaces changed together. */
.stat-strip,
.row-stats { display: flex; gap: 4px; }
.stat-strip > span,
/* Owner: builder-page stat chips match the library — value stacked OVER the descriptor, everywhere. */
.row-stats > span { display: flex; flex: 1; flex-direction: column; align-items: center; justify-content: center; gap: 1px; min-width: 0; padding: clamp(3px, 0.3vw, 5px) clamp(3px, 0.25vw, 5px); border: 1px solid var(--ui-border); border-radius: 3px; background: var(--ui-surface); }
.stat-strip b,
.row-stats b { color: var(--ui-text); font-size: max(var(--ui-min-primary-text-size, 16px), clamp(14px, 1.05vw, 18px)); font-weight: 500; }
.stat-strip small,
.row-stats small { color: var(--ui-skill-strength); font-size: max(var(--ui-min-text-size, 12px), clamp(8px, 0.6vw, 11px)); letter-spacing: .04em; }
.printed-skills,
.row-skills { display: flex; flex-wrap: wrap; gap: 4px; font-size: max(var(--ui-min-text-size, 12px), clamp(10px, 0.75vw, 13px)); line-height: 1.35; }
/* TB6 (owner 08-11): each printed skill is a DISCRETE cell so multi-word names ("Right Stuff Thick Skull") don't
   blur into their neighbours — a very-light tint + hairline is enough to keep the eye moving. The skillClass
   colour-coding stays on the text; a multi-word name wraps inside its own cell. Console tokens only. Picker/chosen
   are already chips; this covers the plain-span lists (position cards + roster rows). */
.printed-skills > span:not(.muted),
.row-skills > span:not(.chosen-chip) {
  box-sizing: border-box;
  padding: 1px 6px;
  border: 1px solid var(--ui-border);
  border-radius: 5px;
  background: var(--ui-surface-2);
}
.muted { color: var(--ui-muted); }

.roster-section { min-width: 0; }
.roster-scroll { overflow-x: auto; }
.roster-grid {
  display: grid;
  grid-template-columns:
    clamp(36px, 2.6vw, 48px)
    minmax(180px, 1.4fr)
    minmax(150px, 218px)
    minmax(0, 1fr)
    clamp(70px, 5vw, 92px)
    clamp(60px, 4.3vw, 80px);
  gap: 8px;
  min-width: 660px;
  box-sizing: border-box;
}
.roster-header { padding: clamp(8px, 0.6vw, 12px) clamp(10px, 0.75vw, 14px); color: var(--ui-skill-strength); background: color-mix(in srgb, var(--ui-primary) 34%, var(--ui-surface)); border-bottom: 2px solid var(--ui-primary); border-radius: 4px 4px 0 0; font-size: max(var(--ui-min-text-size, 12px), clamp(12px, 0.9vw, 15px)); letter-spacing: .1em; }
.roster-stack:nth-child(odd) .roster-row { background: var(--ui-surface); }
.roster-stack:nth-child(even) .roster-row { background: var(--ui-surface-2); }
.roster-row { align-items: center; min-height: clamp(60px, 4.3vw, 78px); padding: clamp(14px, 1vw, 20px) clamp(10px, 0.75vw, 14px); border-bottom: 1px solid var(--ui-border); }
.slot-number { color: var(--ui-muted); font-size: max(var(--ui-min-primary-text-size, 16px), clamp(13px, 0.95vw, 16px)); }
.player-cell { display: flex; align-items: center; gap: 8px; min-width: 0; }
.roster-sprite { width: clamp(30px, 2.1vw, 38px); height: clamp(30px, 2.1vw, 38px); }
.player-copy { display: flex; flex: 1; min-width: 0; flex-direction: column; gap: 1px; }
.fixed-player-name { color: var(--ui-text); font-size: max(var(--ui-min-primary-text-size, 16px), clamp(13px, 1vw, 17px)); font-weight: 500; }
.player-copy input { min-width: 0; padding: 1px 2px; color: var(--ui-text); background: transparent; border: 0; border-bottom: 1px dashed color-mix(in srgb, var(--ui-text) 28%, var(--ui-border)); border-radius: 0; font-size: max(var(--ui-min-primary-text-size, 16px), clamp(13px, 1vw, 17px)); }
.player-copy small { color: var(--ui-muted); font-size: max(var(--ui-min-text-size, 12px), clamp(10px, 0.75vw, 13px)); }
.open-slot { color: var(--ui-muted); font-size: max(var(--ui-min-text-size, 12px), clamp(12px, 0.9vw, 15px)); }
.row-actions { display: flex; align-items: center; justify-content: flex-end; gap: 4px; }
/* TB10: stacked two-line "Add Skill". */
.skill-add-btn { display: inline-flex; flex-direction: column; align-items: center; line-height: 1.05; padding: 2px 8px; font-size: max(var(--ui-min-text-size, 12px), clamp(10px, 0.75vw, 13px)); border-radius: 5px; border: 1px solid var(--ui-border); background: var(--ui-surface-2); color: var(--ui-text); cursor: pointer; }
.skill-add-btn:hover { border-color: var(--ui-primary); }
.skill-add-btn.open { background: var(--ui-primary); color: var(--ui-text-on-primary); border-color: var(--ui-primary); }
/* TB7: chosen skills now render inline in the Skills & Traits column (the standalone .chosen-skills row was removed). */
.chosen-chip { display: inline-flex; align-items: center; gap: 4px; padding: 1px 4px 1px 6px; font-size: max(var(--ui-min-text-size, 12px), clamp(10px, 0.75vw, 13px)); border-radius: 9px; border: 1px solid var(--ui-border); background: var(--ui-surface); }
.chosen-chip button { border: none; background: none; color: var(--ui-muted); cursor: pointer; font-size: max(var(--ui-min-text-size, 12px), 11px); line-height: 1; padding: 0; }
.chosen-chip button:hover { color: var(--ui-danger); }
/* W33: category cards open a focused, scrollable skill-card subview. */
.skill-picker-panel { position: relative; display: flex; flex-direction: column; gap: 8px; margin: 4px 8px 8px 44px; padding: 8px; border: 1px solid var(--ui-border); border-radius: 6px; background: var(--ui-surface); box-shadow: 0 4px 14px rgba(0,0,0,.4); }
/* W33 (owner spec 4): the static header keeps the ✕ anchored while the category skill grid scrolls. */
.skill-picker-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.skill-picker-heading { font-size: max(var(--ui-min-text-size, 12px), 12px); font-weight: 600; color: var(--ui-text); }
.skill-picker-body { display: flex; flex-direction: column; gap: 8px; }
/* TB8: collapse ✕ pinned top-right of the picker. */
.picker-close { padding: 0 4px; font-size: max(var(--ui-min-primary-text-size, 16px), 13px); line-height: 1; border: none; background: none; color: var(--ui-muted); cursor: pointer; }
.picker-close:hover { color: var(--ui-text); }
/* TB9: the delete ✕ + a small red FIRE caption, stacked. */
.fire-cell { display: inline-flex; flex-direction: column; align-items: center; gap: 1px; }
.fire-label { font-size: max(var(--ui-min-text-size, 12px), 8px); font-weight: 700; letter-spacing: .1em; line-height: 1; color: var(--ui-danger); }
.skill-picker-status { font-size: max(var(--ui-min-text-size, 12px), 11px); color: var(--ui-muted); }
/* Blades (owner 08-18): notebook-tab category rows per the shell blade-ribbon idiom (App.vue) —
   flat blades, active = --ui-primary fill + inset top bar; PRIMARY/SECONDARY headers as notebook tabs. */
.skill-blade-bar { display: flex; flex-direction: column; gap: 4px; }
.skill-blade-tab { align-self: flex-start; padding: 2px 9px 1px; font-size: max(var(--ui-min-text-size, 12px), 9px); font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: var(--ui-heading); background: var(--ui-surface-2); border: 1px solid var(--ui-border); border-bottom: none; border-radius: 5px 5px 0 0; }
.skill-blade-row { display: flex; align-items: stretch; gap: 0; overflow-x: auto; background: var(--ui-surface-2); border-bottom: 2px solid var(--ui-primary); }
.skill-blade { display: inline-flex; flex: 0 0 auto; align-items: center; gap: 5px; padding: 5px 10px; border: 0; background: transparent; color: var(--ui-muted); font-size: max(var(--ui-min-text-size, 12px), 10px); letter-spacing: .04em; cursor: pointer; }
.skill-blade small { color: var(--ui-muted); font-size: max(var(--ui-min-text-size, 12px), 8px); }
.skill-blade:hover { color: var(--ui-text); background: var(--ui-hover); }
.skill-blade[data-active='true'] { color: var(--ui-text); background: var(--ui-primary); font-weight: 700; box-shadow: inset 0 2px 0 var(--ui-heading); }
.skill-blade[data-active='true'] small { color: var(--ui-text); }
.skill-picker-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; max-height: calc((44px * 4) + (6px * 3)); overflow-y: auto; padding-right: 4px; }
/* Commission #5 (owner 08-12): pixel-art diamond sprite (was the "◆" gold glyph), sized to the skill-chip line. */
.elite-mark { flex: 0 0 auto; width: 13px; height: 13px; }
.skill-chip { display: flex; flex-direction: column; justify-content: space-between; gap: 3px; min-width: 0; min-height: 44px; padding: 5px 7px; color: var(--ui-text); font-size: max(var(--ui-min-text-size, 12px), 10px); text-align: left; border-radius: 5px; border: 1px solid var(--ui-border); background: var(--ui-surface-2); cursor: pointer; }
.skill-chip-main,
.skill-chip-meta { display: flex; align-items: center; min-width: 0; }
.skill-chip-main { gap: 4px; }
.skill-chip-main span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.skill-chip-meta { justify-content: flex-end; gap: 5px; min-height: 14px; }
.skill-chip-meta small { color: var(--ui-gold); font-size: max(var(--ui-min-text-size, 12px), 9px); font-weight: 700; }
.skill-picker-icon { width: 14px; height: 14px; object-fit: contain; }
.skill-picker-marker { display: inline-flex; align-items: center; justify-content: center; min-width: 14px; min-height: 14px; color: var(--ui-heading); font-size: max(var(--ui-min-text-size, 12px), 9px); font-weight: 700; line-height: 1; }
.skill-chip:hover:not(:disabled) { border-color: currentColor; }
/* Owned matrix (owner 08-18): innate = dim + green ✓ (inert) · added = dim + ✕ remove affordance. */
.skill-chip.innate, .skill-chip.added, .skill-chip:disabled { opacity: .38; cursor: default; }
.skill-chip-cell { position: relative; display: flex; min-width: 0; }
.skill-chip-cell .skill-chip { flex: 1 1 auto; }
.skill-owned-check { flex: 0 0 auto; color: var(--ui-success); font-weight: 700; }
.skill-chip-remove { position: absolute; top: 2px; right: 2px; padding: 0 4px; border: none; background: none; color: var(--ui-muted); font-size: max(var(--ui-min-text-size, 12px), 12px); line-height: 1; cursor: pointer; }
.skill-chip-remove:hover { color: var(--ui-danger); }
/* TB11 correction (owner 08-11): color-code each skill group — every cell carries a SUBTLE fill in its category's
   colour (superseding the per-category separator bar). The fills ride the existing category tokens via color-mix,
   kept light enough that the full-strength category text keeps contrast. Zero new hex. */
.skill-chip.skill-general { background: color-mix(in srgb, var(--ui-skill-general) 16%, var(--ui-surface-2)); }
.skill-chip.skill-agility { background: color-mix(in srgb, var(--ui-skill-agility) 16%, var(--ui-surface-2)); }
.skill-chip.skill-strength { background: color-mix(in srgb, var(--ui-skill-strength) 16%, var(--ui-surface-2)); }
.skill-chip.skill-passing { background: color-mix(in srgb, var(--ui-skill-passing) 16%, var(--ui-surface-2)); }
.skill-chip.skill-mutation { background: color-mix(in srgb, var(--ui-skill-mutation) 16%, var(--ui-surface-2)); }
.skill-chip.skill-trait { background: color-mix(in srgb, var(--ui-skill-trait) 16%, var(--ui-surface-2)); }
.row-actions button,
.budget-source button { color: var(--ui-muted); background: var(--ui-surface); border: 1px solid var(--ui-border); border-radius: 10px; font-size: max(var(--ui-min-text-size, 12px), clamp(11px, 0.8vw, 14px)); cursor: pointer; }
.row-actions button { padding: 2px 7px; }
.row-actions button:hover { color: var(--ui-danger); border-color: var(--ui-danger); }
.star-card { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 7px; padding: 9px; background: var(--ui-surface); border: 1px solid var(--ui-border); border-radius: 6px; }
.star-row { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 8px 9px; background: var(--ui-surface-2); border: 1px solid var(--ui-border); border-radius: 4px; }
.star-sprites { display: flex; flex: 0 0 auto; }
.star-sprites.paired .sprite-frame + .sprite-frame { margin-left: -12px; box-shadow: -2px 0 0 var(--ui-surface-2); }
.star-copy { display: flex; flex: 1; min-width: 0; flex-direction: column; gap: 2px; }
.star-copy strong { color: var(--ui-text); font-size: max(var(--ui-min-text-size, 12px), 12px); font-weight: 500; }
.star-copy small { color: var(--ui-muted); font-size: max(var(--ui-min-text-size, 12px), 10px); }
.star-actions { display: flex; gap: 4px; }
.star-actions button { display: grid; place-items: center; width: 26px; height: 24px; padding: 0; color: var(--ui-text); background: var(--ui-surface); border: 1px solid var(--ui-border); border-radius: 3px; cursor: pointer; }
.star-actions .star-add { background: var(--ui-primary); border-color: var(--ui-primary); }
.star-actions button:disabled { opacity: .4; cursor: default; }

.right-rail { position: sticky; top: 14px; display: flex; flex-direction: column; gap: 12px; }
/* TB4 (owner 08-11): the Team Value box must be layout-STATIC — the numbers change as players are added but the
   box never reflows. tabular-nums gives fixed-width digit columns, and the value column is right-anchored + nowrap
   so a short→long number (50k → 1,140k) never shifts the label or wraps a line. The rail is already a fixed 300px
   column (.builder-layout), so the box width is stable; this pins the contents. */
.value-card { display: flex; flex-direction: column; gap: 7px; padding: clamp(14px, 1vw, 20px) clamp(16px, 1.15vw, 22px); background: color-mix(in srgb, var(--ui-primary) 10%, var(--ui-surface)); border: 1px solid var(--ui-border); border-radius: 6px; box-shadow: 0 4px 14px rgba(0, 0, 0, .55); font-variant-numeric: tabular-nums; }
.value-card.custom-summary { position: relative; }
/* TB4 companion (owner 08-11): ONE uniform, larger type scale across every row/branch of the Team Value box —
   labels + values share 15px; subtotal/total keep only their colour + border semantics, no size step.
   Owner 08-18 (viewport reflow): that shared size now scales fluidly, same curve as the rest of the panel. */
.value-line { display: flex; justify-content: space-between; gap: 8px; color: var(--ui-text); font-size: max(var(--ui-min-primary-text-size, 16px), clamp(15px, 1.1vw, 19px)); }
.value-line strong { color: var(--ui-eggshell); font-weight: 500; font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; }
.value-line.subtotal { margin-top: 1px; padding-top: 6px; color: var(--ui-muted); border-top: 1px solid var(--ui-border); }
.value-line.total { margin-top: 1px; padding-top: 7px; color: var(--ui-text); border-top: 2px solid var(--ui-primary); }
.value-line .value-unavailable { color: var(--ui-muted); font-weight: 400; }
/* Owner: the Team Summary name row overflowed the card (nowrap + an unbroken all-caps name). The wrappable
   modifier lets THAT value wrap inside the card; every numeric line keeps nowrap/tabular. */
.value-line.wrappable { align-items: baseline; }
.value-line.wrappable span { flex: 0 0 auto; }
.value-line.wrappable strong { min-width: 0; white-space: normal; overflow-wrap: anywhere; }
.value-line .over-budget { color: var(--ui-danger); }
.value-line .within-budget { color: var(--ui-success); }
/* SR-27 (owner 08-17): stale-while-revalidate pending indicator — a refresh is in flight but the numbers on
   screen are still the last-landed ones, so only dim them slightly + spin a dot next to the title. No box
   resize, no value swap (that's the whole point: no flash, no reflow). */
.value-card.is-refreshing .value-line strong,
.validity-card.is-refreshing .validity-headline,
.validity-card.is-refreshing .fix-line { opacity: .55; transition: opacity .15s ease; }
.refresh-dot { display: inline-block; width: 6px; height: 6px; margin-left: 6px; vertical-align: middle; background: var(--ui-primary); border-radius: 50%; animation: refresh-dot-pulse 1s ease-in-out infinite; }
.custom-refresh-dot { position: absolute; top: 10px; right: 10px; margin-left: 0; }
@keyframes refresh-dot-pulse { 0%, 100% { opacity: .3; } 50% { opacity: 1; } }
.budget-source { display: flex; align-items: center; gap: 8px; color: var(--ui-muted); font-size: max(var(--ui-min-text-size, 12px), clamp(10px, 0.75vw, 13px)); }
.budget-source span { flex: 1; }
.budget-source button { padding: 1px 8px; letter-spacing: .08em; }
.budget-editor { display: flex; align-items: center; gap: 8px; }
.budget-editor input { width: clamp(90px, 6.4vw, 116px); padding: 5px 8px; }
.budget-editor span { color: var(--ui-muted); font-size: max(var(--ui-min-text-size, 12px), clamp(11px, 0.8vw, 14px)); }
.live-card,
.result-banner { display: flex; flex-direction: column; gap: 7px; padding: 11px 12px; background: var(--ui-surface); border: 1px solid var(--ui-border); border-radius: 5px; }
.live-card .section-title { margin-bottom: 0; }
/* TB18 (owner 08-11): the single validity panel. Headline states carry the colour; fix lines list the findings. */
.validity-card { position: relative; gap: 6px; }
/* SR-27: validity panel has no section-title to hang the dot off of (the headline IS the title) — position it
   in the card's top-right corner instead, so it reads the same "refresh in progress" signal as the Team Value
   card without disturbing any of the headline/fix-line layout. */
.validity-card.is-refreshing::after { content: ''; position: absolute; top: 10px; right: 10px; width: 6px; height: 6px; background: var(--ui-primary); border-radius: 50%; animation: refresh-dot-pulse 1s ease-in-out infinite; }
.validity-card.valid { border-color: var(--ui-success); }
.validity-card.invalid { border-color: var(--ui-danger); }
.validity-headline { font-size: max(var(--ui-min-primary-text-size, 16px), clamp(14px, 1.05vw, 18px)); font-weight: 500; letter-spacing: .02em; }
.validity-headline.valid { color: var(--ui-success); }
.validity-headline.invalid { color: var(--ui-danger); }
.validity-headline.checking,
.validity-headline.custom { color: var(--ui-muted); }
.validity-headline .tick { font-weight: 700; }
.fix-line { padding: 6px 7px; color: var(--ui-danger); background: color-mix(in srgb, var(--ui-danger) 10%, var(--ui-surface)); border-left: 3px solid var(--ui-danger); border-radius: 3px; font-size: max(var(--ui-min-text-size, 12px), clamp(12px, 0.9vw, 15px)); line-height: 1.35; overflow-wrap: anywhere; }
.validity-card.custom .fix-line { color: var(--ui-gold); background: color-mix(in srgb, var(--ui-gold) 10%, var(--ui-surface)); border-left-color: var(--ui-gold); }
.fix-line.muted { color: var(--ui-muted); background: transparent; border-left-color: var(--ui-border); }
.inline-creds { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; }
.inline-creds label { display: flex; flex-direction: column; gap: 3px; color: var(--ui-muted); font-size: max(var(--ui-min-text-size, 12px), 10px); }
.inline-creds input { padding: 6px 7px; }
.create-button { width: 100%; padding: clamp(9px, 0.65vw, 13px) clamp(12px, 0.9vw, 16px); color: var(--ui-text); background: var(--ui-primary); border: 2px outset color-mix(in srgb, var(--ui-primary) 60%, var(--ui-heading)); border-radius: 4px; font-size: max(var(--ui-min-primary-text-size, 16px), clamp(17px, 1.25vw, 22px)); cursor: pointer; }
.create-button:hover:not(:disabled) { background: color-mix(in srgb, var(--ui-primary) 78%, var(--ui-heading)); }
.create-button:disabled { opacity: .6; cursor: wait; }
.result-banner strong { color: var(--ui-text); font-weight: 500; }
.result-banner span { color: var(--ui-muted); font-size: max(var(--ui-min-text-size, 12px), clamp(11px, 0.8vw, 14px)); overflow-wrap: anywhere; }
.result-banner.success { border-color: var(--ui-success); }
.result-banner.success strong { color: var(--ui-success); }
.result-banner.error { border-color: var(--ui-danger); }
.result-banner.error strong { color: var(--ui-danger); }

.rail-section { display: flex; flex-direction: column; gap: 6px; }
.stepper-row { display: flex; align-items: center; gap: 7px; min-width: 0; padding: clamp(6px, 0.45vw, 9px) clamp(8px, 0.6vw, 12px); background: var(--ui-surface); border: 1px solid var(--ui-border); border-radius: 4px; }
.stepper-row > span { flex: 1; min-width: 0; color: var(--ui-text); font-size: max(var(--ui-min-text-size, 12px), clamp(11px, 0.8vw, 14px)); }
.stepper-row > span small { color: var(--ui-muted); }
.stepper-row button { display: grid; place-items: center; width: clamp(24px, 1.7vw, 30px); height: clamp(22px, 1.55vw, 28px); padding: 0; color: var(--ui-text); background: var(--ui-surface-2); border: 2px outset color-mix(in srgb, var(--ui-text) 28%, var(--ui-surface-2)); border-radius: 3px; font-size: max(var(--ui-min-text-size, 12px), clamp(12px, 0.9vw, 15px)); cursor: pointer; }
.stepper-row .step-add { color: var(--ui-text); background: var(--ui-primary); border-color: color-mix(in srgb, var(--ui-primary) 58%, var(--ui-heading)); }
.stepper-row > b { width: 14px; color: var(--ui-text); font-size: max(var(--ui-min-text-size, 12px), clamp(12px, 0.9vw, 15px)); font-weight: 500; text-align: center; }
.stepper-row > small { width: 80px; color: var(--ui-muted); font-size: max(var(--ui-min-text-size, 12px), clamp(9px, 0.7vw, 12px)); text-align: right; }
.stepper-row button:disabled { opacity: .4; cursor: default; }
.stepper-row.unavailable { opacity: .45; pointer-events: none; }

/* Sideline Staff is deliberately larger than the shared rail controls. At the rail's 260px floor,
   the container query moves only the calculation onto a second, right-aligned line so labels and
   controls keep their full scale without widening the rail or changing Tournament Inducements. */
.staff-section { container-type: inline-size; gap: clamp(8px, 0.6vw, 10px); }
.staff-section > .section-title { margin-bottom: clamp(7px, 0.5vw, 9px); font-size: max(var(--ui-min-primary-text-size, 16px), clamp(15px, 1.1vw, 19px)); }
.staff-section > .stepper-row { box-sizing: border-box; gap: clamp(9px, 0.65vw, 10px); min-height: clamp(46px, 3.25vw, 56px); padding: clamp(8px, 0.6vw, 11px) clamp(10px, 0.75vw, 15px); }
.staff-section .stepper-row > span { line-height: 1.2; white-space: normal; font-size: max(var(--ui-min-primary-text-size, 16px), clamp(14px, 1vw, 17px)); }
.staff-section .stepper-row > span small { display: block; margin-top: 2px; color: var(--ui-muted); font-size: inherit; line-height: 1.1; }
.staff-section .stepper-row button { width: clamp(29px, 2.05vw, 36px); height: clamp(27px, 1.9vw, 34px); font-size: max(var(--ui-min-primary-text-size, 16px), clamp(15px, 1.1vw, 19px)); }
.staff-section .stepper-row > b { width: clamp(17px, 1.2vw, 21px); font-size: max(var(--ui-min-primary-text-size, 16px), clamp(15px, 1.1vw, 19px)); }
.staff-section .stepper-row > small { width: clamp(96px, 6.6vw, 100px); flex: 0 0 auto; overflow-wrap: anywhere; font-size: max(var(--ui-min-text-size, 12px), clamp(11px, 0.82vw, 15px)); line-height: 1.2; }

@container (max-width: 320px) {
  .staff-section > .stepper-row { display: grid; grid-template-columns: minmax(0, 1fr) auto auto auto; }
  .staff-section .stepper-row > small { grid-column: 1 / -1; width: auto; justify-self: end; }
}

.import-panel { min-height: 240px; }
.library-toolbar { display: grid; grid-template-columns: minmax(120px, 1fr) auto minmax(120px, 1fr); align-items: center; gap: 12px; margin-bottom: 12px; }
.library-toolbar > .section-title { margin: 0; text-align: center; }
.library-back-button,
.library-ingest-button { width: max-content; padding: 7px 12px; color: var(--ui-text); background: var(--ui-surface-2); border: 1px solid var(--ui-border); border-radius: 4px; cursor: pointer; }
.library-back-button { justify-self: start; }
.library-ingest-button { grid-column: 3; justify-self: end; color: var(--ui-eggshell); background: var(--ui-primary); border-color: var(--ui-heading); }
.library-workspace { display: grid; grid-template-columns: clamp(220px, 22vw, 310px) minmax(0, 1fr); gap: 12px; min-height: min(720px, calc(100vh - 250px)); }
.library-sidebar { display: flex; flex-direction: column; gap: 7px; max-height: calc(100vh - 250px); overflow-y: auto; padding: 8px; background: var(--ui-surface-2); border: 1px solid var(--ui-border); border-radius: 6px; overscroll-behavior: contain; }
.library-sidebar-team { display: flex; align-items: center; gap: 10px; width: 100%; min-width: 0; padding: 9px; color: var(--ui-text); text-align: left; background: var(--ui-surface); border: 1px solid transparent; border-radius: 5px; cursor: pointer; }
.library-sidebar-team:hover,
.library-sidebar-team.selected { border-color: var(--ui-heading); background: color-mix(in srgb, var(--ui-primary) 18%, var(--ui-surface)); }
.library-sidebar-team > span:last-child { min-width: 0; }
.library-sidebar-team strong,
.library-sidebar-team small { display: block; overflow: hidden; text-overflow: ellipsis; }
.library-sidebar-team strong { color: var(--ui-eggshell); white-space: normal; overflow-wrap: anywhere; }
.library-sidebar-team small { margin-top: 2px; color: var(--ui-muted); font-size: max(var(--ui-min-text-size, 12px), 10px); white-space: nowrap; }
.library-sidebar .library-crest img,
.library-sidebar .library-crest { width: 42px; height: 42px; }
.library-sidebar .library-crest img { object-fit: contain; image-rendering: pixelated; }
.library-detail-pane { min-width: 0; padding: 10px; background: var(--ui-surface-2); border: 1px solid var(--ui-border); border-radius: 6px; }
.library-empty-state { display: grid; place-items: center; align-content: center; min-height: 360px; color: var(--ui-muted); text-align: center; }
.library-empty-state .section-title { margin-bottom: 8px; }
.library-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); align-items: start; gap: 10px; }
.library-team { display: flex; flex-direction: column; gap: 6px; width: 100%; min-width: 0; max-width: 100%; box-sizing: border-box; padding: 10px 12px; background: var(--ui-surface); border: 1px solid var(--ui-border); border-radius: 6px; }
.library-team:has(.library-team-select:hover),
.library-team.selected { border-color: var(--ui-heading); background: color-mix(in srgb, var(--ui-primary) 18%, var(--ui-surface)); }
.library-team-select { display: flex; align-items: center; gap: 10px; width: 100%; min-width: 0; padding: 0; color: var(--ui-text); text-align: left; background: none; border: none; cursor: pointer; }
.library-crest { display: grid; place-items: center; width: 40px; height: 40px; flex: 0 0 auto; overflow: hidden; color: var(--ui-eggshell); background: var(--ui-tier-1); border: 2px solid var(--ui-eggshell); border-radius: 50%; }
.library-crest img { width: 100%; height: 100%; object-fit: contain; }
.library-team-select > span:last-child { min-width: 0; }
.library-team-select strong,
.library-team-select small { display: block; }
.library-team-select strong { display: -webkit-box; overflow: hidden; color: var(--ui-eggshell); font-weight: 500; white-space: normal; overflow-wrap: anywhere; word-break: break-word; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; }
.library-team-select small { margin-top: 2px; overflow-wrap: anywhere; word-break: break-word; color: var(--ui-muted); font-size: max(var(--ui-min-text-size, 12px), 11px); white-space: normal; }
.retire-team-button { align-self: flex-end; padding: 4px 10px; color: var(--ui-muted); font-size: max(var(--ui-min-text-size, 12px), 11px); background: none; border: 1px solid var(--ui-border); border-radius: 4px; cursor: pointer; }
.retire-team-button:hover:not(:disabled) { color: var(--ui-text); border-color: var(--ui-heading); }
.retire-team-button:disabled { opacity: .55; cursor: default; }
.import-team-display { margin-top: 4px; }
/* Owner annotation pass: values sit OVER their descriptors everywhere in the library row — the stat chips
   stack vertically (value / label), and Value/SPP are stacked value / descriptor cells. The Earned column is
   gone (7 columns). Numeric values stay nowrap so "210K" can never shred vertically. */
.library-roster-grid { grid-template-columns: 32px minmax(130px, 1.1fr) minmax(210px, 1.2fr) minmax(150px, 1.5fr) minmax(84px, .5fr) minmax(78px, .5fr) minmax(120px, 1fr); min-width: 1000px; }
/* (library rows inherit the stacked chips from the base .row-stats rule now) */
.library-num-cell { display: flex; flex-direction: column; align-items: center; gap: 1px; min-width: 0; text-align: center; white-space: nowrap; }
.library-num-cell b { color: var(--ui-text); font-size: max(var(--ui-min-primary-text-size, 16px), clamp(14px, 1.05vw, 18px)); font-weight: 500; }
.library-num-cell small { color: var(--ui-skill-strength); font-size: max(var(--ui-min-text-size, 12px), clamp(8px, 0.6vw, 11px)); letter-spacing: .04em; }
/* Null value (stat chip): a quiet dash, not something that parses as a number. */
.library-roster-row .stat-missing { color: var(--ui-muted); font-weight: 400; }
/* Gap-analysis P1: lasting injuries under the position line — danger-tinted so a hurt player reads at a glance. */
.player-copy .player-injuries { display: block; margin-top: 1px; color: var(--ui-danger); font-size: max(var(--ui-min-text-size, 12px), 10px); }
/* P2 (FUMBBLUI contract): management controls — steppers on the summary rail, inline rename, renumber input. */
.mgmt-value { display: inline-flex; align-items: center; gap: 6px; }
.mgmt-step,
.mgmt-edit {
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  color: var(--ui-text);
  background: var(--ui-surface);
  border: 1px solid var(--ui-border);
  border-radius: 4px;
  font-size: max(var(--ui-min-text-size, 12px), 12px);
  line-height: 1;
  cursor: pointer;
}
.mgmt-edit { margin-left: 6px; color: var(--ui-muted); }
.mgmt-step:hover:not(:disabled),
.mgmt-edit:hover:not(:disabled) { color: var(--ui-heading); border-color: var(--ui-heading); }
.mgmt-step:disabled,
.mgmt-edit:disabled { opacity: .4; cursor: default; }
.rename-controls { display: inline-flex; flex: 1; align-items: center; gap: 5px; min-width: 0; }
.rename-controls input { flex: 1; min-width: 0; padding: 3px 6px; }
.mgmt-status { color: var(--ui-danger); }
.slot-number-input {
  width: 100%;
  max-width: 34px;
  padding: 2px 1px;
  color: var(--ui-text);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  text-align: center;
  font: inherit;
  -moz-appearance: textfield;
  appearance: textfield;
}
.slot-number-input::-webkit-outer-spin-button,
.slot-number-input::-webkit-inner-spin-button { margin: 0; -webkit-appearance: none; appearance: none; }
.slot-number-input:hover,
.slot-number-input:focus { border-color: var(--ui-border); background: var(--ui-surface); outline: none; }
.slot-number-input:disabled { opacity: .55; }
/* P3: player lifecycle menu + hire row + ready actions. */
.player-actions { position: relative; display: inline-flex; }
.player-actions-menu {
  position: absolute;
  z-index: 30;
  top: calc(100% + 4px);
  right: 0;
  display: flex;
  flex-direction: column;
  min-width: 168px;
  padding: 4px;
  background: var(--ui-surface-2);
  border: 1px solid var(--ui-heading);
  border-radius: 6px;
  box-shadow: 0 8px 22px rgb(0 0 0 / 55%);
}
.player-actions-menu button {
  padding: 5px 8px;
  color: var(--ui-text);
  background: none;
  border: 0;
  border-radius: 4px;
  text-align: left;
  font-size: max(var(--ui-min-text-size, 12px), 12px);
  cursor: pointer;
}
.player-actions-menu button:hover { color: var(--ui-heading); background: var(--ui-surface); }
.hire-row { padding: 8px 2px 2px; }
.mgmt-hire-button {
  padding: 6px 12px;
  color: var(--ui-text);
  background: var(--ui-primary);
  border: 1px solid var(--ui-heading);
  border-radius: 4px;
  cursor: pointer;
}
.mgmt-hire-button:disabled { opacity: .5; cursor: default; }
.hire-form { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.hire-form select,
.hire-form input { min-width: 0; padding: 5px 7px; }
/* The view-wide `select { width:100% }` rule would give each select its own full row — pin them to content. */
.hire-form select { flex: 0 1 auto; width: auto; max-width: 250px; }
.hire-form input[type='text'] { flex: 1 1 170px; }
.ready-actions { display: flex; gap: 7px; margin-top: 7px; }
.ready-actions .ready-button { flex: 1; margin-top: 0; }
.ready-actions .retire-team-button { align-self: stretch; }
.library-advancement-cell { display: flex; align-items: center; justify-content: space-between; gap: 7px; min-width: 0; }
.library-advancement-cell > span { display: flex; flex-direction: column; min-width: 0; }
.library-advancement-cell b { overflow-wrap: anywhere; color: var(--ui-eggshell); font-size: max(var(--ui-min-text-size, 12px), 11px); }
.library-advancement-cell small { color: var(--ui-muted); font-size: max(var(--ui-min-text-size, 12px), 9px); }
/* Owner: the Add Skill box hugged too wide — compact stacked button (TB10 .skill-add-btn idiom), and the
   rule is SCOPED to .add-skill-btn so the ⋯/lifecycle-menu buttons in the same cell stop inheriting the
   primary-red padding (the bare `.library-advancement-cell button` selector was out-styling them). */
.library-advancement-cell .add-skill-btn,
.advancement-confirm,
.advancement-roll-choices button { padding: 5px 8px; color: var(--ui-text); background: var(--ui-primary); border: 1px solid var(--ui-heading); border-radius: 4px; cursor: pointer; }
.library-advancement-cell .add-skill-btn { display: inline-flex; align-items: center; justify-content: center; padding: 3px 7px; line-height: 1.15; font-size: max(var(--ui-min-text-size, 12px), 11px); white-space: nowrap; }
.library-advancement-cell .add-skill-btn:disabled,
.advancement-confirm:disabled { opacity: .45; cursor: default; }
.detail-retire-button { align-self: stretch; width: 100%; margin-top: 7px; }
.import-roster-placeholder { min-height: 96px; }
.fumbbl-teams-section { display: flex; flex-direction: column; gap: 8px; margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--ui-border); }
.fumbbl-teams-section > .section-title { margin-bottom: 0; }
.fumbbl-team-search { display: flex; gap: 8px; max-width: 520px; }
.fumbbl-team-search input { flex: 1; min-width: 0; padding: 7px 9px; }
.fumbbl-team-search button,
.fumbbl-import-button { color: var(--ui-text); background: var(--ui-primary); border: 1px solid var(--ui-heading); border-radius: 4px; cursor: pointer; }
.fumbbl-team-search button { padding: 7px 12px; }
.fumbbl-team-search button:disabled,
.fumbbl-import-button:disabled { opacity: .55; cursor: default; }
.fumbbl-team-grid { margin-top: 2px; }
/* Owner ruling 08-18: .library-team went column-flex to stack the new Retire Team button under
   the (now inner) .library-team-select row — the FUMBBL-teams card has no such inner wrapper
   (crest/copy/button are direct children), so it opts back into the original row layout. */
.fumbbl-team-card { flex-direction: row; align-items: center; cursor: default; }
.fumbbl-team-card:hover { border-color: var(--ui-border); background: var(--ui-surface); }
.fumbbl-team-card .library-crest img { image-rendering: pixelated; }
.fumbbl-team-copy { flex: 1; min-width: 0; }
.fumbbl-import-button { flex: 0 0 auto; padding: 5px 9px; font-size: max(var(--ui-min-text-size, 12px), 11px); }
.edit-team-button { margin-top: 6px; padding: 7px 12px; color: var(--ui-text); background: var(--ui-primary); border: 1px solid var(--ui-heading); border-radius: 4px; cursor: pointer; }
/* Owner 08-13: overflow-wrap:anywhere removed — it existed for the long Value/SPP strings that now live in nowrap
   .library-num-cell; on the remaining MA/ST/AG/PA/AV chips it could only ever split a value mid-number. */
.library-roster-row .row-stats b { text-align: center; font-size: max(var(--ui-min-text-size, 12px), clamp(11px, 0.8vw, 14px)); }
.library-roster-status b { color: var(--ui-eggshell); }
.edit-ruleset-hint { margin-top: 8px; }
.library-modal-backdrop { position: fixed; inset: 0; z-index: 1200; display: grid; place-items: center; padding: 24px; background: rgb(0 0 0 / 72%); }
.library-modal { width: min(920px, 94vw); max-height: min(780px, 90vh); overflow: auto; padding: 16px; color: var(--ui-text); background: var(--ui-surface-2); border: 1px solid var(--ui-heading); border-radius: 7px; box-shadow: 0 18px 54px rgb(0 0 0 / 55%); overscroll-behavior: contain; }
.library-modal > header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
.library-modal > header .section-title { margin: 0; }
.library-modal > header > button { width: 30px; height: 30px; padding: 0; color: var(--ui-text); background: var(--ui-surface); border: 1px solid var(--ui-border); border-radius: 4px; cursor: pointer; }
.advancement-modal { width: min(760px, 94vw); }
.advancement-summary { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
.advancement-summary > span { padding: 6px 9px; color: var(--ui-muted); background: var(--ui-surface); border: 1px solid var(--ui-border); border-radius: 4px; }
.advancement-summary b { color: var(--ui-eggshell); }
.advancement-methods { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 7px; margin-bottom: 14px; }
.advancement-methods button { display: flex; flex-direction: column; gap: 3px; padding: 8px; color: var(--ui-muted); background: var(--ui-surface); border: 1px solid var(--ui-border); border-radius: 4px; cursor: pointer; }
.advancement-methods button.active { color: var(--ui-eggshell); border-color: var(--ui-heading); background: color-mix(in srgb, var(--ui-primary) 25%, var(--ui-surface)); }
.advancement-methods small { color: var(--ui-gold); }
.advancement-field { display: flex; flex-direction: column; gap: 5px; margin-bottom: 10px; color: var(--ui-muted); }
.advancement-field select { min-height: 34px; padding: 6px 8px; color: var(--ui-text); background: var(--ui-surface); border: 1px solid var(--ui-border); border-radius: 4px; }
.advancement-roll-choices { display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0; }
.characteristic-fallback { margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--ui-border); }

@media (max-width: 980px) {
  .builder-layout { grid-template-columns: 1fr; }
  .right-rail { position: static; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .value-card,
  .rail-section { grid-column: span 2; }
  .library-workspace { grid-template-columns: 190px minmax(0, 1fr); }
}

@media (max-width: 680px) {
  .team-builder-view { padding: 12px; }
  .test-environment-notice { align-items: flex-start; flex-direction: column; gap: 3px; }
  .mode-grid,
  .form-grid { grid-template-columns: 1fr; }
  .right-rail { display: flex; }
  .value-card,
  .rail-section { grid-column: auto; }
  .skill-key { margin-left: 0; }
  .inline-creds { grid-template-columns: 1fr; }
  .library-toolbar { grid-template-columns: 1fr auto; }
  .library-toolbar > .section-title { display: none; }
  .library-ingest-button { grid-column: 2; }
  .library-workspace { grid-template-columns: 1fr; }
  .library-sidebar { max-height: 230px; }
  .advancement-methods { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
