import { reactive } from 'vue';
import { bundledWalkManifest, resolveBundledWalkRole, rosterRaceKey, type WalkSheetBindingTransport } from '@fumbbl40k/ffb-pitch';
import { assetMods } from './assetMods';
import { reactivePlayerSpriteUrl } from './assetModUi';

/**
 * Owner 09-09: DOM portraits for the Team Builder (Add Players cards, Roster Slots, library rows, star picks) —
 * pages with no Pixi renderer, so `renderer.playerPortrait` cannot serve them. The chain mirrors the pitch:
 *   1. an active pack PLAYER-SPRITE target (a single image URL, used as-is);
 *   2. the active pack WALK SHEET for the roster/position (same candidate order as walkers.walkSheetFor);
 *   3. the bundled Super FUMBBL walk sheet resolved by race + position name (stars via the 'stars' pseudo-race).
 * A walk sheet's IDLE frame (column 0 of the camera-facing 'S' row) is cropped onto a canvas at 2x with nearest
 * sampling and cached as a data URL; the reactive cache lets a card re-render when the frame arrives.
 */

const PORTRAIT_SCALE = 2;
const portraits = reactive(new Map<string, string | null>()); // key -> data URL (null while loading / failed)
const inflight = new Set<string>();

interface SheetFrame { url: string; frame: number; rows: readonly string[]; column: number }

function idleFrameKey(sheet: SheetFrame): string {
  return `${sheet.url}|${sheet.rows.indexOf('S')}|${sheet.frame}|${sheet.column}`;
}

function packWalkSheet(teamId: string, positionId: string, side: 'home' | 'away', race: string): WalkSheetBindingTransport | undefined {
  const bindings = assetMods.activeWalkBindings;
  if (!bindings.length) return undefined;
  const raceTarget = race ? `race:${race.toLowerCase().replace(/[^a-z0-9]/g, '')}` : '';
  const plainRace = race ? rosterRaceKey(race) : '';
  const plainTarget = plainRace && `race:${plainRace}` !== raceTarget ? `race:${plainRace}` : '';
  const candidates: [string, string][] = [
    [teamId, side], [teamId, 'any'],
    ...(raceTarget ? [[raceTarget, side], [raceTarget, 'any']] as [string, string][] : []),
    ...(plainTarget ? [[plainTarget, side], [plainTarget, 'any']] as [string, string][] : []),
  ];
  for (const [team, want] of candidates) {
    const hit = bindings.find((b) => b.teamId === team && b.positionId === positionId && (b.side ?? 'any') === want);
    if (hit) return hit;
  }
  return undefined;
}

function bundledSheet(race: string, positionName: string, side: 'home' | 'away'): SheetFrame | undefined {
  const target = resolveBundledWalkRole(race, positionName);
  if (!target) return undefined;
  const entries = bundledWalkManifest().filter((e) => e.race === target.race && e.role === target.role);
  const entry = entries.find((e) => e.side === side) ?? entries.find((e) => e.side === 'any') ?? entries[0];
  return entry ? { url: entry.url, frame: entry.frame ?? 64, rows: entry.rows, column: 0 } : undefined;
}

function renderIdleFrame(key: string, sheet: SheetFrame): void {
  if (inflight.has(key) || typeof Image === 'undefined' || typeof document === 'undefined') return;
  inflight.add(key);
  const img = new Image();
  img.onload = () => {
    try {
      const row = Math.max(0, sheet.rows.indexOf('S'));
      const size = sheet.frame;
      const canvas = document.createElement('canvas');
      canvas.width = size * PORTRAIT_SCALE;
      canvas.height = size * PORTRAIT_SCALE;
      const ctx = canvas.getContext('2d');
      if (!ctx) { portraits.set(key, null); return; }
      ctx.imageSmoothingEnabled = false;
      // Owner 09-09: crop to the FIGURE — the 64/72 px frame carries transparent padding around a ~53 px body, which
      // read as a small sprite floating in the card's box. Scan the frame's alpha for its opaque bounds (1 px
      // margin), then draw that box to fill the canvas so the badge shows the whole figure edge to edge.
      const probe = document.createElement('canvas');
      probe.width = size; probe.height = size;
      const pctx = probe.getContext('2d');
      let sx = 0, sy = 0, sw = size, sh = size;
      if (pctx) {
        pctx.drawImage(img, sheet.column * size, row * size, size, size, 0, 0, size, size);
        const data = pctx.getImageData(0, 0, size, size).data;
        let x0 = size, y0 = size, x1 = -1, y1 = -1;
        for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
          if (data[(y * size + x) * 4 + 3]! > 16) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        }
        if (x1 >= x0 && y1 >= y0) {
          const side = Math.max(x1 - x0 + 1, y1 - y0 + 1) + 2; // square crop, 1 px margin
          sx = Math.max(0, Math.min(size - side, Math.round((x0 + x1) / 2 - side / 2)));
          sy = Math.max(0, Math.min(size - side, y1 + 1 - side)); // feet stay on the floor of the box
          sw = sh = Math.min(side, size);
        }
      }
      ctx.drawImage(img, sheet.column * size + sx, row * size + sy, sw, sh, 0, 0, canvas.width, canvas.height);
      portraits.set(key, canvas.toDataURL());
    } catch (error) {
      console.warn('walker portrait: frame extract failed', error);
      portraits.set(key, null);
    } finally {
      inflight.delete(key);
    }
  };
  img.onerror = () => { portraits.set(key, null); inflight.delete(key); };
  img.src = sheet.url;
}

/** What the portrait would be drawn from (test/inspection seam; no rendering). */
export function walkerPortraitSource(input: {
  teamId: string; positionId: string; positionName: string; race: string; side?: 'home' | 'away';
}): { kind: 'sprite'; url: string } | { kind: 'sheet'; url: string; frame: number; row: number } | null {
  const side = input.side ?? 'home';
  const sprite = reactivePlayerSpriteUrl(input.teamId, input.positionId, side, input.race);
  if (sprite) return { kind: 'sprite', url: sprite };
  const pack = packWalkSheet(input.teamId, input.positionId, side, input.race);
  if (pack) return { kind: 'sheet', url: pack.url, frame: pack.frame, row: Math.max(0, pack.rows.indexOf('S')) };
  const bundled = bundledSheet(input.race, input.positionName, side);
  if (bundled) return { kind: 'sheet', url: bundled.url, frame: bundled.frame, row: Math.max(0, bundled.rows.indexOf('S')) };
  return null;
}

/** Vue-tracked portrait URL: a pack sprite URL, or the cached idle-frame data URL (null until it renders). */
export function walkerPortraitUrl(input: {
  teamId: string; positionId: string; positionName: string; race: string; side?: 'home' | 'away';
}): string | null {
  void assetMods.revision;
  const side = input.side ?? 'home';
  const sprite = reactivePlayerSpriteUrl(input.teamId, input.positionId, side, input.race);
  if (sprite) return sprite;
  const pack = packWalkSheet(input.teamId, input.positionId, side, input.race);
  const sheet: SheetFrame | undefined = pack
    ? { url: pack.url, frame: pack.frame, rows: pack.rows, column: pack.idleColumn ?? 0 }
    : bundledSheet(input.race, input.positionName, side);
  if (!sheet) return null;
  const key = idleFrameKey(sheet);
  if (!portraits.has(key)) { portraits.set(key, null); renderIdleFrame(key, sheet); }
  return portraits.get(key) ?? null;
}

/** Test seam: drop every cached frame. */
export function resetWalkerPortraits(): void { portraits.clear(); inflight.clear(); }
