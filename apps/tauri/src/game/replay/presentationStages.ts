/** A presentation-owned delay. Abort retires both the timer and its listener. */
export function waitPresentationStage(milliseconds: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  if (milliseconds <= 0) return Promise.resolve(true);
  return new Promise((resolve) => {
    const finish = (completed: boolean) => { clearTimeout(timer); signal.removeEventListener('abort', abort); resolve(completed); };
    const abort = () => finish(false);
    const timer = setTimeout(() => finish(true), milliseconds);
    signal.addEventListener('abort', abort, { once: true });
  });
}
export interface PresentationStage { delayBefore: number; present(): void }
/** No stage after cancellation may write to the view, even when its deadline has passed. */
export async function presentStages(stages: readonly PresentationStage[], signal: AbortSignal): Promise<boolean> {
  for (const stage of stages) {
    if (!await waitPresentationStage(stage.delayBefore, signal) || signal.aborted) return false;
    stage.present();
  }
  return !signal.aborted;
}
