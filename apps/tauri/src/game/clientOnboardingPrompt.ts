/**
 * Owner 11-06 (client onboarding): the ONE switch for the in-client welcome step (components/ClientOnboardingDialog.vue,
 * mounted once by App.vue). Any surface that meets config-web's onboarding gate (a 428 "Complete your profile first.",
 * see configWebErrors.ts isOnboardingRequired) or that wants the coach to review the privacy notice asks for it here,
 * instead of showing a dead-end error. Vue only, no other imports: the fork routes (forkChallenge.ts) and the
 * settings card both import it without pulling the account API in.
 *
 * Nothing is retried or re-sent automatically after the coach accepts (no client auto-answer): the requester's
 * `onComplete` only gets to show a "Profile complete" line; the coach presses Send again.
 */
import { reactive } from 'vue';

export type ClientOnboardingReason = 'gate' | 'signIn' | 'review';

export interface ClientOnboardingRequest {
  /** gate = a config-web call answered the onboarding 428; signIn = right after an account sign-in / restore whose
   *  view says `needed`; review = Settings > Account "Review privacy notice". */
  reason?: ClientOnboardingReason;
  /** The coach config-web gated: the one the refused call named (the challenge / matchstatus `coach`), or the signed-in
   *  account for signIn / review. The dialog loads and submits only while the held session IS this coach (Sol r1 P2);
   *  absent = the gate acted for the session's own coach (fork registration is gated on the session, not its query). */
  coach?: string;
  /** Runs once if the coach completes the step (never on Esc / close). */
  onComplete?: () => void;
}

export const clientOnboarding = reactive({
  open: false,
  reason: 'gate' as ClientOnboardingReason,
  /** See ClientOnboardingRequest.coach ('' = the session's own coach). */
  coach: '',
  /** Bumped on every request, so an open dialog reloads when asked again. */
  generation: 0,
});

let completeListeners: Array<() => void> = [];

export function requestClientOnboarding(request: ClientOnboardingRequest = {}): void {
  if (request.onComplete) completeListeners.push(request.onComplete);
  // A gate hit while the dialog is already open for another reason keeps the open one (same step, same form).
  if (!clientOnboarding.open) {
    clientOnboarding.reason = request.reason ?? 'gate';
    clientOnboarding.coach = request.coach?.trim() ?? '';
  } else if (request.coach?.trim()) {
    clientOnboarding.coach = request.coach.trim(); // the latest gated coach wins (the dialog reloads for it)
  }
  clientOnboarding.open = true;
  clientOnboarding.generation += 1;
}

/** The dialog closed: `completed` = the server accepted the submission (the listeners run once, then are dropped). */
export function finishClientOnboarding(completed: boolean): void {
  const listeners = completeListeners;
  completeListeners = [];
  clientOnboarding.open = false;
  if (!completed) return;
  for (const listener of listeners) {
    try { listener(); } catch { /* a requester's notice must never break the close */ }
  }
}

/** Tests only. */
export function resetClientOnboarding(): void {
  completeListeners = [];
  clientOnboarding.open = false;
  clientOnboarding.reason = 'gate';
  clientOnboarding.coach = '';
  clientOnboarding.generation = 0;
}
