export type StuckPlayerChoiceAnswer = { playerIds: string[] } | { refuse: string };

/** Build a legal /stuck response using only the server-authoritative choice parameters. */
export function buildStuckPlayerChoiceIds(
  dp: { playerIds?: string[]; minSelects?: number } | undefined,
): StuckPlayerChoiceAnswer {
  const rawMinSelects = dp?.minSelects;
  const minSelects = typeof rawMinSelects === 'number' && Number.isFinite(rawMinSelects) && rawMinSelects > 0
    ? Math.ceil(rawMinSelects)
    : 0;

  if (minSelects === 0) return { playerIds: [] };

  const offered: string[] = [];
  const seen = new Set<string>();
  for (const id of dp?.playerIds ?? []) {
    if (typeof id !== 'string' || id.trim() === '' || seen.has(id)) continue;
    seen.add(id);
    offered.push(id);
  }

  if (offered.length < minSelects) {
    return { refuse: `playerChoice needs ${minSelects} pick(s) but the server offered ${offered.length}` };
  }

  return { playerIds: offered.slice(0, minSelects) };
}
