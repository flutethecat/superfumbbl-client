import { ref, shallowRef, watch, type Ref } from 'vue';
import { fetchFumbblCoachProfile, type CoachProfileFetch, type FumbblCoachProfile } from './fumbblCoachProfile';
import { FUMBBL_WS_URL } from './settings';
import { patchCoachGameOpponentCr, type CoachOpponentCr } from './coachGameHistory';

/**
 * Game-load rank panel (owner 10-20: "a small panel like this appear at game load showing both your local rank panel
 * and the opposing coach's"). Modern view only (SpectateView.vue mounts it; Classic untouched).
 *
 * - Once per game load, as soon as the game MODEL is known (owner 10-21: "load the elements and sprites behind this
 *   pane" - the view covers the pitch until the renderer reports ready; nothing waits on the bar), unless the store is
 *   fast-forwarding (catch-up skips every splash - store.ts "fast-forward: skip the splash"); a load that starts in
 *   catch-up shows it when the catch-up ends, if the first interactive phase has not surfaced yet. The key is
 *   the mode + gameId and is remembered for the session, so a reconnect to the same game, a replay seek, or a
 *   catch-up pass never re-shows it. Event splashes do not re-fire for past events on a reconnect either.
 * - Sides: home left / away right; on a coach seat the LOCAL coach is on the left and the opponent on the right.
 * - Only for a game from the official FUMBBL server (lookupAllowed: the live/spectate connect URL or the server-replay
 *   URL is FUMBBL's game server; file replays, demo and fork/test servers get name + team only, zero requests).
 * - Data: fetchFumbblCoachProfile for both coach names (the same module and session cache as the Play screen coach
 *   card, so the local coach's data is reused): at most 6 fumbbl.com requests per game load, 3 when one coach is
 *   already cached, 0 when both are; no per-game or per-team pulls, no polling. Fail-soft per coach: name + team only.
 * - Persistence (owner 10-21: "persist this screen until the inducement panel loads"): it stays up until the FIRST
 *   interactive phase surfaces - `phaseToken()` turns non-empty: durable model evidence that the game has left its
 *   start-game phase (any turn mode past startGame - setup, every kick-off sub-phase, play -, a turn begun on either
 *   side, the second half; a replay at its first position excepted), the inducement phase, any server dialog to either
 *   coach (FFB's startGame handshake excepted), or a turn start. It only shows while that token is still empty, so a
 *   mid-game join on a COACH SEAT never shows it.
 * - Spectate and replay (owner 10-21: "Can we actually bring the coach skill panel with winrate/war/etc up at the start
 *   of a spectated match and replay? I actually liked having that."): a spectator join (running game or not) and a
 *   replay (connectReplay download or a local file, at any start position) ALWAYS show it, whatever the phase
 *   evidence says, and hold it `holdMs()` (presentationMs(6000)) from the first board paint, or until a click / key;
 *   the phase token never ends it (Astra r2). The 20 s backstop runs from the game's model arrival and is never
 *   restarted for these modes - not by the paint, a catch-up pause or a resume (the hold takes only what is left of
 *   it; a resume keeps the hold's own end too). Same once-per-key rule: no re-show on a reconnect, a remount or a
 *   later seek; an explicit leave (store.leaveGame) makes the game eligible again (Astra r1).
 * - Never a latch (LATCHES FAIL OPEN): nothing waits on it. pointer-events: none; a click or key press anywhere
 *   dismisses it (the event still reaches the board); a flat 20 s wall-clock backstop `durationMs()` clears it
 *   regardless - also when the renderer never reports ready.
 */

export interface RankPanelTeam { coach: string; team: string; /** the server's race name (the banner's crest) */ race?: string }
export interface RankPanelSide extends RankPanelTeam { side: 'home' | 'away'; profile: FumbblCoachProfile | null }
export interface RankPanelState { key: string; seq: number; left: RankPanelSide; right: RankPanelSide }

export interface GameLoadRankPanelDeps {
  /** e.g. `live:1954978`; null while no game is loaded */
  gameKey: () => string | null;
  teams: () => { home: RankPanelTeam; away: RankPanelTeam } | null;
  mySeat: () => 'home' | 'away' | null;
  /** non-empty once the first interactive phase has surfaced (inducements, kick-off setup, a server dialog, a turn
   *  start): the bar clears, and never shows while it is non-empty (owner 10-21) */
  phaseToken: () => string;
  /** the renderer has reported ready (the view's rendererReady > 0); before it, a seek does not finish the bar */
  boardReady?: () => boolean;
  catchingUp: () => boolean;
  /** a reactive counter that changes on every catch-up start / end and replay seek (store.catchUpSignal) */
  catchUpSignal: () => number;
  /** true while a decision card addressed to THIS client's coach is up (store.localDecisionCardOpen - the same state
   *  the yes/no, chooser and prompt cards render from): the panel (z 55, above the toast tiers) PAUSES so it never
   *  covers a card that needs an answer, and resumes when it closes (owner 10-21, Astra r1) */
  inputPending: () => boolean;
  /** true from the end-game's first phase (endGame.phase !== 'idle'): the panel never shows over the end-game
   *  surfaces (the MVP pane shares z 55) and marks nothing (Astra r1) */
  endGameActive: () => boolean;
  fetchFn: () => CoachProfileFetch;
  /** true only when this game verifiably comes from the official FUMBBL server (see officialFumbblGameServer) */
  lookupAllowed: () => boolean;
  /** owner 11-04 (Sol r1 P2): the played server's identity (store.playedServerId), read when a lookup starts; absent =
   *  no opponent CR is remembered */
  serverId?: () => string | null;
  durationMs: () => number;
  /** spectate / replay only: the hold from the first board paint (the view's presentationMs(6000); default 6000) */
  holdMs?: () => number;
  /** session memory of shown game keys (defaults to the module-level set) */
  shown?: Set<string>;
  /** where click / key dismissal is listened for (defaults to window) */
  target?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> | null;
}

const sessionShown = new Set<string>();
/** Owner 11-04 (Coach Stats "Win rate vs coach rating"): the opponent's FUMBBL CR as the rank bar's OWN lookup returned
 *  it, for a game this client PLAYS (`live:` key: the opponent is on the right). Keyed by gameId for the session; the
 *  history record of that game reads it (store.ts). No request of its own: only what the bar already fetched. */
const opponentCrs = new Map<string, CoachOpponentCr>();
const crKey = (serverId: string, gameId: unknown) => `${serverId}|${String(gameId ?? '')}`;
/** Sol r1 P2: keyed by the played server's identity (the record's `serverId`) AND the gameId. */
export function rankPanelOpponentCr(serverId: string, gameId: unknown): CoachOpponentCr | null {
  return opponentCrs.get(crKey(serverId, gameId)) ?? null;
}
/** Test seam. */
export function clearRankPanelOpponentCrs(): void { opponentCrs.clear(); }
/** Bumped by every explicit leave: a panel created before it never marks its game afterwards. */
let leaveGeneration = 0;
/** Test seam: forget which games showed the panel this session. */
export function resetGameLoadRankPanelSession(): void { sessionShown.clear(); leaveGeneration++; }
/** An explicit leave (store.leaveGame - not a disconnect / reconnect / seek): the game may show its bar again on a
 *  later join this session (Astra r1). */
export function forgetGameLoadRankPanelGame(gameId: unknown): void {
  leaveGeneration++;
  for (const mode of ['live', 'spectate', 'replay'] as const) {
    const key = gameLoadRankPanelKey(mode, gameId);
    if (key) sessionShown.delete(key);
  }
}

export function gameLoadRankPanelKey(mode: 'live' | 'spectate' | 'replay', gameId: unknown): string | null {
  const id = typeof gameId === 'number' || typeof gameId === 'string' ? String(gameId).trim() : '';
  return id && id !== '0' ? `${mode}:${id}` : null;
}

/** The model fields the phase evidence reads. */
interface RankPanelGame {
  dialogParameter?: { dialogId?: unknown } | null;
  turnMode?: unknown;
  half?: number;
  turnDataHome?: { turnNr?: number } | null;
  turnDataAway?: { turnNr?: number } | null;
}

/** The store's phase evidence plus the view's own inducement pane mount condition (SpectateView `inducePhaseOpen`:
 *  the live buy / reveal for either seat, the underdog reveal hold, preset / replay review) - owner 10-21: the bar
 *  clears the moment the inducement pane shows. */
export function rankPanelPhaseToken(store: () => string, view: { inducementPaneOpen: () => boolean }): string {
  return [store(), view.inducementPaneOpen() ? 'inducement-pane' : ''].filter(Boolean).join('|');
}

/** The block / multi-block cards' own ownership (SpectateView's blockDialogMine / multiBlockDialogMine) on top of the
 *  store's local decision cards (Astra r2): the panel pauses exactly when a card addressed to this coach is up. */
export function rankPanelInputPending(
  store: Pick<RankPanelStore, 'localDecisionCardOpen'> & { state: { blockPartial?: unknown; multiBlockResolution?: unknown } },
  view: { blockDialogMine: () => boolean; multiBlockDialogMine: () => boolean },
): boolean {
  return store.localDecisionCardOpen()
    || (!!store.state.blockPartial && view.blockDialogMine())
    || (!!store.state.multiBlockResolution && view.multiBlockDialogMine());
}

/** The store half of the deps, shared by SpectateView and its tests (the store is passed in, not imported). */
export interface RankPanelStore {
  game: { value: unknown };
  isPlaying: { value: boolean };
  mySeat: { value: 'home' | 'away' | null };
  isPlaybackCatchingUp: () => boolean;
  catchUpSignal: { value: number };
  /** the game server this game came from (live / spectate connect URL, server-replay URL); null for file replays / demo */
  gameServerUrl: () => string | null;
  /** owner 11-04: the identity a played game's history record stores (store.playedServerId) */
  playedServerId?: () => string;
  /** a decision card addressed to the local coach is on screen (store.ts localDecisionCardOpen) */
  localDecisionCardOpen: () => boolean;
  replay: { active: boolean; status?: { cursor?: number } };
  state: {
    endGame: { phase: string };
    turnStart: { seq: number } | null;
    inducementBuy: unknown;
    inducementReveal: unknown;
    inducementOwnDialogPending?: boolean;
  };
}

/** The official FUMBBL game server - the host of FUMBBL_WS_URL, the URL the 'fumbbl' server target connects to. */
export function officialFumbblGameServer(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url).hostname.toLowerCase() === new URL(FUMBBL_WS_URL).hostname.toLowerCase();
  } catch {
    return false;
  }
}
export function storeRankPanelDeps(store: RankPanelStore): Pick<GameLoadRankPanelDeps, 'gameKey' | 'teams' | 'mySeat' | 'catchingUp' | 'catchUpSignal' | 'inputPending' | 'endGameActive' | 'phaseToken' | 'lookupAllowed' | 'serverId'> {
  type Team = { coach?: unknown; teamName?: unknown; race?: unknown } | undefined;
  const text = (v: unknown): string => (typeof v === 'string' ? v : '');
  return {
    gameKey: () => gameLoadRankPanelKey(store.replay.active ? 'replay' : store.isPlaying.value ? 'live' : 'spectate',
      (store.game.value as { gameId?: unknown } | null)?.gameId),
    teams: () => {
      const g = store.game.value as { teamHome?: Team; teamAway?: Team } | null;
      if (!g?.teamHome || !g.teamAway) return null;
      return {
        home: { coach: text(g.teamHome.coach), team: text(g.teamHome.teamName), race: text(g.teamHome.race) },
        away: { coach: text(g.teamAway.coach), team: text(g.teamAway.teamName), race: text(g.teamAway.race) },
      };
    },
    mySeat: () => store.mySeat.value,
    catchingUp: () => store.isPlaybackCatchingUp(),
    catchUpSignal: () => store.catchUpSignal.value,
    inputPending: () => store.localDecisionCardOpen(),
    endGameActive: () => store.state.endGame.phase !== 'idle',
    phaseToken: () => {
      const g = store.game.value as RankPanelGame | null;
      const parts: string[] = [];
      // Astra r2: DURABLE evidence from the model first (a transient splash resets and is skipped in catch-up): the game
      // has left its start-game phase (setup, any kick-off sub-phase - kickoff, highKick, quickSnap, solidDefence,
      // touchback, blitz, kickoffReturn, passBlock, swarming ... - regular play), a turn has begun on either side, or the
      // second half is on. A replay at its first position keeps the bar (owner: "at the front of replays").
      const atReplayStart = store.replay.active && (store.replay.status?.cursor ?? 0) === 0;
      if (g && !atReplayStart) {
        const mode = typeof g.turnMode === 'string' ? g.turnMode : '';
        if (mode && mode !== 'startGame') parts.push(`mode:${mode}`);
        if ((g.turnDataHome?.turnNr ?? 0) > 0 || (g.turnDataAway?.turnNr ?? 0) > 0) parts.push('turn-begun');
        if ((g.half ?? 1) > 1) parts.push(`half:${g.half}`);
      }
      // the inducement phase as the store presents it to every seat: my live buy, the reveal / the opponent's leg
      // (read-only), and the evidence that the phase opened while my own dialog is still to come
      if (store.state.inducementBuy || store.state.inducementReveal || store.state.inducementOwnDialogPending) parts.push('inducements');
      // FFB's start-game handshake (dialogId startGame, the model's state before anything is played - a replay's
      // cursor 0 carries it) is not an interactive phase; every other dialog, to either coach, is.
      const dialogId = String(g?.dialogParameter?.dialogId ?? '');
      if (g?.dialogParameter && dialogId !== 'startGame') parts.push(`dialog:${dialogId || '?'}`);
      if (store.state.turnStart) parts.push(`turn:${store.state.turnStart.seq}`);
      return parts.join('|');
    },
    lookupAllowed: () => officialFumbblGameServer(store.gameServerUrl()),
    serverId: () => store.playedServerId?.() ?? null,
  };
}

export function useGameLoadRankPanel(deps: GameLoadRankPanelDeps): {
  panel: Ref<RankPanelState | null>;
  dismiss: () => void;
  stop: () => void;
  /** DEV preview (the view exposes it only under import.meta.env.DEV): show this game's bar now, as if the first
   *  interactive phase had not surfaced; then the normal lifecycle (timer, click / key, a NEW phase, a game change). */
  preview: () => void;
} {
  const shown = deps.shown ?? sessionShown;
  const target = deps.target === undefined ? (typeof window !== 'undefined' ? window : null) : deps.target;
  /** What is on screen (null while paused or gone). */
  const panel = shallowRef<RankPanelState | null>(null);
  const seq = ref(0);
  /** The game's panel while it is showing OR paused behind a decision card. */
  let current: RankPanelState | null = null;
  let paused = false;
  let timer: ReturnType<typeof setTimeout> | 0 = 0;
  let listening = false;
  let lastKey: string | null | undefined;
  let lastSignal = deps.catchUpSignal();
  /** the phase token when a DEV preview started: only a different token ends the preview */
  let previewToken: string | null = null;
  let sawCatchUp = false;
  /** the current panel's game is spectated / replayed: the hold rule, not the phase rule (owner 10-21) */
  let currentHeld = false;
  /** the spectate / replay hold has started (the board has painted) */
  let holdArmed = false;
  /** live: wall-clock end of the current display's backstop (a resume restarts it, as before) */
  let deadline = 0;
  /** spectate / replay: when this game's model arrived - the backstop's fixed start (Astra r2) */
  let keyArrivedAt = 0;
  /** spectate / replay: when this game's board first painted (0 = not yet) - recorded whenever it happens, inside a
   *  catch-up or a pause too; the hold always ends holdMs after it (Astra r3) */
  let firstPaintAt = 0;
  function notePaint(): void { if (!firstPaintAt && boardReady()) firstPaintAt = Date.now(); }
  /** the leave generation the current panel was created in */
  let currentGeneration = leaveGeneration;
  const boardReady = (): boolean => deps.boardReady?.() ?? true;
  const heldMode = (key: string | null): boolean => !!key && (key.startsWith('spectate:') || key.startsWith('replay:'));

  const onInput = (): void => finish();
  function listen(on: boolean): void {
    if (!target || on === listening) return;
    listening = on;
    for (const type of ['pointerdown', 'keydown'] as const) {
      if (on) target.addEventListener(type, onInput, { capture: true, passive: true } as AddEventListenerOptions);
      else target.removeEventListener(type, onInput, { capture: true } as EventListenerOptions);
    }
  }
  function hide(): void {
    if (timer) { clearTimeout(timer); timer = 0; }
    listen(false);
    panel.value = null;
  }
  function display(): void {
    if (!current) return;
    paused = false;
    panel.value = current;
    listen(true);
    if (timer) clearTimeout(timer);
    const backstop = Math.max(0, deps.durationMs());
    if (!currentHeld) {
      deadline = Date.now() + backstop;
      timer = setTimeout(finish, backstop);
      return;
    }
    holdArmed = false;
    schedule();
  }
  /** Spectate / replay: finish at the earlier of the fixed backstop (model arrival + durationMs) and the hold's end,
   *  starting the hold at the first paint. Past the backstop the panel is done at once. */
  function schedule(): void {
    if (!current) return;
    const now = Date.now();
    notePaint();
    const holdEnd = firstPaintAt ? firstPaintAt + Math.max(0, deps.holdMs?.() ?? 6000) : 0;
    holdArmed = holdEnd > 0;
    const end = Math.min(keyArrivedAt + Math.max(0, deps.durationMs()), holdEnd || Infinity);
    if (timer) { clearTimeout(timer); timer = 0; }
    if (end <= now) { finish(); return; }
    timer = setTimeout(finish, end - now);
  }
  /** Spectate / replay: the board has painted behind the bar - the hold starts now (the backstop never extends it). */
  function armHold(): void {
    if (!current || paused || !currentHeld || holdArmed || !boardReady()) return;
    schedule();
  }
  /** The panel is DONE for its game - a timer expiry, a click / key, a game change, a catch-up / seek, the view going
   *  away. Only these mark the game shown (Astra r1). */
  function finish(): void {
    previewToken = null;
    if (current && currentGeneration === leaveGeneration) shown.add(current.key);
    current = null;
    paused = false;
    holdArmed = false;
    hide();
  }
  /** A decision card for this coach: hide but keep the game's panel; it shows again, for a fresh duration, once the
   *  card closes. Nothing is marked. */
  function pause(): void {
    if (!current || paused) return;
    paused = true;
    hide();
  }
  /** The end-game: drop the panel WITHOUT marking the game (Astra r1: mark nothing). */
  function drop(): void {
    current = null;
    paused = false;
    holdArmed = false;
    hide();
  }

  /** Astra r2: a coach name that arrives AFTER the panel was created (a fork lobby / listed game names the opponent
   *  late) fills its side and starts that side's lookup, keyed by the same seq. */
  function refreshSides(panelState: RankPanelState): void {
    const teams = deps.teams();
    if (!teams) return;
    const awayLeft = panelState.left.side === 'away';
    let next = panelState;
    const started: ('left' | 'right')[] = [];
    for (const which of ['left', 'right'] as const) {
      const team = (which === 'left') === awayLeft ? teams.away : teams.home;
      const s = next[which];
      const coach = team.coach.trim();
      const teamName = team.team.trim();
      const race = team.race?.trim() || undefined;
      if (coach === s.coach && teamName === s.team && race === s.race) continue;
      next = { ...next, [which]: { ...s, coach, team: teamName, race, profile: coach === s.coach ? s.profile : null } };
      if (coach && coach !== s.coach) started.push(which);
    }
    if (next === panelState) return;
    current = next;
    if (!paused) panel.value = current;
    for (const which of started) lookup(which, current.seq);
  }

  function lookup(which: 'left' | 'right', mySeq: number): void {
    // Astra r3 (P2): a FUMBBL lookup only for a game verified to come from the official FUMBBL server (a fork / test
    // server's coach names are not FUMBBL accounts - a namesake's rank must never show). Otherwise name + team only.
    if (!current || !deps.lookupAllowed()) return;
    const name = current[which].coach;
    if (!name) return;
    const key = current.key;
    const serverId = key.startsWith('live:') && which === 'right' ? deps.serverId?.() ?? null : null;
    void fetchFumbblCoachProfile(name, deps.fetchFn()).then((profile) => {
      // owner 11-04: a game I play remembers the opponent's CR for its history record (even if the bar has moved on),
      // keyed by server + game (Sol r1 P2); a record already written without it (the game ended before this answer)
      // gets ONLY its opponentCr patched in (Sol r1 P3). No request beyond this lookup.
      if (serverId && typeof profile?.cr === 'number' && Number.isFinite(profile.cr)) {
        const found: CoachOpponentCr = { serverId, gameId: key.slice('live:'.length), coach: name, cr: profile.cr };
        opponentCrs.set(crKey(serverId, found.gameId), found);
        void patchCoachGameOpponentCr(found);
      }
      if (!current || current.seq !== mySeq || current[which].coach !== name) return;
      current = { ...current, [which]: { ...current[which], profile } };
      if (!paused) panel.value = current;
    });
  }

  function side(which: 'home' | 'away', team: RankPanelTeam): RankPanelSide {
    return { side: which, coach: team.coach.trim(), team: team.team.trim(), race: team.race?.trim() || undefined, profile: null };
  }

  function update(): void {
    const key = deps.gameKey();
    // Astra r3 (P2): a panel belongs to ONE game. Any key change - a reset (null), a switch to another game (seen
    // before or not) - finishes the old game's panel BEFORE the early returns below.
    if (key !== lastKey) {
      lastKey = key;
      finish();
      // Astra r3 ruling: counted from controller mount when the model arrived earlier (App.vue delays the match view
      // for the art pack) - the backstop guards a MOUNTED pitch; before the mount nothing is covered.
      keyArrivedAt = Date.now();
      firstPaintAt = 0;
    }
    notePaint();
    // A replay seek / an instant same-game fast-forward finishes it (Astra r4: never a re-show on a seek) - seen
    // through the store's reactive signal, since a synchronous seek restores the flag before this runs. A catch-up
    // this watcher SEES running (a join's fast-forward) only hides it: it waits, and comes back when the catch-up ends
    // if the first interactive phase has not surfaced meanwhile (owner 10-21).
    const catching = deps.catchingUp();
    const signal = deps.catchUpSignal();
    if (signal !== lastSignal) {
      lastSignal = signal;
      // ...except while the board is still loading behind the bar: a replay opened at a later position (a resume)
      // seeks before its first paint, and the bar is still the load cover then.
      if (!catching && !sawCatchUp && (deps.boardReady?.() ?? true)) finish();
    }
    sawCatchUp = catching;
    // Never over the end-game surfaces (the MVP pane shares z 55 and mounts earlier); nothing is marked.
    if (deps.endGameActive()) { drop(); return; }
    if (catching) { pause(); return; }
    // The first interactive phase has surfaced: the bar's job is done (and it never shows once it has). A DEV preview
    // runs as if the token it started on were empty.
    const token = deps.phaseToken();
    // Spectate / replay (owner 10-21, Astra r2): the token never prevents nor ends the bar - only the hold, a click /
    // key, a seek or the backstop do. A coach seat keeps the phase rule exactly.
    const held = current ? currentHeld : heldMode(key);
    if (token && !(previewToken !== null && current && token === previewToken)) {
      if (!held) { finish(); if (key && !shown.has(key)) shown.add(key); return; }
    }
    // A decision card for this coach: pause (a panel not yet shown waits); it resumes when the card closes.
    if (deps.inputPending()) { pause(); return; }
    if (current) {
      refreshSides(current);
      if (paused) display();
      else armHold();
      return;
    }
    if (!key || shown.has(key)) return;
    currentHeld = heldMode(key);
    currentGeneration = leaveGeneration;
    create(key);
  }

  function create(key: string): boolean {
    const teams = deps.teams();
    if (!teams || (!teams.home.coach.trim() && !teams.away.coach.trim())) return false;
    const awayLeft = deps.mySeat() === 'away';
    const left = side(awayLeft ? 'away' : 'home', awayLeft ? teams.away : teams.home);
    const right = side(awayLeft ? 'home' : 'away', awayLeft ? teams.home : teams.away);
    const mySeq = ++seq.value;
    current = { key, seq: mySeq, left, right };
    display();
    lookup('left', mySeq);
    lookup('right', mySeq);
    return true;
  }

  function preview(): void {
    const key = deps.gameKey();
    if (!key) return;
    finish();
    shown.delete(key);
    currentHeld = heldMode(key);
    currentGeneration = leaveGeneration;
    keyArrivedAt = Date.now();
    firstPaintAt = 0;
    notePaint();
    if (create(key)) previewToken = deps.phaseToken();
  }

  const stopWatch = watch(
    () => [deps.gameKey(), deps.catchUpSignal(), deps.phaseToken(), deps.inputPending(), deps.endGameActive(), boardReady(),
      deps.teams()?.home.coach, deps.teams()?.away.coach, deps.teams()?.home.team, deps.teams()?.away.team],
    update,
    { immediate: true },
  );
  return { panel, dismiss: finish, stop: () => { stopWatch(); finish(); }, preview };
}
