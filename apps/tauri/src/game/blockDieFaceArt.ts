import { blockDieLogSymbol, isBlockDieFaceValue, type BlockDieLogSymbol } from './blockDieLog';
import { settings, type AppSettings } from './settings';

export type BlockDiceFamily = AppSettings['blockDiceFamily'];

// The client's block-die face art (the 64 px content-trimmed faces the log draws, see BlockDieFace.vue), by face
// value 1..6. Owner 10-01 (S71): the end-game Block dice chart labels its columns with these faces.
// Owner 10-06: one set per bundled block-dice family — 'krisb' = Kristofer Bengtsson's faces.
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
};

/** The 64 px face image for a block-die symbol in a family (an unknown family reads as 'default'). */
export function blockDieSymbolUrl(symbol: BlockDieLogSymbol, family: BlockDiceFamily = settings.blockDiceFamily): string {
  return (BLOCK_DIE_FACE_SYMBOL_URLS[family] ?? BLOCK_DIE_FACE_SYMBOL_URLS.default)[symbol];
}

/** The face image for a block die value (1 = attacker down … 6 = pow; 3 and 4 are both push); null when not a face.
 *  The family defaults to the live `settings.blockDiceFamily` (reactive when read during a render). */
export function blockDieFaceUrl(value: number, family: BlockDiceFamily = settings.blockDiceFamily): string | null {
  return isBlockDieFaceValue(value) ? blockDieSymbolUrl(blockDieLogSymbol(value), family) : null;
}
