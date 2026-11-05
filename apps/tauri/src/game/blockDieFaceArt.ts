import { reactive } from 'vue';
import { blockDieLogSymbol, isBlockDieFaceValue, type BlockDieLogSymbol } from './blockDieLog';
import { BLOCK_STAMP_FACE_INDEX } from './blockResultStampArt';
import { settings, type AppSettings } from './settings';

export type BlockDiceFamily = AppSettings['blockDiceFamily'];

// The client's block-die face art (the 64 px content-trimmed faces the log draws, see BlockDieFace.vue), by face
// value 1..6. Owner 10-01 (S71): the end-game Block dice chart labels its columns with these faces.
// Owner 10-06: one set per bundled block-dice family — 'krisb' = Kristofer Bengtsson's faces; owner 11-04: 'fumbbl' =
// WhatBall's FUMBBL dice (the symbol with its dark rim, nearest-neighbour 2x; scripts/gen-fumbbl-block-dice.py).
export const BLOCK_DIE_FACE_SYMBOL_URLS: Readonly<Record<BlockDiceFamily, Readonly<Record<BlockDieLogSymbol, string>>>> = {
  default: {
    'attacker-down': new URL('../assets/blockdice-log/attacker-down-64.png', import.meta.url).href,
    'both-down': new URL('../assets/blockdice-log/both-down-64.png', import.meta.url).href,
    push: new URL('../assets/blockdice-log/push-64.png', import.meta.url).href,
    'defender-stumbles': new URL('../assets/blockdice-log/defender-stumbles-64.png', import.meta.url).href,
    pow: new URL('../assets/blockdice-log/pow-64.png', import.meta.url).href,
  },
  krisb: {
    'attacker-down': new URL('../assets/blockdice-log-krisb/attacker-down-64.png', import.meta.url).href,
    'both-down': new URL('../assets/blockdice-log-krisb/both-down-64.png', import.meta.url).href,
    push: new URL('../assets/blockdice-log-krisb/push-64.png', import.meta.url).href,
    'defender-stumbles': new URL('../assets/blockdice-log-krisb/defender-stumbles-64.png', import.meta.url).href,
    pow: new URL('../assets/blockdice-log-krisb/pow-64.png', import.meta.url).href,
  },
  fumbbl: {
    'attacker-down': new URL('../assets/blockdice-log-fumbbl/attacker-down-64.png', import.meta.url).href,
    'both-down': new URL('../assets/blockdice-log-fumbbl/both-down-64.png', import.meta.url).href,
    push: new URL('../assets/blockdice-log-fumbbl/push-64.png', import.meta.url).href,
    'defender-stumbles': new URL('../assets/blockdice-log-fumbbl/defender-stumbles-64.png', import.meta.url).href,
    pow: new URL('../assets/blockdice-log-fumbbl/pow-64.png', import.meta.url).href,
  },
};

/** The BUNDLED 64 px face image for a block-die symbol in a family (an unknown family reads as 'default'). Never a
 *  pack face: the roster RIP skull and the fallback of a broken pack image read this. */
export function blockDieSymbolUrl(symbol: BlockDieLogSymbol, family: BlockDiceFamily = settings.blockDiceFamily): string {
  return (BLOCK_DIE_FACE_SYMBOL_URLS[family] ?? BLOCK_DIE_FACE_SYMBOL_URLS.default)[symbol];
}

/** The face image for a block die value (1 = attacker down … 6 = pow; 3 and 4 are both push); null when not a face.
 *  The family defaults to the live `settings.blockDiceFamily` (reactive when read during a render). */
export function blockDieFaceUrl(value: number, family: BlockDiceFamily = settings.blockDiceFamily): string | null {
  return isBlockDieFaceValue(value) ? blockDieSymbolUrl(blockDieLogSymbol(value), family) : null;
}

// Owner 10-10 ("let's connect log line and end of game dice stats to the dice faces"): the small DOM faces - the
// log-line dice (BlockDieFace.vue) and the end-game Block dice chart (PostGamePanel.vue) - follow the PACK-bound
// faces too, resolved the way the block choice card resolves them: the pack face of that face first (user files,
// else the assigned block-dice pack), else the bundled symbol those surfaces have always drawn.
// The pack layer is published here by assetMods.publishBlockDicePackFaces - the same call, with the same per-face
// urls, that feeds PitchRenderer.setBlockFaceSources (the card / 3D die / pitch) - and it is reactive, so an open log
// or Dice pane follows a pack change without a reload. The bindings are the LOCAL viewer's (spectator / replay too).
const packFaces = reactive({
  /** Tumble order [skull, bothdown, push, powpush, pow]; null = no pack binds that face. */
  urls: [null, null, null, null, null] as (string | null)[],
  /** Pack urls whose image failed to load in the DOM this session: those faces draw the bundled symbol. */
  failed: [] as string[],
});

/** Publish the pack-bound face urls (tumble order). Every publish forgets earlier load failures. */
export function setBlockDiePackFaceUrls(urls: readonly (string | null | undefined)[]): void {
  packFaces.urls = [0, 1, 2, 3, 4].map((index) => urls[index] || null);
  packFaces.failed = [];
}

/** A pack face image failed to load (an <img> / <image> error event): fall back to the bundled symbol for it. */
export function markBlockDiePackFaceFailed(url: string): void {
  if (url && !packFaces.failed.includes(url)) packFaces.failed.push(url);
}

export interface BlockDieDomArt {
  url: string;
  /** `url` is a pack face: a full die image (tile and all), any size - drawn contained, as supplied (the block
   *  die surface / family settings do not restyle it). False = the bundled 64 px content-trimmed symbol. */
  pack: boolean;
}

/** The small DOM art of a block-die symbol: the pack face of that face, else the bundled symbol of the family.
 *  Both Push values share the push face; Stumble = the powpush face; Pow = the pow face (as on the choice card). */
export function blockDieSymbolArt(symbol: BlockDieLogSymbol, family: BlockDiceFamily = settings.blockDiceFamily): BlockDieDomArt {
  const pack = packFaces.urls[BLOCK_STAMP_FACE_INDEX[symbol] ?? -1];
  if (pack && !packFaces.failed.includes(pack)) return { url: pack, pack: true };
  return { url: blockDieSymbolUrl(symbol, family), pack: false };
}

/** The small DOM art for a block die value (1..6); null when not a face. */
export function blockDieFaceArt(value: number, family: BlockDiceFamily = settings.blockDiceFamily): BlockDieDomArt | null {
  return isBlockDieFaceValue(value) ? blockDieSymbolArt(blockDieLogSymbol(value), family) : null;
}
