/**
 * Owner 09-25: the FUMBBL Play blade ("My Active Games" / "My Recent Games"). Pure helpers over the public
 * FUMBBL API: `/api/match/current` filtered to the coach gives the games they are in right now (score, half,
 * turn, both teams); recent games come from fumbblRecentMatches. No auth, no FUMBBL CDN (crests are ours).
 */
import type { BrowserMatch, BrowserTeam } from './jnlpRouting';

export interface FumbblActiveTeam {
  id: number;
  side: 'home' | 'away';
  name: string;
  coach: string;
  race: string;
  tv?: number;
  score: number;
}

export interface FumbblActiveGame {
  id: number;
  half: number;
  turn: number;
  division?: string;
  home: FumbblActiveTeam;
  away: FumbblActiveTeam;
  /** which of home/away is the coach's */
  mine: 'home' | 'away';
}

function team(raw: unknown, side: 'home' | 'away'): FumbblActiveTeam | null {
  const t = raw as Record<string, unknown> | null;
  if (!t || typeof t !== 'object') return null;
  const tv = Number(t.tv);
  return {
    id: Number(t.id) || 0,
    side,
    name: String(t.name ?? ''),
    coach: String(t.coach ?? ''),
    race: String(t.race ?? ''),
    tv: Number.isFinite(tv) && tv > 0 ? tv : undefined,
    score: Number(t.score ?? 0) || 0,
  };
}

/** The coach's live games from a `/api/match/current` payload (coach match is case-insensitive). */
export function parseActiveGames(payload: unknown, coach: string): FumbblActiveGame[] {
  if (!Array.isArray(payload)) return [];
  const me = coach.trim().toLowerCase();
  if (!me) return [];
  const rows: FumbblActiveGame[] = [];
  for (const raw of payload) {
    const m = raw as Record<string, unknown>;
    const teams = Array.isArray(m.teams) ? m.teams as Record<string, unknown>[] : [];
    const home = team(teams.find((t) => t.side === 'home') ?? teams[0], 'home');
    const away = team(teams.find((t) => t.side === 'away') ?? teams[1], 'away');
    const id = Number(m.id);
    if (!home || !away || !Number.isInteger(id) || id <= 0) continue;
    const mine = home.coach.toLowerCase() === me ? 'home' : away.coach.toLowerCase() === me ? 'away' : null;
    if (!mine) continue;
    rows.push({ id, half: Number(m.half) || 0, turn: Number(m.turn) || 0, division: typeof m.division === 'string' ? m.division : undefined, home, away, mine });
  }
  return rows;
}

/** "2HT8" — half then turn (owner 09-25; was "T5 · 1st Half"). */
export function phaseLabel(game: Pick<FumbblActiveGame, 'half' | 'turn'>): string {
  if (!game.half && !game.turn) return 'Setting up';
  return `${game.half}HT${game.turn}`;
}

export function resultLetter(my: number, theirs: number): 'W' | 'L' | 'D' {
  return my > theirs ? 'W' : my < theirs ? 'L' : 'D';
}

/** FUMBBL reports "YYYY-MM-DD HH:MM:SS" (site time); anything unparsable is shown as given. */
export function relativeTime(when: string, now: number = Date.now()): string {
  const date = new Date(when.replace(' ', 'T'));
  if (Number.isNaN(date.valueOf())) return when;
  const s = Math.max(0, Math.round((now - date.valueOf()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return d === 1 ? 'yesterday' : `${d}d ago`;
  if (d < 35) return `${Math.floor(d / 7)}w ago`;
  if (d < 365) return `${Math.floor(d / 30)}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}

/** The lobby join takes the match in the spectate-browser shape (fumbblJoinLoaded picks own/opponent by coach). */
export function toBrowserMatch(game: FumbblActiveGame): BrowserMatch {
  const t = (x: FumbblActiveTeam): BrowserTeam => ({ side: x.side, name: x.name, coach: x.coach, race: x.race, score: x.score, teamId: x.id, tv: x.tv });
  return { id: game.id, half: game.half, turn: game.turn, teams: [t(game.home), t(game.away)] };
}
