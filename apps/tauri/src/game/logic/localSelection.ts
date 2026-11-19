// Owner 10-15 (reported by FUMBBL upstream / Christer): DECLARE ON ACTION, NOT ON CLICK.
//
// Upstream's client sends `clientActingPlayer` only when the coach commits an action. A left-click on an own player in
// SELECT_PLAYER returns InteractionResult.selectAction(...) and sends nothing (ffb-client-logic bb2025
// SelectLogicModule.playerInteraction:46-52); the declaration goes out of performAvailableAction (:100-245, e.g. MOVE
// :127-128, BLOCK :103-104, BLITZ :121-122, HAND_OVER :148-149, PASS :155-156) when an action is picked. Selection is
// client-local; there is no "select" command on the wire.
//
// Order 66 used to declare `move` on the click itself (the left-click auto-Move shortcut), so every Block / Pass /
// Hand-off showed up upstream and in every other client's log as "starts a Move Action" followed by the real action.
// The owner ruled: match upstream exactly. A left-click now SELECTS the player client-side only (the selection ring,
// the reach overlay and the route planner keep working off the client-computed reach); the declaration is sent when
// the coach commits (the first confirmed walk, a block / blitz target, a rail pick).
//
// Pure helpers only: the view owns the selection ref and the renderer; the store owns every send.

import type { GameJson } from '@fumbbl40k/ffb-protocol';
import { deriveClientState, type ClientStateContext } from './clientStateMachine';
import { availableActions, movesRandomly, normSquare, type CoachAction } from './availableActions';
import { friendlyActivationSwitchDisposition, requiresBlitzEndConfirmation } from './order66Interaction';

const PLAYER_BASE_STANDING = 1;
const PLAYER_BASE_PRONE = 3;
const PLAYER_FLAG_ACTIVE = 0x100;

function serverActingId(game: GameJson): string {
  return String((game.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? '');
}

/** The selected player can take the client-local Move surface: on the pitch, standing, not a Ball & Chain mover
 *  (its aim squares are server-published only after a declaration), and the server-derived declare list offers an
 *  enabled Move. Anything else keeps upstream's plain answer to the click: the action menu. */
export function localSelectionCanWalk(game: GameJson, ctx: ClientStateContext, playerId: string): boolean {
  if (!playerId) return false;
  const data = (game.fieldModel?.playerDataArray ?? []).find((d) => (d as { playerId?: string }).playerId === playerId) as
    { playerCoordinate?: unknown; playerState?: number } | undefined;
  if (!data || !normSquare(data.playerCoordinate)) return false;
  if (((data.playerState ?? 0) & 0xff) !== PLAYER_BASE_STANDING) return false;
  if (movesRandomly(game, playerId)) return false;
  return availableActions(game, ctx, playerId).some((a) => a.kind === 'declare' && a.action === 'move' && a.enabled);
}

export interface LocalMoverInput {
  /** The view's client-local selection (set by a left-click, never sent). */
  localId: string | null;
  playing: boolean;
  myTurn: boolean;
  controls: (playerId: string) => boolean;
  /** A declaration (or a plan that will send one) is already on its way: the local surface stands down until the
   *  server's echo hands the activation to its acting player, so a second commit cannot declare again. */
  busy?: boolean;
}

/** The locally selected (undeclared) mover, or '' when there is none. Valid only while the server has NO acting player
 *  and derives SELECT_PLAYER for this seat: the moment a declaration is echoed the server's acting player owns every
 *  surface again, exactly as before. */
export function localMoverId(game: GameJson | null | undefined, ctx: ClientStateContext, input: LocalMoverInput): string {
  const id = input.localId ?? '';
  if (!id || !game || !input.playing || !input.myTurn || input.busy) return '';
  if (serverActingId(game)) return '';
  if (deriveClientState(game, ctx) !== 'SELECT_PLAYER') return '';
  if (!input.controls(id)) return '';
  return localSelectionCanWalk(game, ctx, id) ? id : '';
}

/** A plain left-click on one of MY players while the server has no acting player (SELECT_PLAYER):
 *  - 'select': select it client-side (no wire), the Move surface arms off the client reach;
 *  - 'menu':   the player is already the local selection (a second click), or it cannot walk (prone, Ball & Chain,
 *              no Move offered): open the action menu, as upstream's click does. Never a send. */
export function selectPlayerLeftClick(
  game: GameJson, ctx: ClientStateContext, playerId: string, currentLocalId: string | null,
): 'select' | 'menu' {
  if (currentLocalId === playerId) return 'menu';
  return localSelectionCanWalk(game, ctx, playerId) ? 'select' : 'menu';
}

/** The only sender a committed local walk needs. */
export interface LocalWalkWire {
  startPlan(input: { playerId: string; actKind: 'move'; route: [number, number][] }): boolean;
}

/** The coach confirmed a walk for the local selection: ONE planner plan, which sends the one
 *  clientActingPlayer{move} (upstream's Move pick, SelectLogicModule:127-128, literal leaping=false) and then walks the
 *  route square by square on the server's echoes (the existing ack-gated drip and roll-beat holds). */
export function commitLocalWalk(wire: LocalWalkWire, playerId: string, route: [number, number][]): boolean {
  if (!playerId || route.length === 0) return false;
  return wire.startPlan({ playerId, actKind: 'move', route: route.map((s) => [s[0], s[1]] as [number, number]) });
}

/** Owner 10-15 decision (prone teammate while ours has an untouched Move declared): the click deselects the declared player
 *  LOCALLY and opens the prone player's own action menu (Stand Up, Stand Up and Blitz, ...); the click sends nothing.
 *  A pick then follows the switch rule (one cancel, the server's clear, the pick's declaration); a dismissal leaves the
 *  declaration live and the view shows that player again. Returns the menu rows, or null when the rule does not apply:
 *  not my turn, no declared player of mine, the clicked player is not my prone active player, or the declared player has
 *  already acted / holds a Blitz or a confirm-gated Foul (those keep their own End route). The rows are the clicked
 *  player's server-derived select-state list (the projection only removes the acting player, it predicts nothing). */
export function proneTeammateSwitchMenu(
  game: GameJson | null | undefined,
  ctx: ClientStateContext,
  clickedId: string,
  controls: (playerId: string) => boolean,
  opts: { foulConfirm: boolean },
): CoachAction[] | null {
  if (!game) return null;
  const actingId = serverActingId(game);
  if (!actingId || actingId === clickedId || !controls(actingId) || !controls(clickedId)) return null;
  const data = (game.fieldModel?.playerDataArray ?? []).find((d) => (d as { playerId?: string }).playerId === clickedId) as
    { playerState?: number; playerCoordinate?: unknown } | undefined;
  const state = Number(data?.playerState ?? 0);
  if ((state & 0xff) !== PLAYER_BASE_PRONE || (state & PLAYER_FLAG_ACTIVE) === 0 || !normSquare(data?.playerCoordinate)) return null;
  const clientState = deriveClientState(game, ctx);
  if (requiresBlitzEndConfirmation(clientState) || (clientState === 'FOUL' && opts.foulConfirm)) return null;
  // Astra r9 F3: the owner's decision covers an untouched MOVE - the only declared action the switch's declaration
  // path accepts from another player (declareAction refuses a switch away from any other action: End first).
  if (String((game.actingPlayer as { playerAction?: string | null } | undefined)?.playerAction ?? '') !== 'move') return null;
  // Untouched? Ask the shared classifier about the same player as if it were standing (the classifier only accepts a
  // standing destination; the acting player's consumption is what decides refund vs end).
  const standingProjection = {
    ...game,
    fieldModel: {
      ...game.fieldModel,
      playerDataArray: (game.fieldModel?.playerDataArray ?? []).map((d) => ((d as { playerId?: string }).playerId === clickedId
        ? { ...d, playerState: (state & ~0xff) | PLAYER_BASE_STANDING } : d)),
    },
  } as GameJson;
  if (friendlyActivationSwitchDisposition(standingProjection, { ...ctx, friendlyPlayerSwitch: true }, clickedId) !== 'refund') return null;
  const selectProjection = { ...game, actingPlayer: { ...(game.actingPlayer ?? {}), playerId: null, playerAction: null, currentMove: 0 } } as GameJson;
  const rows = availableActions(selectProjection, ctx, clickedId).filter((a) => a.kind === 'declare');
  return rows.length > 0 ? rows : null;
}
