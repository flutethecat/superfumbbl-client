export type BlockDieFaceValue = 1 | 2 | 3 | 4 | 5 | 6;

export type BlockDieLogSymbol = 'attacker-down' | 'both-down' | 'push' | 'defender-stumbles' | 'pow';

export interface BlockDieLogToken {
  index: number;
  value: BlockDieFaceValue;
  result: string;
}

export type BlockDieLogPart =
  | { text: string; blockFace?: never; result?: never }
  | { text?: never; blockFace: BlockDieFaceValue; result: string };

export function isBlockDieFaceValue(value: unknown): value is BlockDieFaceValue {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 6;
}

export function blockDieLogSymbol(value: BlockDieFaceValue): BlockDieLogSymbol {
  switch (value) {
    case 1: return 'attacker-down';
    case 2: return 'both-down';
    case 3:
    case 4: return 'push';
    case 5: return 'defender-stumbles';
    case 6: return 'pow';
  }
}

export function blockDieLogParts(entry: { text: string; blockDice?: readonly BlockDieLogToken[] }): BlockDieLogPart[] {
  const tokens = [...(entry.blockDice ?? [])]
    .filter((token) => Number.isInteger(token.index) && token.index >= 0 && token.result.length > 0)
    .sort((a, b) => a.index - b.index);
  if (tokens.length === 0) return [{ text: entry.text }];

  const parts: BlockDieLogPart[] = [];
  let cursor = 0;
  for (const token of tokens) {
    if (token.index < cursor || entry.text.slice(token.index, token.index + token.result.length) !== token.result) continue;
    if (token.index > cursor) parts.push({ text: entry.text.slice(cursor, token.index) });
    parts.push({ blockFace: token.value, result: token.result });
    cursor = token.index + token.result.length;
  }
  if (cursor < entry.text.length) parts.push({ text: entry.text.slice(cursor) });
  return parts.length ? parts : [{ text: entry.text }];
}
