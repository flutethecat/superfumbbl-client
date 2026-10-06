/**
 * Owner 2026-10-06: the Home pane walkthrough (docs/artifact-orchestration/spec-home-pane-tour.md) - the pure step model.
 *
 * Same availability as the FUMBBL.COM pane (every edition since 10-06; the shell's default `fumbbl-home` feature).
 *
 * Steps 1-5 are drawn INSIDE the FUMBBL webview by the injected runtime (src-tauri/src/home_tour_runtime.js); the host
 * sends it one step at a time as JSON (`window.__sfTour.show(<payload>)`, through fumbbl_home_tour). Its buttons come back
 * as `fumbbl-home:tour` events ("<button>.<step id>"); page loads come back as `fumbbl-home:page-load` {url, loggedIn,
 * coach}. Owner 10-06: the last site step (Overview) hands off to the CLIENT walkthrough (game/clientTour.ts), which
 * ends on the third-party disclaimer; the site walkthrough no longer shows it.
 *
 * Selectors were read from the logged-OUT live site on 10-06 (curl of the HTML and the site's own Vue bundles) and, for the
 * logged-in header, from saved logged-in pages in fumbbl40k-client/FumbblWebsite/. The overview Play links could not be
 * seen read-only and carry fallbacks (see ARROWS below).
 */

export const HOME_TOUR_VERSION = 1;

/** `findernav` (owner 10-06) = the Gamefinder sub-step before "Join the Draw": how to reach the page from the nav. */
export type TourStepId = 'home' | 'login' | 'findernav' | 'gamefinder' | 'blackbox' | 'squads' | 'overview';
export const TOUR_STEPS: readonly TourStepId[] = ['home', 'login', 'findernav', 'gamefinder', 'blackbox', 'squads', 'overview'];

/** `back` = the previous step (owner 10-06); `resume` = reload the current step's page from the off-page card. */
export type TourButtonId = 'next' | 'skip' | 'rules' | 'back' | 'resume';

/** One way to find an element: a CSS selector, optionally narrowed to elements whose text (or value) equals `text`
 *  (trimmed, case-insensitive). An arrow tries its candidates in order and uses the first visible match. */
export interface TargetCandidate {
  selector: string;
  text?: string;
}

export interface ArrowSpec {
  /** For the overlay's log line when nothing matches. */
  name: string;
  candidates: TargetCandidate[];
}

/** What the injected runtime is sent for a step (JSON; every string is set with textContent, never parsed as HTML). */
export interface SitePayload {
  step: TourStepId;
  title: string;
  body: string;
  arrows: ArrowSpec[];
  buttons: Array<{ id: TourButtonId; label: string }>;
  /** `upper-right`: up and to the right of the centred card (the Gamefinder nav sub-step, owner 10-06). */
  placement: 'center' | 'corner' | 'upper-right';
  /** The small off-page card; every other card is the large one (owner 10-06: "the cards are too small"). */
  compact?: boolean;
  /** Elements of the site the card must not cover (no arrow is drawn to them), e.g. the login form. */
  avoid?: string[];
  /** How long the runtime waits for the site's own (Vue-rendered) elements before it degrades. */
  waitMs: number;
  /** The no-teams branch: when none of `present` matches within waitMs (and no arrow found its element), show `body`
   *  instead, without arrows. */
  alternate?: { present: string[]; body: string };
  /** A site nav item whose hover-only dropdown the runtime opens while the card shows (theme-min.js does the same on
   *  hover: classes `selected expanded` on the <li> and `.submenu` shown); undone by clear(). */
  reveal?: string;
  /** A site tab the runtime clicks once when the card shows (waits up to waitMs for the Vue page to render it; a missing
   *  tab is logged and the card shows anyway). Only the Blackbox Trophy page's own Rules / My Squads tabs. */
  autoClick?: string;
  /** Elements the runtime clicks for a button before reporting it (the site's own tab, never a form). */
  clicks?: Partial<Record<TourButtonId, string>>;
}

export const FUMBBL_ORIGIN = 'https://fumbbl.com';
export const URLS = {
  home: `${FUMBBL_ORIGIN}/`,
  /** The header's "Log in" link (`.accountbox a[href="/p/login"]`). */
  login: `${FUMBBL_ORIGIN}/p/login`,
  /** GAME > Gamefinder. NOTE: the GAME nav item itself targets /p/games (Spectate), not the Gamefinder. */
  gamefinder: `${FUMBBL_ORIGIN}/p/lfg2`,
  /** The "Blackbox Trophy" link under the Gamefinder's Blackbox box (`.blackboxtrophy a`). */
  blackbox: `${FUMBBL_ORIGIN}/p/boxtrophy`,
} as const;

/** The coach overview page, https://fumbbl.com/~<coach> (the site's own link is `/~<Coach>`). */
export function overviewUrl(coach: string): string | null {
  const name = sanitizeCoach(coach);
  return name ? `${FUMBBL_ORIGIN}/~${encodeURIComponent(name)}` : null;
}

/** FUMBBL coach names are letters, digits and a few separators; anything else is not used to build a URL. */
export function sanitizeCoach(value: unknown): string {
  if (typeof value !== 'string') return '';
  const name = value.trim();
  return /^[A-Za-z0-9 _.-]{1,40}$/.test(name) ? name : '';
}

export const ARROWS = {
  /** `<div class="mainmenu"><a href="/p/games">Game</a>` - the Gamefinder lives in its submenu. */
  game: { name: 'GAME nav', candidates: [{ selector: '.topnav .mainmenu a[href="/p/games"]' }, { selector: '.topnav .mainmenu a', text: 'Game' }] },
  /** Logged in, the first nav item is "Home" -> /~<Coach> (submenu "Overview"); logged out there is no such item and the
   *  arrow falls back to the account box ("Log in"). Logged-in markup from saved site pages (FumbblWebsite/, 2026-09). */
  coach: { name: 'coach / overview link', candidates: [{ selector: '.topnav .mainmenu a[href*="/~"]' }, { selector: '.accountbox a' }] },
  forum: { name: 'FORUM nav', candidates: [{ selector: '.topnav .mainmenu a[href*="PNphpBB2"]' }, { selector: '.topnav .mainmenu a', text: 'Forum' }] },
  /** GAME's dropdown entry "Gamefinder" (`<div class="submenu"><a href="/p/lfg2">Gamefinder</a>`; hover-only, opened by
   *  the payload's `reveal`); the GAME item itself if the entry cannot be shown. */
  gamefinderMenu: {
    name: 'GAME > Gamefinder menu entry',
    candidates: [
      { selector: '.topnav .submenu a[href="/p/lfg2"]', text: 'Gamefinder' },
      { selector: '.topnav .submenu a[href$="/p/lfg2"]' },
      { selector: '.topnav .mainmenu a[href="/p/games"]' },
    ],
  },
  /** gamefinder.js Blackbox.vue: `<div id="blackboxwrapper"> ... <button>Join the Draw</button>` (only while the
   *  Blackbox is active and the coach has a Blackbox-eligible team). */
  joinDraw: { name: '"Join the Draw"', candidates: [{ selector: '#blackboxwrapper button', text: 'Join the Draw' }, { selector: 'button', text: 'Join the Draw' }] },
  /** boxtrophy page header nav: `<li id="nav-mySquads">My Squads</li>` (pageheader.js: id "nav-" + page). */
  mySquads: { name: '"My Squads"', candidates: [{ selector: '#nav-mySquads' }, { selector: 'li', text: 'My Squads' }] },
  /** Coach overview team table rows are `tr.team`; the Play link is only rendered for the logged-in owner (not
   *  verifiable read-only), so the text match does the work. */
  play: {
    name: '"Play" link',
    candidates: [
      { selector: 'tr.team a, tr.team button, tr.team input[type="button"]', text: 'Play' },
      { selector: '.pagecontent a, .pagecontent button', text: 'Play' },
    ],
  },
} satisfies Record<string, ArrowSpec>;

/** Gamefinder: the coach's teams looking for a game (`#cards .card`) and the "Choose teams" rows (`#lfgteams .lfgteam`). */
export const TEAM_PRESENT_SELECTORS = ['#cards .card', '#lfgteams .lfgteam'];

const NEXT = { id: 'next', label: 'Next' } as const;
const SKIP = { id: 'skip', label: 'Skip walkthrough' } as const;
/** Owner 10-06: every card after the first can go back one step. */
export const BACK = { id: 'back', label: '◂ Back' } as const;

export const COPY = {
  /** Owner 10-06: step 1 is the FUMBBL news page - a plain centred card, no arrows; two paragraphs (the runtime keeps the
   *  blank line: white-space pre-line). */
  home: "This is the FUMBBL website where you'll find games and manage your teams. You'll use the Gamefinder to find games, the overview pane to manage your teams, and the forums to join communities and talk with other users.\n\nThis Home page shows the latest FUMBBL news and announcements — check it when you log in.",
  login: 'Log in or create an account to continue.',
  findernav: 'This is Gamefinder. Access it by selecting "Game" then "Gamefinder".',
  gamefinder: 'Click "Join the Draw" to queue any teams you already have setup.',
  gamefinderNoTeams: "If you don't have any teams setup, create one from your overview page first — we'll go there in a moment.",
  blackbox: "Blackbox Trophy is FUMBBL's premier competitive environment. Each season, you'll draft a team of different factions and compete over 15 games with each to be the best person in the community. You get a budget of points to spend and each season the teams cost a different amount so you'll need to review the rules for whatever season we're currently in and construct the best team possible!",
  squads: 'My Squads lists the squad you drafted and how each team is doing.',
  overview: 'This is the overview page where you can access your teams and start matches against specific people. Click the Play button to start a match. The client will launch it right here for you.',
} as const;

const WAIT_MS = 6000;

export function sitePayload(step: TourStepId): SitePayload {
  const base = { step, arrows: [] as ArrowSpec[], buttons: [BACK, NEXT, SKIP] as SitePayload['buttons'], placement: 'center' as const, waitMs: WAIT_MS };
  switch (step) {
    case 'home':
      return { ...base, title: 'FUMBBL.COM', body: COPY.home, buttons: [NEXT, SKIP], waitMs: 0 };
    case 'login':
      // Centred like the other text-only cards (owner 10-06), kept off FUMBBL's own login form.
      return { ...base, title: 'Log in', body: COPY.login, buttons: [BACK, SKIP], avoid: ['#postform', 'form[action*="user.php"]'], waitMs: 0 };
    case 'findernav':
      return {
        ...base,
        title: 'Gamefinder',
        body: COPY.findernav,
        arrows: [ARROWS.gamefinderMenu],
        placement: 'upper-right',
        reveal: '.topnav .mainmenu a[href="/p/games"]',
      };
    case 'gamefinder':
      return {
        ...base,
        title: 'Gamefinder',
        body: COPY.gamefinder,
        arrows: [ARROWS.joinDraw],
        alternate: { present: TEAM_PRESENT_SELECTORS, body: COPY.gamefinderNoTeams },
      };
    case 'blackbox':
      return {
        ...base,
        title: 'Blackbox Trophy',
        body: COPY.blackbox,
        buttons: [BACK, { id: 'rules', label: 'Open the rules' }, NEXT, SKIP],
        clicks: { rules: '#nav-rules' },
      };
    case 'squads':
      // Owner 10-06: the My Squads page itself is shown under the card (the site's own tab, as for Rules).
      return { ...base, title: 'Blackbox Trophy', body: COPY.squads, arrows: [ARROWS.mySquads], autoClick: '#nav-mySquads' };
    case 'overview':
      return { ...base, title: 'Overview', body: COPY.overview, arrows: [ARROWS.play] };
  }
}

export const COPY_RESUME = 'This page is not part of the walkthrough. Go back to continue it, or skip it.';

/** Shown when a page load is not the step's own document (the coach clicked away, or a redirect landed elsewhere): the
 *  step does not draw on a page it was not made for; "Back to the walkthrough" reloads the step's page. */
export function resumePayload(step: TourStepId): SitePayload {
  return {
    step,
    title: sitePayload(step).title,
    body: COPY_RESUME,
    arrows: [],
    buttons: [{ id: 'resume', label: 'Back to the walkthrough' }, SKIP],
    placement: 'corner',
    compact: true,
    waitMs: 0,
  };
}

/** Steps that need a logged-in coach: a logged-out page load on one of them sends the tour back to the login step. */
export const PROTECTED_STEPS: readonly TourStepId[] = ['findernav', 'gamefinder', 'blackbox', 'squads', 'overview'];

/** The page a step lives on when it is a fixed page (sub-steps share their page: the Gamefinder nav card and "Join the
 *  Draw"; Blackbox and My Squads). */
function stepDocument(step: TourStepId): string | null {
  switch (step) {
    case 'home': return URLS.home;
    case 'findernav':
    case 'gamefinder': return URLS.gamefinder;
    case 'blackbox':
    case 'squads': return URLS.blackbox;
    default: return null;
  }
}

/** True when `url` is the document `target` names: same fumbbl.com host (www or not), same path (case-insensitive,
 *  trailing slash ignored); query and fragment ignored. Anything unparseable is a different document. */
export function sameDocument(url: string, target: string): boolean {
  try {
    const a = new URL(url);
    const b = new URL(target);
    const host = (u: URL) => u.hostname.toLowerCase().replace(/^www\./, '');
    const path = (u: URL) => u.pathname.toLowerCase().replace(/\/+$/, '') || '/';
    return a.protocol === b.protocol && host(a) === host(b) && path(a) === path(b);
  } catch {
    return false;
  }
}

/** Gating (spec): after the first-launch setup has completed, while the seen version is below HOME_TOUR_VERSION. The
 *  base has no `setupWizardSeenVersion` setting (10-06), so `completedFirstRun` is the gate unless one appears. */
export function shouldStartTour(s: { homeTourSeenVersion: number; completedFirstRun: boolean; setupWizardSeenVersion?: number }): boolean {
  const setupDone = typeof s.setupWizardSeenVersion === 'number' ? s.setupWizardSeenVersion >= 1 : s.completedFirstRun === true;
  return setupDone && !(s.homeTourSeenVersion >= HOME_TOUR_VERSION);
}

/** The no-teams branch: true when the alternate copy shows (nothing of the coach's teams and no arrow target found). */
export function showsNoTeamsCopy(counts: { present: number; arrowsFound: number }): boolean {
  return counts.present === 0 && counts.arrowsFound === 0;
}

// --- events ---------------------------------------------------------------------------------------------------------

/** The site webview's control channel: a navigation to `https://fumbbl.com/__sf-tour__#sf-tour:<event>` that the shell
 *  denies (fumbbl_home.rs tour_event). A plain `location.hash` change cannot be used: WebView2 raises no
 *  NavigationStarting for same-document navigations, so on_navigation would never see it. */
export const TOUR_EVENT_PATH = '/__sf-tour__';
export const TOUR_HASH_PREFIX = '#sf-tour:';

export interface TourEvent {
  button: TourButtonId;
  step: TourStepId;
}

/** Parses `#sf-tour:<button>.<step>` (or a full URL ending in it, or the bare `<button>.<step>` the shell emits).
 *  Anything else is null. */
export function parseTourEvent(value: string): TourEvent | null {
  if (typeof value !== 'string') return null;
  const hash = value.indexOf('#');
  let body = hash >= 0 ? value.slice(hash) : value;
  if (body.startsWith(TOUR_HASH_PREFIX)) body = body.slice(TOUR_HASH_PREFIX.length);
  else if (hash >= 0) return null;
  const m = /^([a-z]+)\.([a-z]+)$/.exec(body);
  if (!m) return null;
  const button = m[1] as TourButtonId;
  const step = m[2] as TourStepId;
  if (!(['next', 'skip', 'rules', 'back', 'resume'] as string[]).includes(button) || !TOUR_STEPS.includes(step)) return null;
  return { button, step };
}

// --- the state machine ----------------------------------------------------------------------------------------------

export interface TourState {
  step: TourStepId | 'done';
  /** From the last page-load report; null before the first one. */
  loggedIn: boolean | null;
  /** Read by the runtime from the logged-in page. */
  coach: string;
  /** The client's own FUMBBL coach setting: used when the page did not yield a name. */
  fallbackCoach: string;
  /** The document the current step lives on (null = any page: login, an overview without a coach name). */
  target?: string | null;
  /** A protected step interrupted by a logged-out page load: resumed after the login step. */
  resume?: TourStepId | null;
}

export type TourEffect =
  | { kind: 'arm' }
  | { kind: 'navigate'; url: string }
  | { kind: 'show'; payload: SitePayload }
  | { kind: 'clear' }
  /** The site walkthrough is finished (Overview's Next): the client walkthrough takes over. */
  | { kind: 'handoff' }
  | { kind: 'seen' }
  | { kind: 'log'; message: string };

export type TourInput =
  | { type: 'start'; fallbackCoach: string }
  | { type: 'page-load'; url: string; loggedIn: boolean; coach: string }
  | { type: 'event'; event: TourEvent };

/** The step "◂ Back" returns to: the one before, skipping login when the coach is already logged in. */
export function previousStep(step: TourStepId, loggedIn: boolean | null): TourStepId {
  const i = TOUR_STEPS.indexOf(step);
  const prev = TOUR_STEPS[Math.max(0, i - 1)]!;
  return prev === 'login' && loggedIn === true ? 'home' : prev;
}

function nextStep(step: TourStepId): TourStepId {
  const i = TOUR_STEPS.indexOf(step);
  return TOUR_STEPS[Math.min(i + 1, TOUR_STEPS.length - 1)]!;
}

function enter(state: TourState, step: TourStepId, effects: TourEffect[]): TourState {
  if (step === 'login' && state.loggedIn === true) {
    const resume = state.resume ?? nextStep(step);
    return enter({ ...state, resume: null }, resume, effects);
  }
  const next: TourState = { ...state, step };
  switch (step) {
    case 'login':
      effects.push({ kind: 'navigate', url: URLS.login });
      return { ...next, target: null }; // the login form posts and redirects: any page load counts
    case 'overview': {
      const url = overviewUrl(state.coach) ?? overviewUrl(state.fallbackCoach);
      if (url) effects.push({ kind: 'navigate', url });
      else {
        effects.push({ kind: 'log', message: 'no coach name for the overview page: showing the step without navigating' });
        effects.push({ kind: 'show', payload: sitePayload('overview') });
      }
      return { ...next, target: url };
    }
    default: {
      const doc = stepDocument(step)!;
      // A sub-step on the page the pane already shows (Gamefinder nav <-> Join the Draw, Blackbox <-> My Squads, in
      // either direction) shows at once; otherwise the page is loaded and its load report shows the step.
      const samePage = state.step !== step && state.step !== 'done' && state.target === doc && stepDocument(state.step) === doc;
      if (samePage) {
        // Back from My Squads returns to the Rules view of the same page.
        const payload = step === 'blackbox' && state.step === 'squads' ? { ...sitePayload('blackbox'), autoClick: '#nav-rules' } : sitePayload(step);
        effects.push({ kind: 'show', payload });
      }
      else effects.push({ kind: 'navigate', url: doc });
      return { ...next, target: doc };
    }
  }
}

export function startTour(fallbackCoach: string): { state: TourState; effects: TourEffect[] } {
  const effects: TourEffect[] = [{ kind: 'arm' }];
  const fresh: TourState = { step: 'home', loggedIn: null, coach: '', fallbackCoach: sanitizeCoach(fallbackCoach) };
  return { state: enter(fresh, 'home', effects), effects };
}

/** Pure transition. `state` null = no tour running. */
export function tourReduce(state: TourState | null, input: TourInput): { state: TourState | null; effects: TourEffect[] } {
  const effects: TourEffect[] = [];
  if (input.type === 'start') return startTour(input.fallbackCoach);
  if (!state || state.step === 'done') return { state, effects };
  const step = state.step;
  switch (input.type) {
    case 'page-load': {
      const updated: TourState = { ...state, loggedIn: input.loggedIn === true, coach: sanitizeCoach(input.coach) || state.coach };
      if (step === 'login') {
        if (updated.loggedIn) return { state: enter(updated, 'login', effects), effects }; // resumes / moves on
        effects.push({ kind: 'show', payload: sitePayload('login') });
        return { state: updated, effects };
      }
      if (PROTECTED_STEPS.includes(step) && !updated.loggedIn) {
        // Logged out (session expired, or logged out in the pane): log in again, then come back to this step.
        return { state: enter({ ...updated, resume: step }, 'login', effects), effects };
      }
      if (updated.target && !sameDocument(input.url, updated.target)) {
        effects.push({ kind: 'show', payload: resumePayload(step) });
        return { state: updated, effects };
      }
      effects.push({ kind: 'show', payload: sitePayload(step) });
      return { state: updated, effects };
    }
    case 'event': {
      const { button, step: from } = input.event;
      if (from !== step) return { state, effects }; // stale (a double click) or for another step
      if (button === 'skip') {
        effects.push({ kind: 'clear' }, { kind: 'seen' });
        return { state: { ...state, step: 'done' }, effects };
      }
      if (button === 'resume') {
        if (state.target) effects.push({ kind: 'navigate', url: state.target });
        return { state, effects };
      }
      if (button === 'back') {
        if (step === 'home') return { state, effects }; // the first card has no Back
        return { state: enter({ ...state, resume: null }, previousStep(step, state.loggedIn), effects), effects };
      }
      if (button === 'rules') {
        // Owner 10-06: "Open the rules" only opens the Rules tab (the runtime clicked it); Next then shows My Squads.
        return { state, effects };
      }
      if (step === 'login') return { state, effects }; // no Next: it advances on the logged-in page load
      if (step === 'overview') {
        // The last site step: done; the client walkthrough (main webview) follows and ends on the disclaimer.
        effects.push({ kind: 'clear' }, { kind: 'seen' }, { kind: 'handoff' });
        return { state: { ...state, step: 'done' }, effects };
      }
      return { state: enter(state, nextStep(step), effects), effects };
    }
  }
  return { state, effects };
}

/** The exact call string fumbbl_home_tour accepts (the shell re-validates and re-serialises it). */
export function tourCall(fn: 'show' | 'clear' | 'arm', arg: unknown = {}): string {
  return `window.__sfTour.${fn}(${JSON.stringify(arg)})`;
}
