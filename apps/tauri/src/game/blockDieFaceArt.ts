import { blockDieLogSymbol, isBlockDieFaceValue, type BlockDieLogSymbol } from './blockDieLog';

// The client's block-die face art (the 64 px content-trimmed faces the log draws, see BlockDieFace.vue), by face
// value 1..6. Owner 10-01 (S71): the end-game Block dice chart labels its columns with these faces.
const symbolUrls: Record<BlockDieLogSymbol, string> = {
  'attacker-down': new URL('../assets/blockdice-log/attacker-down-64.png', import.meta.url).href,
  'both-down': new URL('../assets/blockdice-log/both-down-64.png', import.meta.url).href,
  push: new URL('../assets/blockdice-log/push-64.png', import.meta.url).href,
  'defender-stumbles': new URL('../assets/blockdice-log/defender-stumbles-64.png', import.meta.url).href,
  pow: new URL('../assets/blockdice-log/pow-64.png', import.meta.url).href,
};

/** The face image for a block die value (1 = attacker down … 6 = pow; 3 and 4 are both push); null when not a face. */
export function blockDieFaceUrl(value: number): string | null {
  return isBlockDieFaceValue(value) ? symbolUrls[blockDieLogSymbol(value)] : null;
}
