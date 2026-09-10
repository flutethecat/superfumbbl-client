import { Assets, Texture } from 'pixi.js';

/**
 * Original placeholder sprite manifest. The installer deliberately ships only
 * this generated base + white-jersey set; upstream player art is supplied only
 * by an explicitly installed asset pack.
 */

export interface SpritePair {
  base: Texture;
  /** White-jersey overlay for team tinting; absent for full-color sprites. */
  jersey?: Texture;
}

interface ManifestEntry {
  base: string;
  jersey?: string;
  /** 'linear' for painterly HD-2D art; nearest (default) for pixel art. */
  smooth?: boolean;
}

const MANIFEST: Record<string, ManifestEntry> = {
  human: { base: 'human_base', jersey: 'human_jersey' },
  orc: { base: 'orc_base', jersey: 'orc_jersey' },
  elf: { base: 'elf_base', jersey: 'elf_jersey' },
  dwarf: { base: 'dwarf_base', jersey: 'dwarf_jersey' },
  skaven: { base: 'skaven_base', jersey: 'skaven_jersey' },
  ogre: { base: 'ogre_base', jersey: 'ogre_jersey' },
  generic: { base: 'generic_base', jersey: 'generic_jersey' },
};

export const SPRITE_RACES = Object.keys(MANIFEST);

const textures = new Map<string, SpritePair>();

const SPRITE_URLS: Record<string, string> = {
  human_base: new URL('../assets/sprites/human_base.png', import.meta.url).href,
  human_jersey: new URL('../assets/sprites/human_jersey.png', import.meta.url).href,
  orc_base: new URL('../assets/sprites/orc_base.png', import.meta.url).href,
  orc_jersey: new URL('../assets/sprites/orc_jersey.png', import.meta.url).href,
  elf_base: new URL('../assets/sprites/elf_base.png', import.meta.url).href,
  elf_jersey: new URL('../assets/sprites/elf_jersey.png', import.meta.url).href,
  dwarf_base: new URL('../assets/sprites/dwarf_base.png', import.meta.url).href,
  dwarf_jersey: new URL('../assets/sprites/dwarf_jersey.png', import.meta.url).href,
  skaven_base: new URL('../assets/sprites/skaven_base.png', import.meta.url).href,
  skaven_jersey: new URL('../assets/sprites/skaven_jersey.png', import.meta.url).href,
  ogre_base: new URL('../assets/sprites/ogre_base.png', import.meta.url).href,
  ogre_jersey: new URL('../assets/sprites/ogre_jersey.png', import.meta.url).href,
  generic_base: new URL('../assets/sprites/generic_base.png', import.meta.url).href,
  generic_jersey: new URL('../assets/sprites/generic_jersey.png', import.meta.url).href,
};

function spriteUrl(name: string): string {
  const url = SPRITE_URLS[name];
  if (!url) throw new Error(`Unknown placeholder sprite: ${name}`);
  return url;
}

export async function loadSprites(): Promise<void> {
  await Promise.all(
    Object.entries(MANIFEST).map(async ([race, entry]) => {
      const scaleMode = entry.smooth ? 'linear' : 'nearest';
      const base = await Assets.load<Texture>(spriteUrl(entry.base));
      base.source.scaleMode = scaleMode;
      const pair: SpritePair = { base };
      if (entry.jersey) {
        pair.jersey = await Assets.load<Texture>(spriteUrl(entry.jersey));
        pair.jersey.source.scaleMode = scaleMode;
      }
      textures.set(race, pair);
    }),
  );
}

/** Positions that override the team race (big guys on any roster). */
const POSITION_OVERRIDES = ['ogre'];

/** Picks a sprite: big-guy position overrides first, then team race, then generic. */
export function spriteFor(positionId: string, teamRace: string): SpritePair | undefined {
  const position = positionId.toLowerCase();
  const race = teamRace.toLowerCase();
  for (const key of POSITION_OVERRIDES) {
    if (position.includes(key)) return textures.get(key);
  }
  for (const key of SPRITE_RACES) {
    if (key !== 'generic' && race.includes(key)) return textures.get(key);
  }
  return textures.get('generic');
}
