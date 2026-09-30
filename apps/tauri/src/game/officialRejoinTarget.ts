/**
 * S44 round 3: the ONE non-secret join target of an official FUMBBL game, so a dropped game can be rejoined by a click.
 * It holds no JNLP token and no password, and NO COPY of the password or anything derived from it (no hash, no length).
 * It is bound to the account it was made for (the exact stored coach string, ASCII case aside, no trimming), and it is
 * cleared whenever it could belong to something else: any other join starting (fork, official, spectate, replay), the
 * coach leaving on purpose, the game finishing, the stored coach name changing to another account, or ANY change of the
 * stored FUMBBL password.
 *
 * How a password change is noticed: a `watchEffect` that merely READS `settings.password`. Vue re-runs it whenever the
 * field is written with a different value (the v-model, the keychain hydrate, the file loader all write this one
 * reactive field), and the effect stores nothing: the signal is "it ran again", not a value.
 */
import { watchEffect } from 'vue';
import { equalsIgnoringAsciiCase } from './officialCoachName';
import { settings } from './settings';

export interface OfficialJoinTarget {
  url: string;
  compression: boolean;
  /** the exact spelling put on the wire; also the account this target was made for */
  coach: string;
  gameId?: number;
  gameName?: string;
  teamId?: string;
  teamName?: string;
  opponentTeamId?: string;
  opponentCoach?: string;
  /** the game was joined with a JNLP: its token cannot be reused, so a rejoin uses the saved password */
  viaJnlp?: boolean;
}

let target: OfficialJoinTarget | null = null;
let watching = false;

function ensureWatch(): void {
  if (watching) return;
  watching = true;
  // password: any change of the stored value drops the target. The first run only subscribes.
  let passwordSubscribed = false;
  watchEffect(() => {
    void settings.password;
    if (!passwordSubscribed) { passwordSubscribed = true; return; }
    clearOfficialRejoinTarget();
  }, { flush: 'sync' });
  // coach: another account drops it; a case-only correction of the same account keeps it
  let coachSubscribed = false;
  watchEffect(() => {
    const coach = settings.coach;
    if (!coachSubscribed) { coachSubscribed = true; return; }
    if (target && !equalsIgnoringAsciiCase(coach, target.coach)) clearOfficialRejoinTarget();
  }, { flush: 'sync' });
}

/** Keep `next` as THE target (replacing any other). */
export function setOfficialRejoinTarget(next: OfficialJoinTarget): void {
  ensureWatch();
  target = { ...next };
}

export function clearOfficialRejoinTarget(): void {
  target = null;
}

/** The raw target (for the store to carry across its own disconnect); use officialRejoinProblem/Target to act on it. */
export function peekOfficialRejoinTarget(): OfficialJoinTarget | null {
  return target;
}

/** Why the kept target cannot be used right now, in plain words; null when it can (or when nothing is kept). */
export function officialRejoinProblem(): string | null {
  if (!target) return null;
  if (!settings.password) return 'No FUMBBL password is saved, so a fresh JNLP is needed to get back into this game.';
  if (!equalsIgnoringAsciiCase(settings.coach, target.coach)) {
    return 'The saved FUMBBL account is not the one this game was joined with, so a fresh JNLP is needed.';
  }
  return null;
}

/** The target, only when a password is stored and the stored coach name is the account it was made for. */
export function usableOfficialRejoinTarget(): OfficialJoinTarget | null {
  return target && !officialRejoinProblem() ? target : null;
}

/** Test seam: everything this module holds between calls (so a scan can prove it holds no credential). */
export function officialRejoinTargetStateForScan(): { target: OfficialJoinTarget | null; watching: boolean } {
  return { target, watching };
}
