/**
 * End-game player picks that live in the end-game pane, never on the pitch. Both are armed on the generic
 * `state.playerPick` (key `pchoice:<mode>:...`); the view keeps them off the renderer, the pick bar, the roster
 * fallback and the gold-aura flash through these pure key checks.
 */

export const isMvpPickKey = (key: string | undefined | null): boolean =>
  !!key && key.startsWith('pchoice:mvp');

export const isAssignTouchdownPickKey = (key: string | undefined | null): boolean =>
  !!key && key.startsWith('pchoice:assignTouchdown');

/** True for a pick answered from the end-game pane: nothing of it is drawn on the pitch and a pitch click cannot answer it. */
export const isPickKeptOffPitch = (key: string | undefined | null): boolean =>
  isMvpPickKey(key) || isAssignTouchdownPickKey(key);
