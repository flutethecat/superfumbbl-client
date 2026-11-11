// Upstream christerk/ffb PR #341 (join client identification, discussed with upstream by the owner): every
// `clientJoin` carries the FFB protocol version the client speaks, the client's name and its version. The server logs
// them at INFO ("Join request from coach X as player with client <name> <version> (protocol <v>)"); it never rejects on
// them, and a server before the PR reads only the keys it knows. Staged 2026-10-25 ahead of the merge; owner (Sol r1):
// sent only to a server that carries the PR (serverVersionGate JOIN_CLIENT_IDENTIFICATION_MIN_SERVER_VERSION).
import { clientIdentityFields, type ClientIdentity, type ServerCommandVersion } from '@fumbbl40k/ffb-protocol';
import { APPROVED_FFB_SERVER_VERSIONS, compareServerVersions, serverSupportsJoinClientIdentification } from './serverVersionGate';

declare const __APP_VERSION__: string;

/** Owner (Sol r1): the join's `clientName` is one token, lowercase with an underscore, no space. Every join site uses
 *  this constant (via CLIENT_IDENTITY). */
export const FFB_CLIENT_NAME = 'super_fumbbl';

/** The app version, the same `__APP_VERSION__` stamp the build badge and bug reports carry. */
export const CLIENT_VERSION = typeof __APP_VERSION__ !== 'undefined' ? String(__APP_VERSION__) : 'dev';

/**
 * The FFB protocol version this client speaks. Upstream's own client sends `FantasyFootballConstants.VERSION` (its
 * build version, the same string the server announces in `serverVersion`), so the protocol version is an FFB release
 * number. Ours is the newest FFB server release this client has been vetted against (the server-version gate's
 * approved list): approving a new server version is the act that moves our protocol forward, so the two never drift.
 */
export function ffbProtocolVersion(approved: readonly string[] = APPROVED_FFB_SERVER_VERSIONS): string {
  const sorted = [...approved].sort(compareServerVersions);
  return sorted[sorted.length - 1] ?? '';
}

export const CLIENT_IDENTITY: ClientIdentity = {
  protocolVersion: ffbProtocolVersion(),
  clientName: FFB_CLIENT_NAME,
  clientVersion: CLIENT_VERSION,
};

/** The identity for a join to the announced server: ours on a server that carries PR #341, none elsewhere. */
export function clientIdentityForServer(version: Pick<ServerCommandVersion, 'serverVersion'> | null): ClientIdentity | null {
  return serverSupportsJoinClientIdentification(version?.serverVersion == null ? null : String(version.serverVersion))
    ? CLIENT_IDENTITY : null;
}

/** The PR #341 keys for a hand-built join (the replay loader's authenticated join), per the announced server. */
export function clientIdentityJoinFields(serverVersion: string | null | undefined): Partial<ClientIdentity> {
  return clientIdentityFields(clientIdentityForServer(serverVersion == null ? null : { serverVersion }));
}
