export type D6FaceValue = 1 | 2 | 3 | 4 | 5 | 6;
export type D6FaceVariant = 'brushed-metal' | 'black';

export const D6_FACE_VALUES: readonly D6FaceValue[] = [1, 2, 3, 4, 5, 6];
export const D6_FACE_VARIANTS: readonly D6FaceVariant[] = ['brushed-metal', 'black'];
export const DEFAULT_D6_FACE_VARIANT: D6FaceVariant = 'brushed-metal';

export function isD6FaceValue(value: unknown): value is D6FaceValue {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 6;
}

export function d6FaceUrl(
  value: D6FaceValue,
  variant: D6FaceVariant = DEFAULT_D6_FACE_VARIANT,
): string {
  const filename = variant === 'brushed-metal'
    ? `d6-brushed-metal-face-${value}.png`
    : `d6-face-${value}.png`;
  return new URL(`../assets/d6/${filename}`, import.meta.url).href;
}

/** The legacy `black` key now selects the original white-pip-face set, which
 * includes a wide transparent border. Keep it visually aligned with the
 * canvas-filling brushed-metal set without invalidating saved preferences. */
export function d6FaceVisualScale(variant: D6FaceVariant): number {
  return variant === 'black' ? 1.44 : 1;
}
