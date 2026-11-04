// Owner 11-03 (lane 3 review): the one half / turn label every game card shows ("Pre-kick", "H2 T7"). The Spectate
// blade (both styles) and the Modern Play blade's active-game cards share it. (The Retro Play rows keep their own
// label, game/fumbblPlayBlade.ts phaseLabel, so the Retro look stays exactly as it was.)
import { t } from '../i18n';

export function gameClockLabel(game: { half?: number | null; turn?: number | null }): string {
  return !game.half ? t('lmBlades.preKick') : t('spectateBrowser.text.hHalfTTurn', { half: game.half, turn: game.turn ?? 0 });
}
