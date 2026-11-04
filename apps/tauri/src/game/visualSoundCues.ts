import { settings } from './settings';
import { SOUND_CATALOG, onSoundCue } from './sounds';
import { $t } from '../i18n';

/**
 * Settings reflow (owner 11-03): Settings > Accessibility "Visual sound cues" (default off). Whenever a sound cue
 * plays (game sounds, the turn-clock warning and countdown, a failed roll, a cancelled action, chat...), a small
 * label with a note glyph shows on screen for VISUAL_CUE_MS (>= the 450 ms viewer-visible floor).
 *
 * Decisions:
 *  - It shows at ANY volume, 0 included: the listener (sounds.ts onSoundCue) runs before the volume check, and a coach
 *    who cannot hear the client is exactly who turns this on.
 *  - It does NOT show for a cue switched Off in Settings > Audio (playSound returns before telling listeners): Off
 *    means "I don't want this cue", in any form. Nor during a catch-up fast-forward (sounds are suppressed there).
 *  - Repeats of the same cue while its label is up (footsteps, the countdown) refresh that label with a count instead
 *    of stacking; at most VISUAL_CUE_MAX labels show. A full board queues new cues; no label leaves before it has been
 *    up VISUAL_CUE_MIN_MS (450 ms).
 * Visual only: aria-hidden (a screen reader announcing every footstep would drown the game), pointer-transparent.
 */

export const VISUAL_CUE_MS = 1500;
export const VISUAL_CUE_MAX = 3;
/** The viewer-visible floor (450 ms rule): a label shown is never removed sooner than this. */
export const VISUAL_CUE_MIN_MS = 450;
/** At most this many distinct cues wait for a slot; beyond it the oldest WAITING one is dropped (never a shown one). */
export const VISUAL_CUE_QUEUE_MAX = 6;

export interface VisualCue { soundId: string; label: string; count: number; shownAt: number; until: number }

/**
 * Sol r1: the board never cuts a shown label short. A full board QUEUES a new cue (repeats aggregate into its count)
 * until a slot frees: a label leaves at its `until`, or - only while cues are waiting - once it has been up
 * VISUAL_CUE_MIN_MS, oldest first. `nextChangeAt` tells the host when to look again.
 */
export function createVisualCueBoard(options: { visibleMs?: number; max?: number; queueMax?: number } = {}): {
  add(soundId: string, label: string, now: number): VisualCue[];
  expire(now: number): VisualCue[];
  cues(): VisualCue[];
  waiting(): number;
  nextChangeAt(): number | null;
} {
  const visibleMs = Math.max(VISUAL_CUE_MIN_MS, options.visibleMs ?? VISUAL_CUE_MS);
  const max = Math.max(1, options.max ?? VISUAL_CUE_MAX);
  const queueMax = Math.max(1, options.queueMax ?? VISUAL_CUE_QUEUE_MAX);
  let list: VisualCue[] = [];
  let queue: { soundId: string; label: string; count: number }[] = [];
  const settle = (now: number): VisualCue[] => {
    list = list.filter((cue) => cue.until > now);
    while (queue.length > 0) {
      if (list.length >= max) {
        const oldest = list.reduce((a, c) => (c.shownAt < a.shownAt ? c : a));
        if (now - oldest.shownAt < VISUAL_CUE_MIN_MS) break; // the floor holds: wait
        list = list.filter((cue) => cue !== oldest);
      }
      const next = queue.shift()!;
      list = [...list, { ...next, shownAt: now, until: now + visibleMs }];
    }
    return list;
  };
  return {
    add(soundId, label, now) {
      settle(now);
      const same = list.find((cue) => cue.soundId === soundId);
      if (same) {
        same.count += 1;
        same.until = now + visibleMs; // a refresh only ever extends
        return list;
      }
      const waitingSame = queue.find((q) => q.soundId === soundId);
      if (waitingSame) { waitingSame.count += 1; return list; }
      queue.push({ soundId, label, count: 1 });
      while (queue.length > queueMax) queue = queue.slice(1);
      return settle(now);
    },
    expire: settle,
    cues: () => list,
    waiting: () => queue.length,
    nextChangeAt() {
      if (list.length === 0) return null;
      const ends = list.map((cue) => cue.until);
      if (queue.length > 0) ends.push(...list.map((cue) => cue.shownAt + VISUAL_CUE_MIN_MS));
      return Math.min(...ends);
    },
  };
}

export function visualCueLabel(soundId: string): string {
  return SOUND_CATALOG.find((entry) => entry.id === soundId)?.label ?? $t('settings.reflowNew.visualSoundCues.genericCue');
}

/** main.ts: listen for cues for the whole session; draws into a fixed, pointer-transparent strip on <body>. */
export function installVisualSoundCues(doc: Document = document): () => void {
  const board = createVisualCueBoard();
  let host: HTMLDivElement | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const render = (): void => {
    const cues = board.expire(Date.now());
    if (cues.length === 0) { host?.remove(); host = null; return; }
    if (!host) {
      host = doc.createElement('div');
      host.className = 'sf-sound-cues';
      host.setAttribute('aria-hidden', 'true');
      doc.body.appendChild(host);
    }
    host.replaceChildren(...cues.map((cue) => {
      const row = doc.createElement('div');
      row.className = 'sf-sound-cue';
      row.dataset.sound = cue.soundId;
      row.textContent = cue.count > 1 ? `♪ ${cue.label} ×${cue.count}` : `♪ ${cue.label}`;
      return row;
    }));
    if (timer !== null) clearTimeout(timer);
    const at = board.nextChangeAt();
    if (at !== null) timer = setTimeout(() => { timer = null; render(); }, Math.max(16, at - Date.now()));
  };
  const off = onSoundCue((soundId) => {
    if (!settings.visualSoundCues) return;
    board.add(soundId, visualCueLabel(soundId), Date.now());
    render();
  });
  return () => {
    off();
    if (timer !== null) clearTimeout(timer);
    host?.remove();
    host = null;
  };
}
