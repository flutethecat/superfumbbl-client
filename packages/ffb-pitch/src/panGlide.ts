/** The WASD / edge-pan camera glide, one ticker frame (renderer.ts glide ticker).
 *
 *  Frame-rate independent: the speeds and the easing are tuned for 60 fps. `dt` is Pixi's ticker.deltaTime: 1 at
 *  60 fps, 2 at 30 fps, 0.5 at 120 fps, clamped to [0, 4] so a stalled frame cannot fling the camera. The velocity eases
 *  toward the target by 0.18 per 60-fps frame (1 - 0.82^dt over dt frames), and the world moves velocity * dt, so a
 *  dropped frame no longer slows the glide. Ported from github.com/flutethecat/superfumbbl-client pull request 5. */
export const PAN_GLIDE_EASE_PER_FRAME = 0.18;
export const PAN_GLIDE_MAX_DT = 4;
/** Below this speed (px per 60-fps frame) an axis stops. */
export const PAN_GLIDE_STOP = 0.05;

export interface PanGlideStep {
  /** The new velocity, px per 60-fps frame. */
  vel: { x: number; y: number };
  /** How far the world moves this frame, px. */
  dx: number;
  dy: number;
}

export function panGlideStep(
  vel: { x: number; y: number },
  target: { x: number; y: number },
  deltaTime: number | undefined,
): PanGlideStep {
  const raw = typeof deltaTime === 'number' && Number.isFinite(deltaTime) ? deltaTime : 1;
  const dt = Math.min(PAN_GLIDE_MAX_DT, Math.max(0, raw));
  const ease = 1 - Math.pow(1 - PAN_GLIDE_EASE_PER_FRAME, dt);
  let x = vel.x + (target.x - vel.x) * ease;
  let y = vel.y + (target.y - vel.y) * ease;
  if (Math.abs(x) < PAN_GLIDE_STOP) x = 0;
  if (Math.abs(y) < PAN_GLIDE_STOP) y = 0;
  return { vel: { x, y }, dx: x * dt, dy: y * dt };
}
