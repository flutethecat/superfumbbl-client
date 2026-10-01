// Owner 10-01 (S77): the Play blade's recent-game result is the WIN / LOSS / DRAW label art (symbol + word), not a
// letter. Each label is exported at 1x / 2x / 3x of its CSS size (Lanczos from the trimmed master, see
// assets/match-results/PROVENANCE.json) so the browser picks a pre-filtered image for the display density instead of
// minifying one big one. The three labels have different symbol-to-letter proportions, so their CSS sizes differ:
// they are sized so the LETTERS share one height (30 CSS px) - never stretch them to one box.
export type MatchResult = 'W' | 'L' | 'D';
export interface MatchResultArt { alt: string; src: string; srcset: string; width: number; height: number }

// Static URLs (one literal per file) so the bundler ships exactly these nine images.
const FILES: Record<string, [string, string, string]> = {
  win: [new URL('../assets/match-results/win-label-1x.png', import.meta.url).href, new URL('../assets/match-results/win-label-2x.png', import.meta.url).href, new URL('../assets/match-results/win-label-3x.png', import.meta.url).href],
  loss: [new URL('../assets/match-results/loss-label-1x.png', import.meta.url).href, new URL('../assets/match-results/loss-label-2x.png', import.meta.url).href, new URL('../assets/match-results/loss-label-3x.png', import.meta.url).href],
  draw: [new URL('../assets/match-results/draw-label-1x.png', import.meta.url).href, new URL('../assets/match-results/draw-label-2x.png', import.meta.url).href, new URL('../assets/match-results/draw-label-3x.png', import.meta.url).href],
};
function art(stem: string, alt: string, width: number, height: number): MatchResultArt {
  const [x1, x2, x3] = FILES[stem]!;
  return { alt, src: x1, srcset: `${x1} 1x, ${x2} 2x, ${x3} 3x`, width, height };
}

const ART: Record<MatchResult, MatchResultArt> = {
  W: art('win', 'Win', 129, 61),
  L: art('loss', 'Loss', 141, 68),
  D: art('draw', 'Draw', 146, 55),
};

/** The label art for a result from the viewing coach's side (`resultLetter(myScore, opponentScore)`). */
export function matchResultArt(result: MatchResult): MatchResultArt { return ART[result]; }
