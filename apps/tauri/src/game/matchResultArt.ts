// Owner 10-01 (S77): the Play blade's recent-game result is the WIN / LOSS / DRAW label art (symbol + word), not a
// letter. Each label is exported at 1x / 2x / 3x of its CSS size (Lanczos from the trimmed master, see
// assets/match-results/PROVENANCE.json) so the browser picks a pre-filtered image for the display density instead of
// minifying one big one. The three labels have different symbol-to-letter proportions, so their CSS sizes differ:
// they are sized so the LETTERS share one height (40 CSS px) - never stretch them to one box.
// Owner 10-01 (S78, approved final art: WIN v4 / LOSS v2 / DRAW v4). S79: the IMAGE is centred (over the score's dash);
// centring the lettering alone read as off-centre, so `shiftX` is recorded but NOT applied by the Play blade.
export type MatchResult = 'W' | 'L' | 'D';
export interface MatchResultArt {
  alt: string; src: string; srcset: string; width: number; height: number;
  /** Centre of the lettering, CSS px from the image's left edge. */
  textCenterX: number;
  /** translateX (CSS px) that puts the lettering's centre where the image's centre would be. */
  shiftX: number;
}

// Static URLs (one literal per file) so the bundler ships exactly these nine images.
const FILES: Record<string, [string, string, string]> = {
  win: [new URL('../assets/match-results/win-label-1x.png', import.meta.url).href, new URL('../assets/match-results/win-label-2x.png', import.meta.url).href, new URL('../assets/match-results/win-label-3x.png', import.meta.url).href],
  loss: [new URL('../assets/match-results/loss-label-1x.png', import.meta.url).href, new URL('../assets/match-results/loss-label-2x.png', import.meta.url).href, new URL('../assets/match-results/loss-label-3x.png', import.meta.url).href],
  draw: [new URL('../assets/match-results/draw-label-1x.png', import.meta.url).href, new URL('../assets/match-results/draw-label-2x.png', import.meta.url).href, new URL('../assets/match-results/draw-label-3x.png', import.meta.url).href],
};
function art(stem: string, alt: string, width: number, height: number, textCenterX: number): MatchResultArt {
  const [x1, x2, x3] = FILES[stem]!;
  return { alt, src: x1, srcset: `${x1} 1x, ${x2} 2x, ${x3} 3x`, width, height, textCenterX, shiftX: Math.round((width / 2 - textCenterX) * 10) / 10 };
}

const ART: Record<MatchResult, MatchResultArt> = {
  W: art('win', 'Win', 157, 73, 117.3),
  L: art('loss', 'Loss', 170, 72, 125.1),
  D: art('draw', 'Draw', 186, 49, 140.3),
};

/** The label art for a result from the viewing coach's side (`resultLetter(myScore, opponentScore)`). */
export function matchResultArt(result: MatchResult): MatchResultArt { return ART[result]; }
