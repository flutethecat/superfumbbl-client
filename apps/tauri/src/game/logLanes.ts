export type LogLane = 'match' | 'connection' | 'chat';
export interface OrderedLogRow<T> { entry: T; order: number; receivedWallAt: number }
export interface LogLanes<T> { match: OrderedLogRow<T>[]; connection: OrderedLogRow<T>[]; chat: OrderedLogRow<T>[] }
export const createLogLanes = <T>(): LogLanes<T> => ({ match: [], connection: [], chat: [] });

/** Match reports and client/connection notices: a ring per owner. */
export const LOG_LANE_LIMIT = 400;
/** RickWreckless 10-10: chat has its OWN ring. It used to share the 400-line ring with the client's own notices
 *  (one "play: STEP" line per square walked, hidden from the Log tab), so about twenty minutes of play pushed every
 *  earlier chat line out. A whole game's chat fits well inside this; the newest lines are never the ones dropped. */
export const CHAT_LANE_LIMIT = 2000;
const laneLimit = (owner: LogLane): number => owner === 'chat' ? CHAT_LANE_LIMIT : LOG_LANE_LIMIT;

/** Every owner is bounded independently; replacing the cursor must never erase live chat/notices. */
export function appendLogLane<T>(lanes: LogLanes<T>, owner: LogLane, row: OrderedLogRow<T>, limit = laneLimit(owner)): void {
  lanes[owner].push(row);
  if (lanes[owner].length > limit) lanes[owner].splice(0, lanes[owner].length - limit);
}
export function replaceMatchLogLane<T>(lanes: LogLanes<T>, rows: readonly OrderedLogRow<T>[], limit = LOG_LANE_LIMIT): void {
  lanes.match = rows.slice(-limit);
}
/** Put chat rows kept from an earlier connection to the same game back in front of whatever arrived since. */
export function restoreChatLane<T>(lanes: LogLanes<T>, rows: readonly OrderedLogRow<T>[], limit = CHAT_LANE_LIMIT): void {
  lanes.chat = [...rows, ...lanes.chat].sort((a, b) => a.order - b.order).slice(-limit);
}
/** One list in receive order. Each owner contributes at most its own ring, so a busy owner (the client's notices)
 *  can no longer evict another owner's lines (chat, match reports) from the composed log. */
export function composeLogLanes<T>(lanes: { match: readonly OrderedLogRow<T>[]; connection: readonly OrderedLogRow<T>[]; chat?: readonly OrderedLogRow<T>[] }, limit = LOG_LANE_LIMIT, chatLimit = CHAT_LANE_LIMIT): T[] {
  return [...lanes.match.slice(-limit), ...lanes.connection.slice(-limit), ...(lanes.chat ?? []).slice(-chatLimit)]
    .sort((a, b) => a.order - b.order).map((row) => row.entry);
}
