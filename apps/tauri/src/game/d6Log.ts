import { isD6FaceValue, type D6FaceValue } from '@fumbbl40k/ffb-pitch';

export interface D6LogToken {
  index: number;
  value: D6FaceValue;
  kind: 'roll' | 'target';
}

export type D6LogPart =
  | { text: string; face?: never; kind?: never }
  | { text?: never; face: D6FaceValue; kind: D6LogToken['kind'] };

export type D6RequirementPart =
  | { text: string; face?: never; label?: never }
  | { text?: never; face: D6FaceValue; label: string };

const DICE_REPORT_IDS = new Set([
  'cheeringFans',
  'dedicatedFans',
  'defectingPlayers',
  'kickoffDodgySnack',
  'kickoffPitchInvasion',
  'kickoffResult',
  'kickoffScatter',
  'kickoffThrowARock',
  'passDeviate',
  'penaltyShootout',
  // Row26 (owner sighting 08-17, game 866): ReportReferee is a NoDiceReport (ffb-common
  // report/mixed/ReportReferee.java:19) — it never carries a roll, so it was silently
  // excluded from the default (non-debug) log despite always rendering upstream.
  'referee',
  'spectators',
  'swoopPlayer',
  'throwIn',
]);

/** Matches received reports that belong in the non-debug dice log. */
export function reportCarriesDisplayedDice(report: Record<string, unknown>): boolean {
  if (/roll/i.test(String(report.reportId ?? ''))) return true;
  if (DICE_REPORT_IDS.has(String(report.reportId ?? ''))) return true;
  if (report.reportId === 'turnEnd') {
    return (Array.isArray(report.knockoutRecoveryArray) && report.knockoutRecoveryArray.length > 0)
      || (Array.isArray(report.heatExhaustionArray) && report.heatExhaustionArray.length > 0);
  }
  return ['roll', 'blockRoll', 'dodgeRoll', 'armourRoll', 'injuryRoll', 'weatherRoll', 'dedicatedFansRoll', 'coinThrowHeads']
    .some((key) => key in report);
}

export function d6LogParts(entry: { text: string; d6?: readonly D6LogToken[] }): D6LogPart[] {
  const tokens = [...(entry.d6 ?? [])]
    .filter((token) => Number.isInteger(token.index) && token.index >= 0 && token.index < entry.text.length)
    .sort((a, b) => a.index - b.index);
  if (tokens.length === 0) return [{ text: entry.text }];

  const parts: D6LogPart[] = [];
  let cursor = 0;
  for (const token of tokens) {
    if (token.index < cursor || entry.text[token.index] !== String(token.value)) continue;
    if (token.index > cursor) parts.push({ text: entry.text.slice(cursor, token.index) });
    parts.push({ face: token.value, kind: token.kind });
    cursor = token.index + 1;
  }
  if (cursor < entry.text.length) parts.push({ text: entry.text.slice(cursor) });
  return parts.length ? parts : [{ text: entry.text }];
}

/** Parses only the renderer's controlled single-D6 target vocabulary. */
export function d6RequirementParts(text: string): D6RequirementPart[] {
  const parts: D6RequirementPart[] = [];
  const target = /\b(PASS|CATCH|HAND) ([1-6])\+/g;
  let cursor = 0;
  for (let match = target.exec(text); match; match = target.exec(text)) {
    if (match.index > cursor) parts.push({ text: text.slice(cursor, match.index) });
    const label = match[1] as 'PASS' | 'CATCH' | 'HAND';
    parts.push({ text: `${label} ` });
    parts.push({ face: Number(match[2]) as D6FaceValue, label: `${label} needs ${match[2]}` });
    parts.push({ text: '+' });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor) });
  return parts.length ? parts : [{ text }];
}

/** Returns a single-D6 reroll target; legacy Tentacles/Shadowing use a 2D6 total. */
export function d6RerollRequirement(
  value: unknown,
  rulesVersion: unknown,
  reRolledAction: unknown,
): D6FaceValue | undefined {
  if (!isD6FaceValue(value)) return undefined;
  if (!rerollUsesSingleD6Display(rulesVersion, reRolledAction)) return undefined;
  return value;
}

function rerollUsesSingleD6Display(rulesVersion: unknown, reRolledAction: unknown): boolean {
  return !/tentacles|shadowing/i.test(String(reRolledAction ?? ''))
    || rulesVersion === 'BB2020'
    || rulesVersion === 'BB2025';
}

/** Suppresses a stale scalar cache for legacy rerolls whose authoritative result is 2D6. */
export function d6RerollRoll(
  value: unknown,
  rulesVersion: unknown,
  reRolledAction: unknown,
): D6FaceValue | undefined {
  if (!isD6FaceValue(value)) return undefined;
  if (!rerollUsesSingleD6Display(rulesVersion, reRolledAction)) return undefined;
  return value;
}

/** Resolves a dialog-owned D6 target without leaking an incompatible cached target. */
export function d6RerollNeeded(
  dialogValue: unknown,
  cachedValue: unknown,
  rulesVersion: unknown,
  reRolledAction: unknown,
  thresholdless: boolean,
): D6FaceValue | undefined {
  if (thresholdless || !rerollUsesSingleD6Display(rulesVersion, reRolledAction)) return undefined;
  return d6RerollRequirement(dialogValue, rulesVersion, reRolledAction)
    ?? (isD6FaceValue(cachedValue) ? cachedValue : undefined);
}
