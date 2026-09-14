import type { GameJson } from '@fumbbl40k/ffb-protocol';

export interface BlitzProjection { id: string; side: boolean; turnKey: string; targetId: string; visible: boolean }
export function currentTurnKey(g: GameJson): string {
  return `${g.half ?? 0}:${g.turnDataHome?.turnNr ?? 0}:${g.turnDataAway?.turnNr ?? 0}:${g.homePlaying ? 'H' : 'A'}`;
}
export function selectedBlitzTargetId(g: GameJson): string {
  const target = g.fieldModel.targetSelectionState as { targetSelectionStatus?: unknown; playerId?: unknown } | null;
  return target && String(target.targetSelectionStatus ?? '') === 'SELECTED' ? String(target.playerId ?? '') : '';
}
export function reduceBlitzProjection(previous: BlitzProjection | null, game: GameJson, block: { attackerId: string | null; defenderId: string | null }): BlitzProjection | null {
  const turnKey = currentTurnKey(game);
  let marker = previous?.turnKey === turnKey ? { ...previous } : null;
  const actorId = String(game.actingPlayer?.playerId ?? '');
  const declaring = !!actorId && /blitz/i.test(String(game.actingPlayer?.playerAction ?? ''));
  if (declaring) marker = { id: actorId, side: game.teamHome.playerArray.some((p) => p.playerId === actorId), turnKey, targetId: marker?.targetId ?? '', visible: false };
  if (!marker) return null;
  const target = selectedBlitzTargetId(game);
  if (actorId === marker.id && target) marker.targetId = target;
  else if (block.attackerId === marker.id && block.defenderId) marker.targetId = block.defenderId;
  const used = !!(marker.side ? game.turnDataHome?.blitzUsed : game.turnDataAway?.blitzUsed);
  marker.visible = used || (actorId === marker.id && declaring && !!target);
  return marker;
}
