/**
 * Owner 11-12: the real inputs of the Coach Stats sync (coachStatsSync.ts), in one place: the FUMBBL match list the
 * Play blade reads, the Details cache, the Replay launcher's anonymous replay download from Official FUMBBL, the local
 * history and localStorage. This is the ONLY network use behind the coach history, and it runs only from the panel's
 * button. No credentials: the list is the public API and the replay download sends no password.
 *
 * Review fixes (owner 11-12): the run takes the cross-window lease (Web Locks where available + a localStorage lease);
 * every listing request carries the run's abort signal and a per-request time limit; the run is bound to the server
 * target and coach it started for and is cancelled the moment either changes.
 */
import { watch } from 'vue';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { appendCoachGameOutcome, coachHistory, refreshCoachHistory } from './coachGameHistory';
import {
  COACH_SYNC_GAMES, COACH_SYNC_REQUEST_TIMEOUT_MS, cancelCoachStatsSync, createCoachSyncLease, startCoachStatsSync,
  type CoachSyncResult, type CoachSyncStorage,
} from './coachStatsSync';
import { coachNameKey } from './fumbblCoachProfile';
import { fetchRecentFumbblMatches } from './fumbblRecentMatches';
import { localPlayedTeamIds } from './recentPlayedTeams';
import { loadPostGameSnapshot } from './postGameCache';
import { postGameKey } from './postGameProjection';
import { downloadReplay } from './replay/replayLoader';
import { serverTargets, settings } from './settings';

const inTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);

export function coachSyncStorage(): CoachSyncStorage | null {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

/** This window's owner id for the lease. */
const WINDOW_OWNER = `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

function webLocks(): Parameters<typeof createCoachSyncLease>[0]['locks'] {
  try {
    const locks = (globalThis as { navigator?: { locks?: unknown } }).navigator?.locks;
    return locks && typeof (locks as { request?: unknown }).request === 'function' ? locks as never : null;
  } catch { return null; }
}

/** Starts the sync for the logged-in coach (null = one is already running here, or Official FUMBBL is not offered). */
export async function syncFumbblCoachGames(coach: string): Promise<CoachSyncResult | null> {
  // always Official FUMBBL's own replay address, whatever target is active
  const target = serverTargets().find((s) => s.id === 'fumbbl');
  const name = coach.trim();
  if (!target || !name) return null;
  const fetcher = (inTauri ? tauriFetch : fetch) as (u: string, init?: RequestInit) => Promise<Response>;
  const storage = coachSyncStorage();
  // bound to the server target and coach it started for: a switch stops it before the next request or append
  const startTarget = settings.activeServerTarget;
  const startCoach = coachNameKey(settings.coach);
  const stillBound = () => settings.activeServerTarget === startTarget && startTarget === 'fumbbl'
    && coachNameKey(settings.coach) === startCoach && startCoach === coachNameKey(name);
  const stopWatch = watch(() => [settings.activeServerTarget, settings.coach] as const, () => { if (!stillBound()) cancelCoachStatsSync(); });
  try {
    return await startCoachStatsSync({
      coach: name,
      listMatches: async (c, signal) => {
        const out = await fetchRecentFumbblMatches(c, fetcher, COACH_SYNC_GAMES, localPlayedTeamIds(c), { signal, requestTimeoutMs: COACH_SYNC_REQUEST_TIMEOUT_MS });
        return { matches: out.matches, pagesRequested: out.pagesRequested, pagesFailed: out.pagesFailed, ...(out.teamCap ? { teamCap: out.teamCap } : {}) };
      },
      refreshHistory: refreshCoachHistory,
      history: () => coachHistory.games,
      loadSnapshot: (gameId) => loadPostGameSnapshot(postGameKey('fumbbl', gameId)),
      downloadReplay: (gameId, signal) => downloadReplay({ url: target.url, compression: target.compression, coach: name, gameId, signal }),
      append: appendCoachGameOutcome,
      stillBound,
      lease: createCoachSyncLease({ storage, coach: name, owner: WINDOW_OWNER, now: Date.now, locks: webLocks() }),
      now: Date.now,
      storage,
    });
  } finally { stopWatch(); }
}
