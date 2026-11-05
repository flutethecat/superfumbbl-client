/**
 * Owner 11-04: the Modern recent-game cards show each opponent's FUMBBL rank badge and CR. The owner approved that
 * traffic only with a working saved cache (fumbblCoachProfile.ts), so (Sol r1 / r2):
 *
 * - ONE session for the whole app run, kept on globalThis so a remount or a dev hot reload reuses it.
 * - At most RECENT_OPPONENT_PROFILE_CAP distinct opponents are ever looked up in a session (the first ones listed).
 * - One lookup at a time (a single serial queue). A coach already queued is not queued twice; a Refresh while it is
 *   still queued upgrades that job to a forced one, and a Refresh while it runs queues one forced follow-up.
 * - Before each job runs, the caller's `eligible()` (the Modern look) and the cache state are checked again; a job
 *   that is no longer eligible is dropped.
 * - Persist-then-fetch: a coach whose profile is not saved is looked up only after a full-size placeholder was written
 *   (reserveCoachProfileSlot). If that write, or the save after a lookup, fails, the cache is broken: no further
 *   opponent lookup runs this session, and a count-only warning says how many were skipped. A later launch with the
 *   store still full fails the placeholder write again, so it makes no request either.
 * - A saved or in-memory profile costs no request; a new coach costs at most 3 (fetchFumbblCoachProfile).
 */
import { shallowRef, type ShallowRef } from 'vue';
import {
  coachNameKey, fetchFumbblCoachProfile, hasSavedCoachProfile, reserveCoachProfileSlot, saveCoachProfile,
  type CoachProfileFetch, type FumbblCoachProfile,
} from './fumbblCoachProfile';

export const RECENT_OPPONENT_PROFILE_CAP = 10;

type JobState = { force: boolean; running: boolean; followUp: boolean; fetchFn: CoachProfileFetch };
interface OpponentSession {
  admitted: Set<string>;
  /** Sol r3: coaches whose lookup came back empty this session - not asked again unless forced (kept here, on
   *  globalThis, so a hot reload that empties the profile module's memory cache does not refetch them) */
  failed: Set<string>;
  jobs: Map<string, JobState>;
  queue: Promise<void>;
  broken: boolean;
  skipped: number;
  warned: number;
  /** bumped by a reset: queued work from an older generation does nothing */
  gen: number;
  profiles: ShallowRef<Map<string, FumbblCoachProfile>>;
}
const SESSION_KEY = '__sfRecentOpponentProfilesSession';
function newSession(): OpponentSession {
  return { admitted: new Set(), failed: new Set(), jobs: new Map(), queue: Promise.resolve(), broken: false, skipped: 0, warned: 0, gen: 0, profiles: shallowRef(new Map()) };
}
const holder = globalThis as unknown as Record<string, OpponentSession | undefined>;
const session: OpponentSession = holder[SESSION_KEY] ??= newSession();
session.failed ??= new Set(); // a session made by an older copy of this module

/** The profiles looked up so far this session, by coach name key. */
export const recentOpponentProfiles = session.profiles;

function warnSkipped(): void {
  if (session.skipped <= session.warned) return;
  session.warned = session.skipped;
  console.warn(`[coach-profiles] profile cache unavailable: skipped ${session.skipped} opponent lookup(s)`);
}

/** Queue the lookups for a recent-games list. Returns the queue's tail (tests await it; callers need not). */
export function loadRecentOpponentProfiles(
  opponentNames: readonly string[],
  ownCoach: string,
  fetchFn: CoachProfileFetch,
  options: { force?: boolean; eligible?: () => boolean } = {},
): Promise<void> {
  const eligible = options.eligible ?? (() => true);
  const own = coachNameKey(ownCoach);
  const listed = new Map<string, string>();
  for (const raw of opponentNames) {
    const name = raw.trim();
    const key = coachNameKey(name);
    if (key && key !== own && !listed.has(key)) listed.set(key, name);
  }
  for (const key of listed.keys()) {
    if (session.admitted.size >= RECENT_OPPONENT_PROFILE_CAP) break;
    session.admitted.add(key);
  }
  const force = !!options.force;
  for (const [key, name] of listed) {
    if (!session.admitted.has(key)) continue;
    const queued = session.jobs.get(key);
    if (queued) {
      if (force) { queued.fetchFn = fetchFn; if (queued.running) queued.followUp = true; else queued.force = true; }
      continue;
    }
    enqueue(key, name, { force, running: false, followUp: false, fetchFn }, eligible);
  }
  session.queue = session.queue.then(warnSkipped);
  return session.queue;
}

function enqueue(key: string, name: string, job: JobState, eligible: () => boolean): void {
  session.jobs.set(key, job);
  const gen = session.gen;
  session.queue = session.queue.then(async () => {
    if (session.gen !== gen) return; // a reset session: old work is void
    let again = false;
    try {
      if (!eligible()) return;
      if (session.broken) { session.skipped++; return; }
      if (!job.force && session.failed.has(key)) return;
      // Sol r4: the session already holds this coach (e.g. pruned from storage, then a hot reload emptied the profile
      // module's memory cache): persist that copy instead of asking FUMBBL again
      const known = job.force ? undefined : session.profiles.value.get(key);
      if (known && (known.title !== undefined || known.cr !== undefined || known.record !== undefined)) {
        if (!hasSavedCoachProfile(name) && !saveCoachProfile(name, known)) session.broken = true;
        return;
      }
      const needsFetch = job.force || !hasSavedCoachProfile(name);
      if (needsFetch && !reserveCoachProfileSlot(name)) { session.broken = true; session.skipped++; return; }
      job.running = true;
      const profile = await fetchFumbblCoachProfile(name, job.fetchFn, {
        force: job.force,
        onSaveFailed: () => { session.broken = true; },
      });
      if (profile.title === undefined && profile.cr === undefined && profile.record === undefined) session.failed.add(key);
      else session.failed.delete(key);
      const next = new Map(session.profiles.value); next.set(key, profile); session.profiles.value = next;
      again = job.followUp;
    } catch { /* silent */ } finally {
      if (session.gen === gen) session.jobs.delete(key);
    }
    if (again && session.gen === gen) enqueue(key, name, { force: true, running: false, followUp: false, fetchFn: job.fetchFn }, eligible);
  });
}

/** Tests: a fresh session (what an app restart does). Queued work of the old one is voided. */
export function resetRecentOpponentProfilesSession(): void {
  session.gen++;
  session.admitted.clear();
  session.failed.clear();
  session.jobs.clear();
  session.queue = Promise.resolve();
  session.broken = false;
  session.skipped = 0;
  session.warned = 0;
  session.profiles.value = new Map();
}
