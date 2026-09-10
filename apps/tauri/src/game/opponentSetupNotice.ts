export interface OpponentSetupNoticeContext {
  mode: 'play' | 'spectate' | 'replay';
  isPlaying: boolean;
  turnMode: string | null | undefined;
  myTurn: boolean;
}

/** The notice belongs only to a seated coach waiting on the opponent's normal setup. */
export function shouldShowOpponentSetupNotice(context: OpponentSetupNoticeContext): boolean {
  return context.mode === 'play'
    && context.isPlaying
    && context.turnMode === 'setup'
    && !context.myTurn;
}
