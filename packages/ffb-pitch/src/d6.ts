import type { BlockDieSide } from './blockDieSurface';

export type D6FaceValue = 1 | 2 | 3 | 4 | 5 | 6;
/** Owner 10-13: 'team' = "Brushed metal, home and away": the blue set for a die of the displayed home side, the red
 *  set for away (d6-team-{home,away}-face-N.png, scripts/compose-brushed-dice.py). A die with no known owner keeps the
 *  neutral brushed-metal face. */
export type D6FaceVariant = 'brushed-metal' | 'black' | 'team';

export const D6_FACE_VALUES: readonly D6FaceValue[] = [1, 2, 3, 4, 5, 6];
export const D6_FACE_VARIANTS: readonly D6FaceVariant[] = ['brushed-metal', 'black', 'team'];
export const DEFAULT_D6_FACE_VARIANT: D6FaceVariant = 'brushed-metal';

export function isD6FaceValue(value: unknown): value is D6FaceValue {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 6;
}

/** Owner 11-11 (Train, Linux: HTML dice painted as black boxes): 'small' = the 256 px copy of the face
 *  (`<name>-256.png`, scripts/gen-small-d6-faces.py) for HTML surfaces (log, panels, cards; 24-84 CSS px). The pitch
 *  renderer keeps the full-size masters. */
export type D6FaceSize = 'full' | 'small';

export function d6FaceUrl(
  value: D6FaceValue,
  variant: D6FaceVariant = DEFAULT_D6_FACE_VARIANT,
  side?: BlockDieSide | null,
  size: D6FaceSize = 'full',
): string {
  const filename = variant === 'team' && (side === 'home' || side === 'away')
    ? `d6-team-${side}-face-${value}.png`
    : variant === 'black'
      ? `d6-face-${value}.png`
      : `d6-brushed-metal-face-${value}.png`;
  const file = size === 'small' ? filename.replace(/\.png$/, '-256.png') : filename;
  return new URL(`../assets/d6/${file}`, import.meta.url).href;
}

/** The legacy `black` key now selects the original white-pip-face set, which
 * includes a wide transparent border. Keep it visually aligned with the
 * canvas-filling brushed-metal set without invalidating saved preferences. */
export function d6FaceVisualScale(variant: D6FaceVariant): number {
  return variant === 'black' ? 1.44 : 1;
}
