import { reactiveSkillIconUrl } from './assetModUi';

export type PlayerOwnedSkillIconEntry = {
  player: { positionId: string };
  side: 'home' | 'away';
};

/** Player-owned prompts retain the wire addressee's exact position and actual team side. */
export function playerOwnedSkillIconUrl(
  skill: string,
  style: 'bb2' | 'bb3',
  entry: PlayerOwnedSkillIconEntry | null,
): string {
  return reactiveSkillIconUrl(skill, style, entry
    ? { positionId: entry.player.positionId, side: entry.side }
    : undefined);
}
