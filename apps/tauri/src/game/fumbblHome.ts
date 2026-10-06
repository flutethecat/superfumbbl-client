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
 */

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

export type StyleReader = (element: Element) => Pick<CSSStyleDeclaration, 'display' | 'visibility' | 'opacity'>;

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

/** True when anything of ours draws over (part of) the pane. `host` is the pane's own element. */
export function isPaneOccluded(host: Element, rect: PaneRect, doc: ProbeDocument, style: StyleReader): boolean {
  for (const [x, y] of probePoints(rect)) {
    const top = doc.elementFromPoint(x, y);
    if (!top) return true; // outside the viewport: part of the pane is off screen
    if (top === host || host.contains(top)) continue;
    if (isIgnored(top)) continue;
    return true;
  }
  const overlays = doc.querySelectorAll(OVERLAY_SELECTOR);
  for (let index = 0; index < overlays.length; index += 1) {
    const element = overlays[index]!;
    if (host.contains(element) || isIgnored(element)) continue;
    const box = element.getBoundingClientRect();
    if (box.width < MIN_OVERLAY_EDGE || box.height < MIN_OVERLAY_EDGE) continue;
    const css = style(element);
    if (css.display === 'none' || css.visibility === 'hidden' || Number(css.opacity) === 0) continue;
    if (intersects(rect, { x: box.left, y: box.top, width: box.width, height: box.height })) return true;
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

// --- zoom (owner 10-06: "Text can be a bit small for users in its current form") ------------------------------------

/** The Home pane's zoom slider: 75 %-200 % in 5 % steps (the shell clamps the same way: fumbbl_home.rs sanitize_zoom). */
export const HOME_ZOOM_MIN = 0.75;
export const HOME_ZOOM_MAX = 2;
export const HOME_ZOOM_STEP = 0.05;

/** Clamp to the range and snap to the step; anything non-numeric or non-finite is 100 %. */
export function clampHomeZoom(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(n)) return 1;
  const clamped = Math.min(HOME_ZOOM_MAX, Math.max(HOME_ZOOM_MIN, n));
  // Same arithmetic as the shell's sanitize_zoom: (x * 20).round() / 20 (half-steps round up there and here).
  return Math.min(HOME_ZOOM_MAX, Math.max(HOME_ZOOM_MIN, Math.round(clamped * 20) / 20));
}

/** One slider/keyboard step up (+1) or down (-1) from `value`. */
export function stepHomeZoom(value: unknown, direction: 1 | -1): number {
  return clampHomeZoom(clampHomeZoom(value) + direction * HOME_ZOOM_STEP);
}

export function homeZoomLabel(value: unknown): string {
  return `${Math.round(clampHomeZoom(value) * 100)}%`;
}

/** Best-effort: the shell remembers the factor and re-applies it after every page load and show. */
export async function sendHomeZoom(factor: number): Promise<void> {
  if (!inTauri()) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('fumbbl_home_set_zoom', { factor: clampHomeZoom(factor) });
  } catch {
    /* an older shell without the command: the site stays at 100 % */
  }
}
