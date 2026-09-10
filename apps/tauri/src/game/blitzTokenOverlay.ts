import type { PitchRenderer } from '@fumbbl40k/ffb-pitch';

export type PersistentBlitzToken = { blitzerId: string; targetId: string; side: boolean; seq: number };
export type BlitzTokenMarker = { x: number; y: number; emoji: string; cls: string };

/** Modern's persistent blitz occurrence projection. Player identity remains server-derived; both visual
 * anchors fail closed through the renderer when the authoritative player has no live on-pitch token. */
export function projectBlitzTokenMarkers(
  token: PersistentBlitzToken,
  actedPlayers: readonly string[],
  renderer: Pick<PitchRenderer, 'playerTokenAnchorToCanvas'>,
  actingPlayerId: string | null = null,
): BlitzTokenMarker[] {
  const out: BlitzTokenMarker[] = [];
  const add = (playerId: string, emoji: string, cls: string) => {
    const point = renderer.playerTokenAnchorToCanvas(playerId, cls ? 'body' : 'head');
    if (point) out.push({ x: point.x, y: point.y, emoji, cls });
  };
  // Owner 09-07: from the moment the blitz is INITIATED the blitzer's decoration rests on the CHEST (the over-head
  // action marker carries the live activation); the target ring mounts on the target's chest like the block target.
  // The whole token tears down with the turn (store: blitzTokens is per-turn-key). actedPlayers / actingPlayerId
  // stay in the signature for callers; they no longer move the badge.
  void actedPlayers; void actingPlayerId;
  add(token.blitzerId, '⚡', 'centered');
  if (token.targetId) add(token.targetId, '🎯', 'centered');
  return out;
}

/** Keep the renderer's transient-badge suppression identity in the same lifecycle as the Modern
 * persistent overlay. Null must be delivered explicitly so a later occurrence reusing the same
 * player id is not suppressed by stale teardown state. */
export function syncBlitzTokenPresentation(
  token: PersistentBlitzToken | null,
  actedPlayers: readonly string[],
  renderer: Pick<PitchRenderer, 'playerTokenAnchorToCanvas' | 'setOppositionBlitzBadgePlayer'>,
  actingPlayerId: string | null = null,
): BlitzTokenMarker[] {
  renderer.setOppositionBlitzBadgePlayer(token?.blitzerId ?? null);
  return token ? projectBlitzTokenMarkers(token, actedPlayers, renderer, actingPlayerId) : [];
}

/** Immediate + RAF projection lifecycle used by Modern play, spectate, and replay. Starting is
 * deliberately immediate so a remounted Modern view paints a pre-existing occurrence on frame one. */
export function startBlitzTokenProjection(options: {
  readToken(): PersistentBlitzToken | null;
  readActedPlayers(): readonly string[];
  /** Owner 09-06: the current acting player id ('' / null = none) — the blitzer's activation has ended once it differs. */
  readActingPlayerId?(): string | null;
  renderer: Pick<PitchRenderer, 'playerTokenAnchorToCanvas' | 'setOppositionBlitzBadgePlayer'>;
  publish(markers: BlitzTokenMarker[]): void;
  schedule?(callback: FrameRequestCallback): number;
  cancel?(handle: number): void;
}): () => void {
  const schedule = options.schedule ?? requestAnimationFrame;
  const cancel = options.cancel ?? cancelAnimationFrame;
  let live = true;
  let handle = 0;
  const step = () => {
    if (!live) return;
    const token = options.readToken();
    options.publish(syncBlitzTokenPresentation(token, options.readActedPlayers(), options.renderer, options.readActingPlayerId?.() ?? null));
    if (token) handle = schedule(step);
  };
  step();
  return () => {
    if (!live) return;
    live = false;
    cancel(handle);
    options.renderer.setOppositionBlitzBadgePlayer(null);
    options.publish([]);
  };
}
