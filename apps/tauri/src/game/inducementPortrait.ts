import { playerSpriteAsset } from '@fumbbl40k/ffb-pitch';

export interface InducementPortraitPosition {
  positionId?: string;
  urlPortrait?: string;
  urlIconSet?: string;
}

export interface InducementPortraitView {
  url: string | null;
  glyph: string;
  source?: 'iconset' | 'custom';
}

export type InducementAssetResolver = (relativeUrl: string | undefined) => string | undefined;
export type InducementCustomSpriteResolver = (teamId: string, positionId: string) => string | undefined;

/**
 * Resolve an inducement-card player sprite from installed local asset packs.
 *
 * `urlIconSet` is the same four-frame player sprite sheet used on the pitch. The
 * card component crops its first standing frame into the thumbnail. Deliberately
 * do not use `urlPortrait` (the FUMBBL web portrait) or manufacture a CDN URL: a
 * missing local sprite must leave the component's generic glyph fallback visible
 * in a packaged build.
 */
export function cachedInducementPortrait(
  position: InducementPortraitPosition | null | undefined,
  glyph: string,
  resolveCached: InducementAssetResolver,
): InducementPortraitView {
  const iconset = resolveCached(position?.urlIconSet);
  if (iconset) return { url: iconset, glyph, source: 'iconset' };

  return { url: null, glyph };
}

/**
 * Stars and mercenaries share the same positive-cache-only sprite contract.
 * Keep the `kind` argument in the view seam because callers project separate
 * blades, but neither blade may fall back to remote FUMBBL artwork.
 */
export function inducementRosterPortrait(
  kind: 'star' | 'mercenary',
  position: InducementPortraitPosition | null | undefined,
  glyph: string,
  resolveCached: InducementAssetResolver,
  resolveFumbbl: (relativeUrl: string | undefined) => string | null,
): InducementPortraitView {
  void kind;
  void resolveFumbbl;
  return cachedInducementPortrait(position, glyph, resolveCached);
}

/** Resolve an exact team+position custom sprite before the bundled cache.
 *  The identity pair is the mod-pack authority; names/races never participate. */
export function configuredInducementSprite(
  teamId: string,
  position: InducementPortraitPosition | null | undefined,
  glyph: string,
  resolveCustom: InducementCustomSpriteResolver,
  resolveCached: InducementAssetResolver,
): InducementPortraitView {
  const positionId = String(position?.positionId ?? '');
  const custom = teamId && positionId ? resolveCustom(teamId, positionId) : undefined;
  if (custom) return { url: custom, glyph, source: 'custom' };
  return cachedInducementPortrait(position, glyph, resolveCached);
}

/** Production active-pack seam used by every inducement player card. Keeping
 *  the exact identity lookup here lets mounted UI tests exercise the real pack
 *  activation registry rather than substituting a portrait callback. */
export function activeInducementSprite(
  teamId: string,
  position: InducementPortraitPosition | null | undefined,
  glyph: string,
  resolveCached: InducementAssetResolver,
): InducementPortraitView {
  return configuredInducementSprite(
    teamId,
    position,
    glyph,
    (exactTeamId, positionId) => playerSpriteAsset(exactTeamId, positionId)?.url,
    resolveCached,
  );
}
