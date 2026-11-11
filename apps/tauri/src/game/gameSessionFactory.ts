// Owner 10-17: every game session the app opens goes through here, so the two things each one needs ride along:
// client-supplied entropy on outgoing commands (owner 10-16) and the server-version gate (serverVersionGate.ts).
import { GameSession, type ClientMode, type ServerCommandVersion } from '@fumbbl40k/ffb-protocol';
import { FORK_EDITION } from './edition';
import { isForkServerUrl } from './forkAccess';
import { withEntropy } from './mouseEntropy';
import { clientIdentityForServer } from './clientIdentity';
import { APPROVED_FFB_SERVER_VERSIONS, lastServerVersion, serverVersionBlock, serverVersionRefusal } from './serverVersionGate';
import { clientVersionBlock, clientVersionJoinGate, noteSeatTaken } from './clientVersionGate';

export interface GameSessionTarget { url: string; compression?: boolean }

/** The join gate the session consults once the server has announced its version, before any join leaves. */
type GateJoin = { mode: ClientMode; gameId: number | null; coach: string | null; gameName?: string | null; listOnly?: boolean };
export function serverVersionJoinGate(version: ServerCommandVersion, join: GateJoin, serverUrl: string | null = null): string | null {
  lastServerVersion.value = String(version.serverVersion ?? '');
  // Owner 10-31: not enforced for the fork target (it runs a newer FFB) - in the FORK edition, or a public run launched
  // with --fork-server whose session dials that host. FUMBBL stays gated in the public build.
  const refusal = serverVersionRefusal(version, join.mode, { enforced: !(FORK_EDITION || isForkServerUrl(serverUrl)) });
  if (refusal) {
    serverVersionBlock.value = {
      serverVersion: String(version.serverVersion ?? '?'),
      expectsClient: String(version.clientVersion ?? ''),
      gameId: join.gameId,
      coach: join.coach,
      approved: APPROVED_FFB_SERVER_VERSIONS,
    };
  } else {
    serverVersionBlock.value = null; // Astra 10-17: a later allowed launch (a spectate, a replay) supersedes an old block
  }
  if (refusal) { clientVersionBlock.value = null; return refusal; } // the server stop explains this join; one modal
  // Owner 10-26: the client version gate - an outdated public build takes no coach seat (clientVersionGate.ts).
  // Synchronous: it reads the regular update check's record and never waits on the network (fails open). The lobby's
  // list request takes no seat: the gate judges the seat join that follows (Sol r2: a reconnect's list preflight must
  // not refuse an accepted seat, and a warning is asked once per flow, not for the list and again for the game).
  if (join.listOnly) return null;
  return clientVersionJoinGate({ mode: join.mode, gameId: join.gameId, gameName: join.gameName ?? null, coach: join.coach, serverUrl });
}

export function createGameSession(target: GameSessionTarget): GameSession {
  // Owner 10-26: the seat this session's gate last let through. The server's SERVER_JOIN for that coach as a player
  // accepts it; the game id is the requested one, or (a join by name) the served one from the first game state
  // (clientVersionGate: a reconnect to an accepted seat is never refused by the client version gate).
  let pendingSeat: { coach: string; gameId: number | null; gameName: string | null } | null = null;
  let acceptedCoach: string | null = null;
  const joinGate = (version: ServerCommandVersion, join: GateJoin): string | null => {
    const refusal = serverVersionJoinGate(version, join, target.url);
    if (!join.listOnly) pendingSeat = !refusal && join.mode === 'player' && join.coach ? { coach: join.coach, gameId: join.gameId, gameName: join.gameName ?? null } : null;
    return refusal;
  };
  const session = new GameSession({ url: target.url, compression: target.compression ?? true, decorateOutgoing: withEntropy, joinGate, clientIdentity: clientIdentityForServer });
  session.on('join', (command) => {
    if (!pendingSeat || command.clientMode !== 'player' || String(command.coach ?? '').toLowerCase() !== pendingSeat.coach.toLowerCase()) return;
    acceptedCoach = pendingSeat.coach;
    if (pendingSeat.gameId) noteSeatTaken(target.url, acceptedCoach, pendingSeat.gameId);
    if (pendingSeat.gameName) noteSeatTaken(target.url, acceptedCoach, pendingSeat.gameName); // Sol r3: a by-name rejoin before any snapshot
  });
  session.on('gameState', (command) => {
    const served = Number((command.game as { gameId?: string | number } | undefined)?.gameId ?? 0);
    if (acceptedCoach && served > 0) noteSeatTaken(target.url, acceptedCoach, served);
  });
  return session;
}
