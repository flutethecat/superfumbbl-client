import type { GameJson } from '@fumbbl40k/ffb-protocol';

/**
 * Owner 09-24: Discord Rich Presence — what the local Discord shows for this coach. Pure text-shaping here; the
 * Rust worker (discord_presence.rs) owns the socket and the 15 s rate limit. Owner's strings:
 *   Playing:    "vs <Coach>'s <Race>s"  +  "<Score> <Turn>"
 *   Idle:       "Waiting for a game"
 *   Spectating: "Watching <Coach>'s <Race>s vs <Coach>'s <Race>s"  +  "<Score> <Turn>"
 */
export interface PresenceSpec { details: string; state: string; started_at?: number; spectate_secret?: string }

export interface PresenceInput {
  game: GameJson | null;
  /** The reader is in the PLAY seat (their own game). */
  playing: boolean;
  /** Owner 09-24: a replay shows the game being watched too ("Watching …", tagged Replay) — just no Spectate button. */
  replay: boolean;
  myCoach: string;
  /** 'fumbbl' | 'fork' — the server the game is on (part of the spectate secret). */
  server: string;
  /** Owner setting: let friends open this game from Discord's Spectate button. */
  spectateInvites: boolean;
  /** Unix seconds when this game was first seen by the client (elapsed timer). */
  startedAt?: number;
}

const norm = (s: string) => s.trim().toLowerCase();
/** Owner 09-24: always "<Coach>'s" (Chingis's), never the bare apostrophe. */
const possessive = (coach: string) => `${coach}'s`;
/** Owner 09-24: "<Coach>'s <Race>s" — the race reads as the team's people. Elf → Elves, Dwarf → Dwarves; races
 *  that are already plural or collective stay as they are. */
const RACE_COLLECTIVE = new Set(['skaven', 'undead', 'nurgle', 'khorne', 'norse', 'slann', 'lizardmen', 'tomb kings', 'chaos chosen',
  'imperial nobility', 'old world alliance', 'underworld denizens', 'elven union', 'chaos renegades', 'shambling undead', 'necromantic horror']);
export function pluralRace(race: string): string {
  const r = race.trim();
  if (!r) return r;
  const key = r.toLowerCase();
  if (key === 'necromantic horror') return `${r}s`;
  if (RACE_COLLECTIVE.has(key) || key.endsWith('s') || key.endsWith('men')) return r;
  if (key.endsWith('elf')) return `${r.slice(0, -1)}ves`;
  if (key.endsWith('dwarf')) return `${r.slice(0, -1)}ves`;
  return `${r}s`;
}
const coachRace = (coach: string | undefined, race: string | undefined) => `${possessive(coach ?? '?')} ${pluralRace(race ?? '?')}`;

export function turnLabel(game: GameJson): string {
  const turn = game.homePlaying ? game.turnDataHome?.turnNr : game.turnDataAway?.turnNr;
  const half = Number(game.half ?? 0);
  const t = Number(turn ?? 0);
  if (game.finished) return 'Final';
  if (half <= 0 || t <= 0) return 'Pre-game';
  return `H${half} T${t}`;
}

export function presenceFor(input: PresenceInput): PresenceSpec {
  const g = input.game;
  if (!g) return { details: 'Waiting for a game', state: '' };
  const home = g.teamHome, away = g.teamAway;
  const score = `${home?.score ?? 0}-${away?.score ?? 0}`;
  const stateLine = `${score} · ${turnLabel(g)}${input.replay ? ' · Replay' : ''}`;
  const gameId = Number((g as { gameId?: unknown }).gameId ?? 0);
  const secret = input.spectateInvites && gameId > 0 && !g.finished && !input.replay ? `${input.server}|${gameId}` : undefined;
  if (input.playing && !input.replay) {
    const mine = norm(home?.coach ?? '') === norm(input.myCoach) ? home : away;
    const opp = mine === home ? away : home;
    const myScore = mine === home ? `${home?.score ?? 0}-${away?.score ?? 0}` : `${away?.score ?? 0}-${home?.score ?? 0}`;
    return { details: `vs ${coachRace(opp?.coach, opp?.race)}`, state: `${myScore} · ${turnLabel(g)}`, started_at: input.startedAt, spectate_secret: secret };
  }
  return { details: `Watching ${coachRace(home?.coach, home?.race)} vs ${coachRace(away?.coach, away?.race)}`, state: stateLine, started_at: input.startedAt, spectate_secret: secret };
}

/** A spectate secret back into its parts; null for anything unexpected (only our own shape is honoured). */
export function parseSpectateSecret(secret: unknown): { server: 'fumbbl' | 'fork'; gameId: number } | null {
  if (typeof secret !== 'string') return null;
  const m = /^(fumbbl|fork)\|(\d{1,10})$/.exec(secret);
  return m ? { server: m[1] as 'fumbbl' | 'fork', gameId: Number(m[2]) } : null;
}
