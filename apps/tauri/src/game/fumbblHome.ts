/**
 * Owner 2026-10-05: the Home blade - the FUMBBL website docked in the main window.
 *
 * In every edition since the owner's 10-06 decision (the shell's `fumbbl-home` cargo feature is a default feature).
 *
 * fumbbl.com refuses framing, so the shell owns a native CHILD WEBVIEW (src-tauri/src/fumbbl_home.rs) that this page
 * positions over the pane. A native surface draws ABOVE all of our HTML, so the page must hide it whenever the pane is
 * not on screen or anything of ours would draw over that area. The rule here is generic rather than a list of dialogs:
 * the site shows only while the pane's own element is the topmost element at every probe point AND no overlay-shaped
 * element (dialog, menu, toast, splash...) intersects the pane. Anything that fails either test hides it.
 *
 * Owner 2026-10-08: the same webview can also be hosted by the floating FUMBBL window (components/FumbblFloat.vue), so
 * the site (and a Gamefinder queue in it) stays open while the user watches a game or a replay. One driver below
 * (`homeSurface`) owns every show / hide for whichever of the two is the current host.
 */
import { reactive } from 'vue';
import { ui } from './ui';

export interface PaneRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type HomeShellState = 'available' | 'needs-installer' | 'not-tauri';

/** What the shell is told. `bounds` are logical (CSS) pixels relative to the main window's client area. */
export type HomeDesired = { visible: false } | { visible: true; bounds: PaneRect };

/** Overlay-shaped elements. Covers pointer-events:none surfaces that a hit test cannot see. */
export const OVERLAY_SELECTOR = [
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[aria-modal="true"]',
  '[role="menu"]',
  '[role="listbox"]',
  '[role="tooltip"]',
  '[role="alert"]',
  '[role="status"]',
  '.modal-backdrop',
  '.launch-splash',
].join(',');

/** Fixtures of ours that permanently sit at the pane's edge and are fine to be covered by the site while Home shows. */
export const IGNORED_DECORATION_SELECTOR = '.corner-stamp';

/** Probe grid per axis (plus the inset corners). 6x6 = 36 hit tests per check - negligible. */
const PROBE_STEPS = 6;
const PROBE_INSET = 3;
/** An element smaller than this (e.g. a visually-hidden live region) is not drawing over anything. */
const MIN_OVERLAY_EDGE = 4;

export interface ProbeDocument {
  elementFromPoint(x: number, y: number): Element | null;
  querySelectorAll(selector: string): ArrayLike<Element>;
}

export type StyleReader = (element: Element) =>
  Pick<CSSStyleDeclaration, 'display' | 'visibility' | 'opacity'> & { pointerEvents?: string };

/** Owner 10-08 (the floating FUMBBL window). The docked pane passes none of these. */
export interface OcclusionOptions {
  /** The host's own frame (header, resize strip, outline). Nothing inside it ever counts as covering the host. */
  frame?: Element | null;
  /** Hit-test PASSIVE overlay-shaped elements (live regions, tooltips) that can be hit-tested, instead of taking every
   *  intersecting one as covering. The floating window sits over the match HUD, whose live regions (role="status"
   *  turn indicators and the like) lie UNDER it: those must not hide the site. One a hit test cannot see
   *  (pointer-events: none) still counts, and so does every dialog, menu or splash, wherever it is stacked - the site
   *  always gives way to those. */
  refineOverlays?: boolean;
}

/** The overlay shapes that only announce or annotate; the rest of OVERLAY_SELECTOR asks for the user's attention. */
export const PASSIVE_OVERLAY_SELECTOR = '[role="status"], [role="alert"], [role="tooltip"]';
const MODAL_OVERLAY_SELECTOR = '[role="dialog"], [role="alertdialog"], [aria-modal="true"], [role="menu"], [role="listbox"], .modal-backdrop, .launch-splash';

function isPassiveOverlay(element: Element): boolean {
  return typeof element.matches === 'function' && element.matches(PASSIVE_OVERLAY_SELECTOR) && !element.matches(MODAL_OVERLAY_SELECTOR);
}

function intersects(a: PaneRect, b: PaneRect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function isIgnored(element: Element): boolean {
  return typeof element.closest === 'function' && element.closest(IGNORED_DECORATION_SELECTOR) !== null;
}

/** Points across the pane, inset so a border pixel shared with a neighbour never decides it. */
export function probePoints(rect: PaneRect): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  const x0 = rect.x + PROBE_INSET;
  const y0 = rect.y + PROBE_INSET;
  const w = Math.max(0, rect.width - 2 * PROBE_INSET);
  const h = Math.max(0, rect.height - 2 * PROBE_INSET);
  for (let i = 0; i <= PROBE_STEPS; i += 1) {
    for (let j = 0; j <= PROBE_STEPS; j += 1) {
      points.push([x0 + (w * i) / PROBE_STEPS, y0 + (h * j) / PROBE_STEPS]);
    }
  }
  return points;
}

/** Points inside the part of an overlay that lies over the host: its centre and its four inset corners. */
function overlapPoints(rect: PaneRect, box: PaneRect): Array<[number, number]> {
  const left = Math.max(rect.x, box.x);
  const top = Math.max(rect.y, box.y);
  const right = Math.min(rect.x + rect.width, box.x + box.width);
  const bottom = Math.min(rect.y + rect.height, box.y + box.height);
  const dx = Math.min(1, (right - left) / 2);
  const dy = Math.min(1, (bottom - top) / 2);
  return [
    [(left + right) / 2, (top + bottom) / 2],
    [left + dx, top + dy],
    [right - dx, top + dy],
    [left + dx, bottom - dy],
    [right - dx, bottom - dy],
  ];
}

/** True when anything of ours draws over (part of) the pane. `host` is the pane's own element. */
export function isPaneOccluded(
  host: Element, rect: PaneRect, doc: ProbeDocument, style: StyleReader, options: OcclusionOptions = {},
): boolean {
  const frame = options.frame ?? null;
  const own = (element: Element) => element === host || host.contains(element) || (frame !== null && frame.contains(element));
  for (const [x, y] of probePoints(rect)) {
    const top = doc.elementFromPoint(x, y);
    if (!top) return true; // outside the viewport: part of the pane is off screen
    if (own(top)) continue;
    if (isIgnored(top)) continue;
    return true;
  }
  const overlays = doc.querySelectorAll(OVERLAY_SELECTOR);
  for (let index = 0; index < overlays.length; index += 1) {
    const element = overlays[index]!;
    if (own(element) || isIgnored(element)) continue;
    const box = element.getBoundingClientRect();
    if (box.width < MIN_OVERLAY_EDGE || box.height < MIN_OVERLAY_EDGE) continue;
    const css = style(element);
    if (css.display === 'none' || css.visibility === 'hidden' || Number(css.opacity) === 0) continue;
    const overlay = { x: box.left, y: box.top, width: box.width, height: box.height };
    if (!intersects(rect, overlay)) continue;
    if (options.refineOverlays && isPassiveOverlay(element) && css.pointerEvents !== undefined && css.pointerEvents !== 'none') {
      // It can be hit-tested: if the host is what a hit test finds everywhere over it, it lies beneath the host.
      const beneath = overlapPoints(rect, overlay).every(([x, y]) => {
        const top = doc.elementFromPoint(x, y);
        return top !== null && own(top);
      });
      if (beneath) continue;
    }
    return true;
  }
  return false;
}

export interface DesiredInput {
  /** The shell reported the Home commands. */
  shell: HomeShellState;
  /** The pane is mounted and the user has not hit a creation failure. */
  active: boolean;
  documentVisible: boolean;
  rect: PaneRect | null;
  occluded: boolean;
}

export function desiredHomeState(input: DesiredInput): HomeDesired {
  const { rect } = input;
  if (input.shell !== 'available' || !input.active || !input.documentVisible || input.occluded || !rect) {
    return { visible: false };
  }
  if (!(rect.width >= 1 && rect.height >= 1)) return { visible: false };
  return {
    visible: true,
    bounds: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
  };
}

export function sameDesired(a: HomeDesired | null, b: HomeDesired): boolean {
  if (!a || a.visible !== b.visible) return false;
  if (!a.visible || !b.visible) return true;
  const p = a.bounds;
  const q = b.bounds;
  return p.x === q.x && p.y === q.y && p.width === q.width && p.height === q.height;
}

function inTauri(): boolean {
  return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
}

/** Feature detection. An older shell has no `fumbbl_home_available` command (invoke rejects); a shell built without the
 *  `fumbbl-home` feature answers false. Both read as "needs the latest installer"; neither ever throws. */
export async function detectHomeShell(): Promise<HomeShellState> {
  if (!inTauri()) return 'not-tauri';
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return (await invoke<boolean>('fumbbl_home_available')) === true ? 'available' : 'needs-installer';
  } catch {
    return 'needs-installer';
  }
}

/** The shell's error (and the event it emits) when its navigation loop guard stopped the pane: the site kept leaving
 *  fumbbl.com (src-tauri/src/fumbbl_home.rs BLOCKED_ERROR). The webview is blanked and hidden; only a show with
 *  `retry` (the user's "Try again") starts it again. */
export const HOME_BLOCKED = 'fumbbl-home-blocked';

export function isHomeBlockedError(error: unknown): boolean {
  const text = typeof error === 'string' ? error : error instanceof Error ? error.message : '';
  return text.includes(HOME_BLOCKED);
}

export async function sendHomeState(desired: HomeDesired, options: { retry?: boolean } = {}): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  if (desired.visible) {
    await invoke('fumbbl_home_show', options.retry ? { bounds: desired.bounds, retry: true } : { bounds: desired.bounds });
  } else {
    await invoke('fumbbl_home_hide');
  }
}

/** Best-effort hide that never throws (unmount, page hide). */
export function hideHomeQuietly(): void {
  if (!inTauri()) return;
  void import('@tauri-apps/api/core')
    .then(({ invoke }) => invoke('fumbbl_home_hide'))
    .catch(() => undefined);
}

export const FUMBBL_HOME_URL = 'https://fumbbl.com/';

/**
 * Owner 10-09: PARK the site - the coach dismissed the floating window, so the page must stop running (a hidden webview
 * is kept alive: a Gamefinder page left behind kept its queue and beeped). The shell hides the webview and unloads its
 * document (fumbbl_home_park: about:blank, no request to FUMBBL); the login survives and the next show loads the site
 * afresh. This is the page being closed, exactly as closing a browser tab would - nothing on it is clicked or sent.
 *
 * An OLDER SHELL has no such command: the best it can do is hide the site and load FUMBBL's front page in it (the
 * existing fumbbl_home_navigate only takes fumbbl.com URLs) - one ordinary page load, which ends the Gamefinder page's
 * scripts and sounds. Never throws.
 */
export async function sendHomePark(): Promise<void> {
  if (!inTauri()) return;
  const { invoke } = await ipc();
  try {
    await invoke('fumbbl_home_park');
    return;
  } catch {
    /* an older shell: fall through */
  }
  try {
    await invoke('fumbbl_home_hide');
    await invoke('fumbbl_home_navigate', { url: FUMBBL_HOME_URL });
  } catch {
    /* no webview yet, or a stopped one: nothing is running to park */
  }
}

// --- the surface driver (owner 10-08: one webview, two possible hosts) ------------------------------------------------

/** Who is hosting the site: the FUMBBL.COM blade's pane, or the floating window (components/FumbblFloat.vue). */
export type HomeHostKind = 'pane' | 'float';

export interface HomeHostOptions extends OcclusionOptions {
  /** A further condition of this host (the pane: no client walkthrough; the float: not being moved or resized). */
  active?: () => boolean;
  /** Once per attach, as soon as the shell is known. Nothing is shown for this host until it has settled (the pane
   *  registers its walkthrough events here, before the first show). */
  onShell?: (shell: HomeShellState) => void | Promise<void>;
}

export interface HomeSurfaceState {
  shell: HomeShellState | 'detecting';
  /** Creation (or a bounds update) failed: nothing is shown until `retry`. */
  failed: boolean;
  /** The shell's loop guard stopped the site (it kept leaving fumbbl.com). Only `retryBlocked` restarts it. */
  blocked: boolean;
  /** The last thing the shell was told is "show". */
  showing: boolean;
  owner: HomeHostKind | null;
  /** The site was dismissed (park asked for) and nothing has taken it since: there is no page to show or to ask. */
  parked: boolean;
}

export interface HomeSurfaceDeps {
  detect(): Promise<HomeShellState>;
  send(desired: HomeDesired, options: { retry?: boolean }): Promise<void>;
  hideQuietly(): void;
  listen(event: string, handler: () => void): Promise<() => void>;
  /** Hide the site and unload its page (sendHomePark). */
  park(): Promise<void>;
  /** The shell hid the site on its own (a match launch was taken from the page). */
  onShellHidden(): void;
}

const defaultSurfaceDeps: HomeSurfaceDeps = {
  detect: () => detectHomeShell(),
  send: (desired, options) => sendHomeState(desired, options),
  hideQuietly: () => hideHomeQuietly(),
  park: () => sendHomePark(),
  listen: async (event, handler) => {
    const { listen } = await import('@tauri-apps/api/event');
    return listen(event, handler);
  },
  // A launch taken from the page ends the floating window at once, so nothing of it is in the way of the join. Whether
  // it comes back (the launch was a game to watch, or a replay) is App.vue's call once the launch has been routed.
  onShellHidden: () => {
    if (!ui.fumbblFloating) return;
    ui.fumbblFloating = false;
    ui.fumbblFloatHeldAt = Date.now();
  },
};

/** The shell's event after it hid the site itself (fumbbl_home.rs complete_jnlp). */
export const HOME_HIDDEN_EVENT = 'fumbbl-home-hidden';

interface HomeHost {
  kind: HomeHostKind;
  el: HTMLElement;
  options: HomeHostOptions;
}

/**
 * Drives the ONE shell webview for whichever element currently hosts it.
 *
 * There is exactly one current host. Every show, bounds update and hide goes through one serialized loop that works
 * out what the shell should be told at the moment it sends, so a host leaving and another arriving (pane -> float ->
 * pane) can never put a stale hide behind a newer show: a release only schedules a check, and the check sees the new
 * host. Nothing here creates, destroys or navigates the webview.
 */
export function createHomeSurface(overrides: Partial<HomeSurfaceDeps> = {}) {
  const deps: HomeSurfaceDeps = { ...defaultSurfaceDeps, ...overrides };
  const state = reactive<HomeSurfaceState>({ shell: 'detecting', failed: false, blocked: false, showing: false, owner: null, parked: false });

  let host: HomeHost | null = null;
  /** Bumped by every attach: an older attach's async start and release are ignored. */
  let generation = 0;
  let lastSent: HomeDesired | null = null;
  /** The next show carries `retry` so the shell resets its guard (Try again on the blocked notice). */
  let retryArmed = false;
  let sending = false;
  let resend = false;
  let frameQueued = false;
  let frame = 0;
  /** The shell's stop / hidden events are registered (or could not be): only then may anything show. */
  let listening = false;
  let listenStarted: Promise<void> | null = null;
  let detecting: Promise<HomeShellState> | null = null;
  let stopWatching: (() => void) | null = null;
  let resizeObserver: ResizeObserver | null = null;
  /** The site was dismissed: the next time nothing shows it, it is parked instead of merely hidden. */
  let parkWanted = false;

  function compute(): HomeDesired {
    const current = host;
    if (!current || state.shell !== 'available') return { visible: false };
    const box = current.el.getBoundingClientRect();
    const rect = { x: box.left, y: box.top, width: box.width, height: box.height };
    const occluded = isPaneOccluded(current.el, rect, document, (e) => getComputedStyle(e), current.options);
    return desiredHomeState({
      shell: 'available',
      active: !state.failed && !state.blocked && (current.options.active?.() ?? true),
      documentVisible: document.visibilityState !== 'hidden',
      rect,
      occluded,
    });
  }

  async function flush(): Promise<void> {
    if (sending) {
      resend = true;
      return;
    }
    sending = true;
    try {
      do {
        resend = false;
        let desired: HomeDesired;
        try {
          desired = compute();
        } catch {
          desired = { visible: false }; // cannot tell what is on screen: never show the site blind
        }
        if (parkWanted && !host) {
          // Only once NOTHING hosts the site (a host that is merely hidden - being moved, under a dialog - keeps its
          // page). In this loop, so it can never land behind a later show: a park is a hide that also unloads the page.
          parkWanted = false;
          let parked = true;
          try {
            await deps.park();
          } catch {
            parked = false;
          }
          if (!parked) {
            // Astra 10-09 (F4): a park that failed has hidden nothing as far as we know - send the hide itself, and
            // only record "hidden" when the shell took it (an unknown state is re-sent by the next check).
            try {
              await deps.send({ visible: false }, {});
            } catch {
              lastSent = null;
              state.showing = false;
              continue;
            }
          }
          lastSent = { visible: false };
          state.showing = false;
          continue;
        }
        if (sameDesired(lastSent, desired)) continue;
        try {
          const retry = desired.visible && retryArmed;
          await deps.send(desired, { retry });
          if (retry) retryArmed = false;
          lastSent = desired;
          state.showing = desired.visible;
        } catch (error) {
          if (desired.visible && isHomeBlockedError(error)) {
            markBlocked(); // the event was missed (or raced this show): same outcome
          } else if (desired.visible) {
            // Creation (or a bounds update) failed: stop trying and offer the browser instead of an empty area. The
            // loop runs once more and sends the hide itself (serialized, never a loose hide behind a later show).
            state.failed = true;
            state.showing = false;
            lastSent = null;
            resend = true;
          }
        }
      } while (resend);
    } finally {
      sending = false;
    }
  }

  function schedule(): void {
    if (frameQueued || !host || !listening || state.shell !== 'available') return;
    frameQueued = true;
    frame = requestAnimationFrame(() => {
      frameQueued = false;
      void flush();
    });
  }

  /** Forget what was last sent so the next check re-sends (the shell hid it on its own, or the DPI changed). */
  function invalidate(): void {
    lastSent = null;
    schedule();
  }

  /** The shell stopped the site: it already hid and blanked the webview; the host shows the notice. */
  function markBlocked(): void {
    state.blocked = true;
    retryArmed = false;
    state.showing = false;
    lastSent = null;
  }

  function onShellHidden(): void {
    state.showing = false;
    lastSent = null;
    deps.onShellHidden();
    // Re-check AFTER the page has reacted: a floating window that the launch just ended unmounts first (its release
    // does the final check), so a show is never sent for a host that is on its way out.
    queueMicrotask(schedule);
  }

  function listenOnce(): Promise<void> {
    // Registered once and kept: a host handing over to the other must never leave a gap in which the stop event
    // (fumbbl-home-blocked) or the shell's own hide could be missed.
    listenStarted ??= (async () => {
      try {
        await deps.listen(HOME_HIDDEN_EVENT, onShellHidden);
        await deps.listen(HOME_BLOCKED, markBlocked);
      } catch {
        /* the periodic check still runs; a stopped shell also refuses every show with the blocked error */
      }
      listening = true;
    })();
    return listenStarted;
  }

  function watchEnvironment(): () => void {
    let dprQuery: MediaQueryList | null = null;
    const onDprChange = () => { watchDpr(); invalidate(); };
    function watchDpr(): void {
      dprQuery?.removeEventListener('change', onDprChange);
      dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      dprQuery.addEventListener('change', onDprChange);
    }
    const onPageHide = () => deps.hideQuietly();
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', schedule);
    // Anything of ours appearing, moving or disappearing (dialogs, menus, toasts, splash, layout shifts).
    const mutationObserver = new MutationObserver(schedule);
    mutationObserver.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'open', 'aria-hidden', 'aria-modal', 'role'],
    });
    watchDpr();
    // Safety net for changes no observer reports (CSS transitions, position-only moves).
    const interval = window.setInterval(schedule, 250);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', schedule);
      mutationObserver.disconnect();
      dprQuery?.removeEventListener('change', onDprChange);
    };
  }

  function observeHost(el: HTMLElement | null): void {
    resizeObserver?.disconnect();
    resizeObserver = null;
    if (!el || typeof ResizeObserver === 'undefined') return;
    resizeObserver = new ResizeObserver(schedule);
    resizeObserver.observe(el);
  }

  async function start(token: number): Promise<void> {
    if (state.shell !== 'available') {
      state.shell = 'detecting';
      detecting ??= deps.detect().then((detected) => {
        detecting = null;
        state.shell = detected;
        return detected;
      });
      await detecting;
    }
    if (token !== generation || !host) return;
    const shell = state.shell === 'detecting' ? 'needs-installer' : state.shell;
    try {
      await host.options.onShell?.(shell);
    } catch {
      /* a host's own setup never decides whether the site shows */
    }
    if (token !== generation || !host || shell !== 'available') return;
    // Listeners BEFORE anything can send a show: the shell's stop event can follow the very first show (fumbbl.com
    // redirecting off-domain on creation) and must never be missed.
    await listenOnce();
    if (token !== generation || !host) return;
    schedule();
  }

  /** `el` becomes THE host (replacing any other). Returns its release; a stale release (another host has attached
   *  since) does nothing. */
  function attach(kind: HomeHostKind, el: HTMLElement, options: HomeHostOptions = {}): () => void {
    host = { kind, el, options };
    generation += 1;
    parkWanted = false; // a host taking the site is the site being wanted, not dismissed
    state.parked = false;
    const token = generation;
    state.owner = kind;
    if (kind === 'pane') {
      // Opening the blade is a fresh attempt, as it always was (a still-stopped shell refuses the show again).
      state.failed = false;
      state.blocked = false;
      retryArmed = false;
    }
    stopWatching ??= watchEnvironment();
    observeHost(el);
    void start(token);
    return () => {
      if (token !== generation || !host) return;
      host = null;
      state.owner = null;
      if (parkWanted) state.parked = true;
      observeHost(null);
      if (frameQueued) cancelAnimationFrame(frame);
      frameQueued = false;
      // Not a hide: a check, after the current tick. A blade switch unmounts one host and mounts the other in the
      // same tick; by the time this runs the new host is attached and the check keeps the site up at its bounds.
      queueMicrotask(() => {
        if (host) return;
        stopWatching?.();
        stopWatching = null;
        // No host: the site must never sit on top of what comes next.
        if (state.shell === 'available') void flush();
        else deps.hideQuietly();
      });
    };
  }

  function retry(): void {
    state.failed = false;
    invalidate();
  }

  function retryBlocked(): void {
    state.blocked = false;
    retryArmed = true;
    invalidate();
  }

  /**
   * Owner 10-09: the coach dismissed the site (the floating window's Close; their own match starting behind a floating
   * window). Once nothing hosts it, the page is unloaded, not just hidden - see sendHomePark. Asked BEFORE or after the
   * host lets go, in the same tick: the check runs after the current tick, when the host is gone. A host that attaches
   * meanwhile (the blade opened) cancels it - and a parked site is simply loaded again by its next show.
   */
  function park(): void {
    if (state.shell !== 'available') return;
    parkWanted = true;
    if (!host) state.parked = true; // dismissed as of now (a host that is still attached lets go in this same tick)
    queueMicrotask(() => { void flush(); });
  }

  return { state, attach, refresh: schedule, invalidate, retry, retryBlocked, park };
}

export type HomeSurface = ReturnType<typeof createHomeSurface>;

/** The app's one driver. */
export const homeSurface: HomeSurface = createHomeSurface();

// --- colorblind correction (owner 10-06: "Colorblind mode isn't being applied to this page") -------------------------

/** Best-effort: the shell remembers the filter and re-applies it after every page load (null = off). The filter comes
 *  from game/colorblindFilters.ts - the same matrices the client shell uses. */
export async function sendHomeFilter(filter: { id: string; matrix: string } | null): Promise<void> {
  if (!inTauri()) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('fumbbl_home_set_filter', { filter });
  } catch {
    /* an older shell without the command: the site stays unfiltered */
  }
}

/** The IPC module, loaded once for the zoom and the queue focus: the floating window sends both in the same tick
 *  (taking the site, giving it back), and one shared load keeps those calls in the order they were made. */
let ipcModule: Promise<typeof import('@tauri-apps/api/core')> | null = null;
function ipc(): Promise<typeof import('@tauri-apps/api/core')> {
  ipcModule ??= import('@tauri-apps/api/core');
  return ipcModule;
}

// --- zoom (owner 10-06: "Text can be a bit small for users in its current form") ------------------------------------

/** The Home pane's zoom slider: 75 %-200 % in 5 % steps (the shell clamps the same way: fumbbl_home.rs sanitize_zoom). */
export const HOME_ZOOM_MIN = 0.75;
export const HOME_ZOOM_MAX = 2;
export const HOME_ZOOM_STEP = 0.05;

/** Clamp to the range and snap to the step; anything non-numeric or non-finite is 100 %. `min` is the low end of the
 *  caller's slider: the docked pane's 75 % by default, the floating window's 50 % (fumbblFloatLayout.ts FLOAT_ZOOM_MIN). */
export function clampHomeZoom(value: unknown, min: number = HOME_ZOOM_MIN): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(n)) return 1;
  const clamped = Math.min(HOME_ZOOM_MAX, Math.max(min, n));
  // Same arithmetic as the shell's sanitize_zoom: (x * 20).round() / 20 (half-steps round up there and here).
  return Math.min(HOME_ZOOM_MAX, Math.max(min, Math.round(clamped * 20) / 20));
}

/** One slider/keyboard step up (+1) or down (-1) from `value`. */
export function stepHomeZoom(value: unknown, direction: 1 | -1, min: number = HOME_ZOOM_MIN): number {
  return clampHomeZoom(clampHomeZoom(value, min) + direction * HOME_ZOOM_STEP, min);
}

export function homeZoomLabel(value: unknown, min: number = HOME_ZOOM_MIN): string {
  return `${Math.round(clampHomeZoom(value, min) * 100)}%`;
}

/** Best-effort: the shell remembers the factor and re-applies it after every page load and show. The ONE zoom of the
 *  one webview: the docked pane sends its saved factor when it takes the site, the floating window its own. */
export async function sendHomeZoom(factor: number, min: number = HOME_ZOOM_MIN): Promise<void> {
  if (!inTauri()) return;
  try {
    const { invoke } = await ipc();
    // Astra 10-09: the shell takes a factor under the docked pane's 75 % only from a call that says it is the floating
    // window's. Every other call - the pane's slider, and the pane's zoom going back when the float lets go - is
    // clamped to the pane's range by the shell as well as here.
    const args = min < HOME_ZOOM_MIN ? { factor: clampHomeZoom(factor, min), float: true } : { factor: clampHomeZoom(factor, min) };
    await invoke('fumbbl_home_set_zoom', args);
  } catch {
    /* an older shell without the command: the site stays at 100 % */
  }
}

/// --- queue focus (owner 10-09: the floating window shows only the Gamefinder's queue panel) --------------------------

/** 'queue' = the page cropped to the Gamefinder's queue panel (the "Blackbox" and "Match Offers" boxes), anchored at the
 *  top-left of the site's webview; 'off' = the page as it is. */
export type HomeFocusMode = 'queue' | 'off';

/**
 * Why the queue panel is not what the site's webview shows:
 *  'ok' it is; 'off' not asked for; 'not-found' no such panel on this page; 'frame' / 'shadow' the panel is inside an
 *  iframe / a shadow root (a crop of the page cannot reach it); 'dialog' the site is showing a dialog or overlay, so
 *  the page is shown as it is until that goes; 'clipped' something on the page would cut the panel off, so the crop
 *  would draw nothing - the page is shown as it is; 'error' the page (or the call) failed; 'no-answer' the page did not
 *  answer in time; 'loading' no page to ask yet; 'unsupported' this shell has no such command.
 */
export type HomeFocusReason = 'ok' | 'off' | 'not-found' | 'frame' | 'shadow' | 'dialog' | 'clipped' | 'error' | 'no-answer' | 'loading' | 'unsupported';

const FOCUS_REASONS: readonly string[] = ['ok', 'off', 'not-found', 'frame', 'shadow', 'dialog', 'clipped', 'error', 'no-answer', 'loading'];

/** What the page said: whether the queue panel is on it, the panel's size and the Blackbox box's own extent (from the
 *  panel's top-left) in the page's CSS pixels, and when it is not found, why. */
export interface HomeFocusReport {
  found: boolean;
  width: number;
  height: number;
  /** 0 when unknown (a shell that predates the measurement): the frame then has nothing to fit itself to. */
  primaryWidth?: number;
  primaryHeight?: number;
  /** Match Offers has something in it: the frame shows the whole panel while it does (Astra R1). */
  offers?: boolean;
  /** How much of the panel must be in view right now beyond the Blackbox box (0 = nothing more). */
  needWidth?: number;
  needHeight?: number;
  /** The coach's place in the draw as the page positively shows it: 'in' (its Blackbox box shows "Leave the Draw"),
   *  'out' (it shows "Join the Draw"). Absent = it cannot be told. */
  draw?: 'in' | 'out';
  /** The page load's own mark (the runtime's): what is known of the draw is keyed by it. */
  load?: string;
  reason?: HomeFocusReason;
  /** The page's own error message when reason is 'error'. */
  error?: string;
  /** The CALL failed (an IPC rejection that is not "no such command", or an answer that made no sense): nothing is
   *  known about the page. Never a reason to stop asking. */
  failed?: boolean;
}

/** The shell's "no such command" (an OLDER SHELL), as opposed to a call that merely failed this time. */
export function isMissingCommandError(error: unknown, command: string): boolean {
  const text = typeof error === 'string' ? error : error instanceof Error ? error.message : '';
  return text.includes(command) && /not found|not allowed|unknown command/i.test(text);
}

function errorText(error: unknown): string {
  const text = typeof error === 'string' ? error : error instanceof Error ? error.message : '';
  return text.replace(/[^\x20-\x7e]/g, ' ').slice(0, 160);
}

/**
 * Ask the shell for a focus mode (src-tauri/src/fumbbl_home.rs fumbbl_home_focus_region; the work is done inside the
 * site's webview by the injected runtime, presentation only). `null` = this shell cannot do it: not the desktop app, or
 * an OLDER SHELL without the command - the caller then leaves the floating window exactly as it was before this
 * existed. Astra 10-09 (F3): ONLY that reads as null. Any other failure - a rejection, an answer that makes no sense -
 * comes back as a report with `failed`, so one bad call can never switch the feature off (and with it the "off" that
 * takes the crop away again). Never throws.
 */
export async function sendHomeFocus(mode: HomeFocusMode): Promise<HomeFocusReport | null> {
  if (!inTauri()) return null;
  let report: (Partial<HomeFocusReport> & { reason?: string }) | null | undefined;
  try {
    const { invoke } = await ipc();
    report = await invoke<Partial<HomeFocusReport> | null | undefined>('fumbbl_home_focus_region', { mode });
  } catch (error) {
    if (isMissingCommandError(error, 'fumbbl_home_focus_region')) return null;
    return { found: false, width: 0, height: 0, primaryWidth: 0, primaryHeight: 0, reason: 'error', error: errorText(error), failed: true };
  }
  if (!report || typeof report.found !== 'boolean') {
    return { found: false, width: 0, height: 0, primaryWidth: 0, primaryHeight: 0, reason: 'error', failed: true };
  }
  const edge = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0);
  const said = typeof report.reason === 'string' && FOCUS_REASONS.includes(report.reason) ? report.reason as HomeFocusReason : null;
  const out: HomeFocusReport = {
    found: report.found,
    width: edge(report.width),
    height: edge(report.height),
    primaryWidth: edge(report.primaryWidth),
    primaryHeight: edge(report.primaryHeight),
    offers: report.found && report.offers === true,
    needWidth: report.found ? edge(report.needWidth) : 0,
    needHeight: report.found ? edge(report.needHeight) : 0,
    ...(report.draw === 'in' || report.draw === 'out' ? { draw: report.draw } : {}),
    ...(typeof report.load === 'string' && report.load !== '' ? { load: report.load } : {}),
    // A shell that predates the reasons says nothing: found / not found is all it knows.
    reason: report.found ? 'ok' : said && said !== 'ok' ? said : mode === 'queue' ? 'not-found' : 'off',
  };
  if (out.reason === 'error' && typeof report.error === 'string') out.error = errorText(report.error);
  return out;
}

export interface HomeFocusState {
  /** null until the shell has answered once; false = a shell without the command (nothing more is ever sent). */
  supported: boolean | null;
  /** The mode the shell last confirmed. */
  mode: HomeFocusMode;
  /** In 'queue' mode: the panel is what the webview shows (false = the page shows as it is); null when unknown or off. */
  found: boolean | null;
  width: number;
  height: number;
  primaryWidth: number;
  primaryHeight: number;
  /** Match Offers has something in it, and how far the frame must reach into the panel right now (0 = no further
   *  than the coach's own size). */
  offers: boolean;
  needWidth: number;
  needHeight: number;
  /** The coach's place in the draw: 'in' / 'out' as the page positively shows it, 'unknown' whenever it does not -
   *  the paused box, a render in progress, no panel, another page, a report that failed. Never a stale answer. */
  draw: 'in' | 'out' | 'unknown';
  /** Counts every answer (and every failed one): something to watch for "a report has come in". */
  reports: number;
  /** Why `found` is not true (see HomeFocusReason); 'off' when nothing is asked for. */
  reason: HomeFocusReason;
  /** The page's (or the call's) own error message, when there is one. */
  error: string;
}

/** A failed "off" is tried again this often for the first few times, then - for as long as it is still owed - at a
 *  slower pace. Astra 10-09 (R4): it used to give up after the quick tries, so a shell that recovered later was never
 *  told and the docked page stayed cropped. The crop must come off the page; an "off" that is owed stays owed. */
const FOCUS_RETRY_MS = 1000;
const FOCUS_RETRY_MAX = 5;
const FOCUS_RETRY_SLOW = 10;
/** This many failed calls in a row before a failure is shown as the state (one hiccup changes nothing on screen). */
const FOCUS_FAILURES_SHOWN = 2;

/**
 * The queue focus of the ONE site webview. Calls are serialized and only the latest wish is sent, so "off" from a host
 * that is leaving can never land behind "queue" from the one arriving. A repeated 'queue' is sent again on purpose:
 * the call is idempotent on the page and its answer is how the host learns that the panel has appeared or gone
 * (the page has no channel of its own to the host - by design).
 *
 * Astra 10-09 (F3): only a shell WITHOUT the command (`send` answers null) ends this for good. A call that failed
 * leaves `supported` as it was; a failed "off" stays owed and is retried until the shell takes it (quickly at first,
 * then slowly - never given up), and `set('off', true)` - the docked pane taking the site - sends "off" even when it
 * is believed to be off already.
 */
export function createHomeFocus(
  send: (mode: HomeFocusMode) => Promise<HomeFocusReport | null> = sendHomeFocus,
  retryMs: number = FOCUS_RETRY_MS,
  /** Told of every "queue" answer - what the page says of the draw, and for which page load; 'unknown' when the call
   *  failed or the page could not say. */
  onDraw: (draw: 'in' | 'out' | 'unknown', load: string | null) => void = () => undefined,
) {
  const state = reactive<HomeFocusState>({
    supported: null, mode: 'off', found: null, width: 0, height: 0, primaryWidth: 0, primaryHeight: 0,
    offers: false, needWidth: 0, needHeight: 0, draw: 'unknown', reports: 0, reason: 'off', error: '',
  });
  let wanted: HomeFocusMode = 'off';
  let sent: HomeFocusMode | null = null;
  let again = false;
  let sending = false;
  let failures = 0;
  let retries = 0;
  /** The crop may be on the page and no "off" has been acknowledged since. Astra 10-09 (N2): set by every ATTEMPT at
   *  "queue" - an attempt whose answer was lost may still have cropped the page - and by a failed "off"; cleared only
   *  by an acknowledged "off". The last ACKNOWLEDGED mode (`sent`) cannot tell: off acknowledged, then a queue that
   *  took effect but whose answer failed, leaves `sent` at 'off' with the page cropped. */
  let offOwed = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  function retryLater(): void {
    if (retryTimer !== null) return;
    const delay = retries >= FOCUS_RETRY_MAX ? retryMs * FOCUS_RETRY_SLOW : retryMs;
    retries += 1;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (wanted !== 'off' || !offOwed || state.supported === false) return; // no longer owed
      again = true;
      void flush();
    }, delay);
  }

  async function flush(): Promise<void> {
    if (sending) return;
    sending = true;
    try {
      while (state.supported !== false && (again || sent !== wanted || (wanted === 'off' && offOwed))) {
        const mode = wanted;
        again = false;
        if (mode === 'queue') offOwed = true; // from the attempt on, whatever comes back
        const report = await send(mode);
        state.reports += 1;
        if (!report) {
          state.supported = false;
          state.draw = 'unknown';
          state.found = null;
          state.reason = 'unsupported';
          state.error = '';
          break;
        }
        // "off" that the page did not confirm is not off: the crop may still be on it.
        const failed = report.failed === true || (mode === 'off' && (report.reason === 'no-answer' || report.reason === 'error'));
        if (failed) {
          failures += 1;
          // Astra 10-09, round 9: a failed report says NOTHING of the draw, at once - the first failure used to keep
          // the previous answer, and a stale "out" kept beside a new Join press cancelled it.
          state.draw = 'unknown';
          if (mode === 'queue') onDraw('unknown', null);
          if (mode === 'off') offOwed = true;
          if (mode === 'queue' && failures >= FOCUS_FAILURES_SHOWN) {
            state.found = false;
            // Astra 10-09, round 8: and nothing is known of the draw any more - never the last answer kept as true.
            state.draw = 'unknown';
            state.reason = report.reason === 'no-answer' ? 'no-answer' : 'error';
            state.error = report.error ?? '';
          }
          // The command exists (it answered before, or it failed in a way a missing command does not).
          if (state.supported === null && report.failed !== true) state.supported = true;
          if (wanted !== mode) continue; // a newer wish: send that instead
          if (mode === 'off') retryLater(); // 'queue' is asked again by its host's own re-check
          break;
        }
        failures = 0;
        retries = 0;
        state.supported = true;
        if (mode === 'off') offOwed = false;
        sent = mode;
        state.mode = mode;
        state.found = mode === 'queue' ? report.found : null;
        state.width = mode === 'queue' ? report.width : 0;
        state.height = mode === 'queue' ? report.height : 0;
        state.primaryWidth = mode === 'queue' ? report.primaryWidth ?? 0 : 0;
        state.primaryHeight = mode === 'queue' ? report.primaryHeight ?? 0 : 0;
        state.offers = mode === 'queue' && report.found && report.offers === true;
        state.needWidth = mode === 'queue' && report.found ? report.needWidth ?? 0 : 0;
        state.needHeight = mode === 'queue' && report.found ? report.needHeight ?? 0 : 0;
        state.draw = mode === 'queue' && report.draw ? report.draw : 'unknown';
        if (mode === 'queue') onDraw(state.draw, report.load ?? null);
        state.reason = mode === 'queue' ? report.reason ?? (report.found ? 'ok' : 'not-found') : 'off';
        state.error = mode === 'queue' ? report.error ?? '' : '';
      }
    } finally {
      sending = false;
    }
  }

  /** Ask for `mode`. 'off' is sent once (again with `force`: the docked pane taking the site); 'queue' every time (a
   *  re-check). */
  function set(mode: HomeFocusMode, force = false): void {
    if (mode !== wanted) retries = 0;
    wanted = mode;
    if (mode === 'queue' || force) again = true;
    void flush();
  }

  return { state, set };
}

export type HomeFocus = ReturnType<typeof createHomeFocus>;

/** The app's one queue-focus driver. */
export const homeFocus: HomeFocus = createHomeFocus(sendHomeFocus, FOCUS_RETRY_MS, (draw, load) => {
  const seen = homeJoinWatch.presses();
  homeQueued.report({ draw, load, presses: seen !== null && load !== null && seen.load === load ? seen.count : null });
});

// --- "Join the Draw" (owner 10-09: "Float page should be the default behavior if the user has selected join queue") ---

/** What the page said: how often "Join the Draw" was pressed in the document the webview shows, that document's own
 *  random mark (the runtime makes one per page load), and whether the Gamefinder is on it. */
export interface HomeJoinReport {
  count: number;
  load: string;
  queue?: boolean;
}
type JoinAnswer = Partial<HomeJoinReport> | null | undefined;

/**
 * Ask the page (src-tauri/src/fumbbl_home.rs fumbbl_home_queue_watch; the runtime only counts, with a passive listener
 * that never touches the click). `null` = this shell cannot tell (not the desktop app, or an OLDER SHELL): never asked
 * again. 'failed' = no usable answer THIS time - the page is hidden and unloaded, still loading, did not answer, or
 * the call was rejected: the caller skips it. Astra 10-09 (R5): a failure is never a count of 0. Never throws.
 */
export async function sendHomeJoinCount(): Promise<HomeJoinReport | null | 'failed'> {
  if (!inTauri()) return null;
  try {
    const { invoke } = await ipc();
    const report = await invoke<JoinAnswer>('fumbbl_home_queue_watch');
    if (!report || typeof report.count !== 'number' || !Number.isFinite(report.count) || report.count < 0) return 'failed';
    if (typeof report.load !== 'string' || report.load === '') return 'failed';
    return { count: Math.floor(report.count), load: report.load, queue: report.queue === true };
  } catch (error) {
    return isMissingCommandError(error, 'fumbbl_home_queue_watch') ? null : 'failed';
  }
}

/**
 * Turns the count into "the coach just joined the draw": `onJoin` runs once whenever the count is HIGHER than the last
 * one seen for the same page load (a page load not seen before starts at 0 - the shell starts the count when the page
 * has loaded, so anything above 0 there is a press nobody has acted on yet).
 *  - Presses are never replayed: a coach who turned floating off by hand is not overruled until they press again.
 *  - A different mark is a different page (reloaded, parked and loaded again): its count is its own.
 *  - An answer that failed changes nothing (Astra R5: it used to read as 0, and the next good answer as a new press).
 *  - `dismiss()` (Astra N1): the coach dismissed the page - Close, or their own match starting. No press made on it UP
 *    TO THAT MOMENT can float it again, including one whose answer is still on its way: an answer to a question asked
 *    before the dismissal, and the first answer after it - whatever page it is about - are only recorded. They set
 *    the count that later presses are measured against.
 *    Astra 10-09 (X1): that is ALL a dismissal does. It used to mute the page load for good, on the grounds that a
 *    dismissed page is parked and gone - but a park can be cancelled (the coach reopens the blade while it is still
 *    queued behind another call) and the same document lives on: every later Join on it was then ignored. Now a press
 *    ABOVE the count at dismissal is a new Join, on the same page as on a new one. (Whether floating may be turned on
 *    at that moment - not in the coach's own match, not for a parked site - is the caller's rule, in `onJoin`.)
 * Astra 10-09 (R2): nothing here belongs to a component. The watch runs for as long as the page does
 * (startHomeJoinWatch), so a press is seen whether or not the FUMBBL.COM blade is still on screen when it is asked.
 */
export function createJoinWatch(
  onJoin: () => void,
  ask: () => Promise<HomeJoinReport | null | 'failed'> = sendHomeJoinCount,
  /** Told of every answer (the count and the page load it is for). */
  onReport: (report: HomeJoinReport) => void = () => undefined,
) {
  let supported = true;
  let seen: HomeJoinReport | null = null;
  let asking: Promise<void> | null = null;
  /** Questions are numbered; every question asked up to this number was asked BEFORE the last dismissal. */
  let asked = 0;
  let dismissedAt = -1;
  /** A dismissal happened and the first answer since has not come yet: that answer is a baseline, nothing more. */
  let rebase = false;
  let onQueue = false;
  /** Questions in a row that got no answer. One hiccup does not slow the pace; a page that stays silent does. */
  let silent = 0;

  async function ask1(): Promise<void> {
    const mine = ++asked;
    try {
      const report = await ask();
      if (report === null) {
        supported = false;
        onQueue = false;
        return;
      }
      if (report === 'failed') {
        silent += 1;
        if (silent >= JOIN_SILENT_MAX) onQueue = false;
        return;
      }
      silent = 0;
      onQueue = report.queue === true;
      try {
        onReport(report);
      } catch {
        /* a listener's own trouble is not the watch's */
      }
      const before = seen !== null && seen.load === report.load ? seen.count : 0;
      seen = report;
      // Asked BEFORE the dismissal: whatever it says was pressed up to then - recorded, never a Join.
      if (mine <= dismissedAt) return;
      if (rebase) {
        // The first answer since the dismissal is a baseline WHATEVER page it is about: its count and mark are
        // recorded and nothing is done. A press nobody had seen before the dismissal may be in it - on the page last
        // seen, or on one the site had moved to unobserved (Astra 10-09: last seen a:8, an unseen move to b with a
        // Join there, Close, the park cancelled by a reopen - b:1 looked like a fresh page with a fresh press and
        // floated). Only an increase in a LATER answer is a Join. After a real park the reopened page's first answer
        // normally says 0, and the press comes after it.
        rebase = false;
        return;
      }
      if (report.count > before) onJoin();
    } catch {
      /* ask() never throws; a caller's own stub might */
    }
  }

  /** One question at a time; a call made while one is out waits for that same answer. */
  function poll(): Promise<void> {
    if (!supported) return Promise.resolve();
    asking ??= ask1().finally(() => { asking = null; });
    return asking;
  }

  function dismiss(): void {
    dismissedAt = asked; // a question already on its way was asked before this moment
    rebase = true;
  }

  /** "Join the Draw" has been pressed on the page the webview shows now, and that page is the Gamefinder. Only a
   *  FALLBACK for "is the coach in the draw?" - the page's own state decides whenever it can be read. */
  /** The presses counted on the page load last seen, WITH that load's mark (a count means nothing without it: Astra
   *  10-09, round 9 - page A at 1, then page B at 1, read as "no new press"). Null before any answer. */
  const presses = () => (seen !== null ? { count: seen.count, load: seen.load } : null);

  return { poll, dismiss, supported: () => supported, onQueuePage: () => onQueue, presses };
}

/** How often the page is asked while the Gamefinder is what it shows, and while it is some other page (or gave no
 *  answer). A local question to our own webview - nothing is asked of FUMBBL. */
export const JOIN_WATCH_MS = 1500;
export const JOIN_WATCH_IDLE_MS = 10_000;
/** After this many questions in a row without an answer the page is no longer taken to be the Gamefinder. */
const JOIN_SILENT_MAX = 3;

/** The app's one Join watch. Pressing "Join the Draw" turns floating ON, exactly as "Float this page" does - the
 *  window appears as soon as the FUMBBL.COM blade is not what is on screen. Never while the coach is in their own
 *  match, and never for a site that has been dismissed (Astra N1). */
export const homeJoinWatch = createJoinWatch(() => {
  if (ui.fumbblFloating || ui.fumbblOwnMatchPlaying || homeSurface.state.parked) return;
  ui.fumbblFloating = true;
  ui.fumbblFloatHeldAt = 0;
}, sendHomeJoinCount, (report) => {
  // A count is news about the draw as well (a press of "Join the Draw"), wherever the coach is when it is seen.
  homeQueued.report({ draw: null, load: report.load, presses: report.count });
});

let joinWatchTimer: ReturnType<typeof setTimeout> | null = null;

function joinWatchTurn(): void {
  joinWatchTimer = null;
  // Astra 10-09 (N3): no page, no questions. A parked site is not asked at all (the next host to take the site starts
  // the watch again); a page that is not the Gamefinder, or that gave no answer, is asked far less often.
  if (!homeJoinWatch.supported() || homeSurface.state.parked || homeSurface.state.shell !== 'available') return;
  void homeJoinWatch.poll().then(() => {
    if (joinWatchTimer !== null || !homeJoinWatch.supported() || homeSurface.state.parked) return;
    joinWatchTimer = setTimeout(joinWatchTurn, homeJoinWatch.onQueuePage() ? JOIN_WATCH_MS : JOIN_WATCH_IDLE_MS);
  });
}

/**
 * Start (or wake) the watch: called by a host whenever it learns that the shell has the site - the pane or the
 * floating window taking it, which is also every page being reopened after a park. ONE timer, ever: it asks now, then
 * again after each answer for as long as there is a page - docked, floating, or hidden behind another blade - and
 * stops by itself when the site is parked. An older shell is asked once and never again.
 */
export function startHomeJoinWatch(): void {
  if (!homeJoinWatch.supported()) return;
  if (joinWatchTimer !== null) clearTimeout(joinWatchTimer);
  joinWatchTimer = null;
  joinWatchTurn();
}

/**
 * The coach DISMISSED the site: the floating window's Close, or their own match starting. The page is parked (hidden
 * and unloaded - homeSurface.park) and no "Join the Draw" press made on it up to now can float it again, whenever the
 * answer about it arrives. Opening the FUMBBL.COM blade afterwards normally loads the site afresh; if it is opened
 * before the park has run, the park is cancelled and the same page lives on - and in both cases a press made THERE,
 * from then on, counts again (Astra X1).
 */
export function dismissHomeSite(reason: 'closed' | 'own-match' = 'closed'): void {
  // The coach's own game has started: they were DRAWN - they are not in the draw any more, whatever the page last said.
  if (reason === 'own-match') homeQueued.reset(homeJoinWatch.presses());
  homeJoinWatch.dismiss();
  homeSurface.park();
}

// --- may the coach be in the draw? (owner 10-09: "they must leave the draw before they can close the pane") ---------------

/**
 * What the app believes about the coach and the Blackbox draw, for ONE page load:
 *  'yes'   the page positively shows them in it (its Blackbox box shows "Leave the Draw");
 *  'maybe' there is reason to think so that the page has not settled: it showed them in and has stopped showing it,
 *          "Join the Draw" was pressed on this page, or the page before this one ended 'yes' / 'maybe' and this one
 *          has not said yet;
 *  'no'    nothing suggests it, or the page has positively shown them out - twice running.
 * The floating window's X closes only on 'no'.
 *
 * Astra 10-09, rounds 8 and 9: this was spread over the runtime, the focus driver and the frame, and regressed twice
 * ("the X closes while the coach may be queued") in the seams between them. It is ONE pure function now, with the
 * state held here at app scope - not in a component that comes and goes.
 */
export type Queued = 'yes' | 'no' | 'maybe';

export interface QueuedState {
  /** The page load this is about (the runtime's mark); '' before any page has been seen. */
  load: string;
  queued: Queued;
  /** The "Join the Draw" presses counted on this page load so far. */
  presses: number;
  /** Positive "out" reads in a row, with no press and no "in" since the first of them. */
  outs: number;
  /** While 'maybe': when it BECAME so (ms) - the moment "Close anyway" is counted from. Nothing moves it while the
   *  state stays 'maybe'. */
  maybeSince: number | null;
  /** While 'yes': when the page last positively showed them in the draw (ms). 'yes' is only as good as that is fresh. */
  inAt: number | null;
}

export interface QueuedInput {
  /** What the page shows: 'in' (Leave the Draw), 'out' (Join the Draw), 'unknown' (neither, or the report failed).
   *  null = this report did not look at the box at all (the Join watch's count): nothing is read into it either way. */
  draw: 'in' | 'out' | 'unknown' | null;
  /** The page load the report is for; null when it is not known (a failed report): then it is about the current one. */
  load: string | null;
  /** The Join presses counted on THAT page load; null when not known. */
  presses: number | null;
  now: number;
}

export const QUEUED_OUTS_NEEDED = 2;
/** 'maybe' must have lasted this long before "Close anyway" is offered (nothing restarts the wait while it stays 'maybe'). */
export const QUEUED_SETTLE_MS = 1500;
/** 'yes' is "the page shows them in the draw": a positive 'in' older than this no longer holds it (three of the
 *  frame's one-second looks). */
export const QUEUED_IN_FRESH_MS = 3000;

export function initialQueued(): QueuedState {
  return { load: '', queued: 'no', presses: 0, outs: 0, maybeSince: null, inAt: null };
}

/**
 * One report in, the next state out. The rules, all of them:
 *  1. A NEW page load (a mark not seen before) starts afresh: the presses count from 0 (the shell starts the count
 *     when the page has loaded) and the previous page's state is discarded - except that it starts at 'maybe' when the
 *     previous page ended 'yes' or 'maybe'. The coach's place in the draw is the SERVER's; a reload does not take them
 *     out of it, and the new page has not said yet. (Whatever the new page is: one that never shows the Blackbox box
 *     stays 'maybe' and the X offers "Close anyway".)
 *  2. More presses of "Join the Draw" than before on this load: at least 'maybe' - and never lowered by this same
 *     report, whatever else it says.
 *  3. A positive 'in': 'yes'.
 *  4. A positive 'out': counted. 'no' only on the SECOND in a row on the same load, with no press since the first and
 *     no 'in' between (one read can be the box between two renders, or a page that has not caught up with a press).
 *  6. 'yes' lasts only while the page keeps showing it: with no positive 'in' for QUEUED_IN_FRESH_MS, the next report
 *     of any kind makes it 'maybe'. So whatever the reports, a state that is not 'no' is escapable within
 *     QUEUED_IN_FRESH_MS + one report + QUEUED_SETTLE_MS of the last positive 'in'.
 *  5. 'unknown' never clears anything: 'maybe' stays, and 'yes' becomes 'maybe' (they may still be in it; the page
 *     has merely stopped showing it). It breaks a run of 'out's.
 */
export function reduceQueued(prev: QueuedState, input: QueuedInput): QueuedState {
  let next: QueuedState = { ...prev };
  if (input.load !== null && input.load !== '' && input.load !== prev.load) {
    // Carried from ANY page before - also one whose mark was never known ('': a shell that sends none, a report that
    // named no page). Astra 10-09, round 10: 'yes' learnt without a mark was dropped to 'no' by the first marked report.
    const carried = prev.queued !== 'no';
    // One stretch of 'maybe' is one wait: a reload in the middle of it does not start the clock again.
    const since = prev.queued === 'maybe' && prev.maybeSince !== null ? prev.maybeSince : input.now;
    next = { load: input.load, queued: carried ? 'maybe' : 'no', presses: 0, outs: 0, maybeSince: carried ? since : null, inAt: null };
  }
  const was = next.queued;
  let pressed = false;
  if (input.presses !== null && input.presses > next.presses) {
    next.presses = input.presses;
    next.outs = 0;
    pressed = true;
    if (next.queued === 'no') next.queued = 'maybe';
  }
  if (input.draw === 'in') {
    next.queued = 'yes';
    next.outs = 0;
    next.inAt = input.now;
  } else if (input.draw === 'out') {
    next.outs = pressed ? 0 : next.outs + 1;
    if (!pressed && next.outs >= QUEUED_OUTS_NEEDED) next.queued = 'no';
  } else if (input.draw === 'unknown') {
    next.outs = 0;
    // The page has stopped showing it. They are not out - nothing says so - but 'yes' is "the page shows them in":
    // it becomes 'maybe', which still asks and can only be cleared by two positive 'out's, and which lets the coach
    // close anyway after a moment. (Kept at 'yes', a Blackbox that pauses after they joined - no button at all, for
    // minutes - or a finder that has stopped working would hold the window open with no way out.)
    if (next.queued === 'yes') next.queued = 'maybe';
  }
  // 'yes' does not outlive its evidence. Astra 10-09, round 11: reports that never say 'unknown' could hold 'yes' for
  // ever with no further 'in' - the Join watch's own (no look at the box: draw null), or an 'out' with a fresh press
  // beside it every time - and 'yes' has no way out. So ANY report that is not a positive 'in' turns a 'yes' whose last
  // 'in' is older than QUEUED_IN_FRESH_MS into 'maybe': it still asks, it still needs two clean 'out's to clear, and
  // its escape clock runs. (A null draw is deliberately NOT read as 'unknown' outright: the Join watch reports every
  // 1.5 s beside the frame's own looks, and that would flip a healthy 'yes' to 'maybe' and back all the time.)
  if (next.queued === 'yes' && input.draw !== 'in' && (next.inAt === null || input.now - next.inAt > QUEUED_IN_FRESH_MS)) next.queued = 'maybe';
  if (next.queued !== 'yes') next.inAt = null;
  // The escape clock: it starts when the state BECOMES 'maybe' and runs for as long as it stays 'maybe'. Only leaving
  // 'maybe' ends it - a positive 'in' ('yes') or the second 'out' ('no'). Astra 10-09, round 10: a lone positive 'out'
  // used to restart it, so a page alternating 'out' and 'unknown' never cleared and never offered a way out.
  if (next.queued !== 'maybe') next.maybeSince = null;
  else if (was !== 'maybe' || next.maybeSince === null) next.maybeSince = input.now;
  return next;
}

/**
 * The coach's own game has started: out of the draw, and the presses seen so far ON THIS PAGE are not news any more.
 * `seen` is what the Join watch last saw - a count WITH the page load it is for. It moves this state's baseline only
 * when it is for this state's own page: a count is only ever compared with a baseline from the same load mark (Astra
 * 10-09, round 10: page A's 8 was taken for page B's baseline, and a real Join on B - its 1 - was then ignored).
 */
export function resetQueued(prev: QueuedState, seen: { count: number; load: string } | null): QueuedState {
  const own = seen !== null && seen.load !== '' && seen.load === prev.load ? seen.count : 0;
  return { load: prev.load, queued: 'no', presses: Math.max(prev.presses, own), outs: 0, maybeSince: null, inAt: null };
}

/** "Close anyway" may be offered: 'maybe' (never 'yes') for QUEUED_SETTLE_MS on end. */
export function queuedSettled(state: QueuedState, now: number): boolean {
  return state.queued === 'maybe' && state.maybeSince !== null && now - state.maybeSince >= QUEUED_SETTLE_MS;
}

/** The state above, held for the app and mirrored for the frame to draw from. */
export function createQueuedTracker(now: () => number = () => Date.now()) {
  const state = reactive<{ queued: Queued; closeAnyway: boolean }>({ queued: 'no', closeAnyway: false });
  let current = initialQueued();
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** The `maybeSince` whose wait has run out (the timer's own word: it does not depend on the clock being read twice). */
  let waited: number | null = null;
  /** The `maybeSince` the running timer is for. */
  let armedFor: number | null = null;

  const settled = () => current.queued === 'maybe' && current.maybeSince !== null
    && (waited === current.maybeSince || queuedSettled(current, now()));

  function sync(): void {
    state.queued = current.queued;
    if (current.queued !== 'maybe' || waited !== current.maybeSince) waited = null;
    state.closeAnyway = settled();
    const wanted = current.queued === 'maybe' && current.maybeSince !== null && !state.closeAnyway ? current.maybeSince : null;
    if (timer !== null && armedFor === wanted) return; // the wait already running is this one: never restarted
    if (timer !== null) clearTimeout(timer);
    timer = null;
    armedFor = wanted;
    if (wanted !== null) {
      const since = wanted;
      timer = setTimeout(() => {
        timer = null;
        armedFor = null;
        if (current.queued === 'maybe' && current.maybeSince === since) waited = since; // still the same wait: it is over
        state.closeAnyway = settled();
      }, Math.max(0, since + QUEUED_SETTLE_MS - now()));
    }
  }

  return {
    state,
    report(input: Omit<QueuedInput, 'now'>): void {
      current = reduceQueued(current, { ...input, now: now() });
      sync();
    },
    reset(seen: { count: number; load: string } | null): void {
      current = resetQueued(current, seen);
      sync();
    },
    /** Asked at the moment of a press: never a value drawn a moment ago. */
    queued: (): Queued => current.queued,
    mayCloseAnyway: (): boolean => settled(),
    peek: (): QueuedState => ({ ...current }),
  };
}

/** The app's one. Memory only: nothing of it outlives the app. */
export const homeQueued = createQueuedTracker();
