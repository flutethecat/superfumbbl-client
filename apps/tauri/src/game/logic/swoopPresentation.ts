import type { GameJson } from '@fumbbl40k/ffb-protocol';

export interface SwoopChoiceCopy {
  title: string;
  body: string;
  accept: string;
  decline: string;
  rulesVersion: 'BB2025' | 'legacy';
}

function rulesVersion(game: GameJson | null | undefined): string {
  return String(game?.gameOptions?.gameOptionArray
    ?.find((option) => option.gameOptionId === 'rulesVersion')?.gameOptionValue ?? '')
    .trim().toUpperCase();
}

/** Rules-scoped Swoop decision copy. BB2025 is the current/default ruleset and explicitly grants a reroll of
 * the Right Stuff landing test. Older rulesets keep neutral legacy copy rather than inheriting that guarantee. */
export function swoopChoiceCopy(
  game: GameJson | null | undefined,
  skill: unknown,
): SwoopChoiceCopy | null {
  if (String(skill ?? '').trim().toLowerCase() !== 'swoop') return null;
  const version = rulesVersion(game);
  if (version === 'BB2016' || version === 'BB2020') {
    return {
      title: 'Use Swoop?',
      body: 'Choose Swoop or continue with the normal scatter.',
      accept: 'Swoop',
      decline: 'Scatter Normally',
      rulesVersion: 'legacy',
    };
  }
  return {
    title: 'Use Swoop instead of scattering normally?',
    body: 'Swoop may reroll the Right Stuff landing test.',
    accept: 'Swoop',
    decline: 'Scatter Normally',
    rulesVersion: 'BB2025',
  };
}
