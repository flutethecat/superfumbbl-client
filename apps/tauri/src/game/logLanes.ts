export type LogLane = 'match' | 'connection';
export interface OrderedLogRow<T> { entry: T; order: number; receivedWallAt: number }
export interface LogLanes<T> { match: OrderedLogRow<T>[]; connection: OrderedLogRow<T>[] }
export const createLogLanes = <T>(): LogLanes<T> => ({ match: [], connection: [] });

/** Both owners are bounded independently; replacing the cursor must never erase live chat/notices. */
export function appendLogLane<T>(lanes: LogLanes<T>, owner: LogLane, row: OrderedLogRow<T>, limit = 400): void {
  lanes[owner].push(row);
  if (lanes[owner].length > limit) lanes[owner].splice(0, lanes[owner].length - limit);
}
export function replaceMatchLogLane<T>(lanes: LogLanes<T>, rows: readonly OrderedLogRow<T>[], limit = 400): void {
  lanes.match = rows.slice(-limit);
}
export function composeLogLanes<T>(lanes: LogLanes<T>, limit = 400): T[] {
  return [...lanes.match, ...lanes.connection].sort((a, b) => a.order - b.order).slice(-limit).map((row) => row.entry);
}
