// Owner 10-17: "If FFB-server's version has changed since our last approved version, we should put a hard-stop in the
// client so that users cannot play until a fix is deployed." Background: upstream christerk/ffb PR #325 changed the
// apothecary choice command's shape; a client on the old shape would wedge silently on the new server (the command
// fails to deserialise and is dropped). The server announces its version on every connect (serverVersion), before any
// join leaves, so the gate sits there.
//
// Rules (owner 10-17): playing (a coach seat) is refused on a server version not on the approved list; spectating and
// replays are allowed (read-only); the dev / fork edition is never blocked; the coach is directed to the main FUMBBL
// client. Approving a new server version is a client patch: vet the upstream release, add its version here, ship.
import { ref } from 'vue';
import type { ClientMode, ServerCommandVersion } from '@fumbbl40k/ffb-protocol';

/** FFB server versions this client has been vetted against. A list, so a server rollback stays approved.
 *  3.3.1 = the live fumbbl.com game server on 2026-10-17 (asked directly: connect -> clientRequestVersion), the server
 *  every UAT game of 1.0.221-1.0.235 ran against, and still on 2026-11-09 (asked directly again). (An old capture said
 *  3.2.3; Astra caught that before it shipped.) 3.4.0 = the live fork server since 2026-10-26 (upstream 3.4.0 + PRs 325,
 *  336-342), the server the 3.4.0 protocol work was tested against (owner 11-09: "finish prepping for 3.4.0 protocol"). */
export const APPROVED_FFB_SERVER_VERSIONS: readonly string[] = ['3.3.1', '3.4.0'];

export interface ServerVersionBlock {
  /** The server's announced version. */
  serverVersion: string;
  /** The Java client version the server expects (for the message and the bug report). */
  expectsClient: string;
  /** The game the coach was joining, when known. */
  gameId: number | null;
  /** The coach, when known (the "play with the FUMBBL client" link goes to the coach page, where FUMBBL's Play lives). */
  coach: string | null;
  approved: readonly string[];
}

/** The live block (the modal reads it); null = none. */
export const serverVersionBlock = ref<ServerVersionBlock | null>(null);
/** The last server version announced to this client (bug reports carry it). */
export const lastServerVersion = ref<string | null>(null);

/**
 * Bretonnian Pastries (spec-bretonnian-pastries-2026-10-23): the first FFB server release whose stock game options
 * include the inducement (GameOptionFactory defaults cost 15000 / max 1). The server sends ONLY options a game sets
 * explicitly (GameOptions.toJsonValue), so on a supporting server an ABSENT Pastries option means that default; on any
 * other server it means "no such inducement". `null` = no released server supports it yet: the row then appears only
 * when the game options carry `inducementBretonnianPastriesMax` explicitly (our test jar). Flip this to the upstream
 * release version once christerk merges the Pastries PR.
 */
export const PASTRIES_MIN_SERVER_VERSION: string | null = null;

/**
 * FFB 3.4.0 (audit 10-26 entry 5, P1): bb2025/StepWizard + bb2025/WizardLogicModule let Zap target any player of either
 * team and Fireball hit squares holding players in any state. Live FUMBBL (3.3.1) keeps the old rule (opponents only,
 * Fireball needs a standing opponent). `null` = the old rule everywhere (public builds today); the staged 3.4.0 branch
 * sets it to '3.4.0' for dev cuts. The rule also needs the game to be BB2025 (wizardSpell.wizardTargetRuleFor).
 */
export const WIZARD_BB2025_TARGETING_MIN_SERVER_VERSION: string | null = '3.4.0';
let wizardTargetingMinOverride: { min: string | null } | null = null;
/** @internal Test seam: stand in for WIZARD_BB2025_TARGETING_MIN_SERVER_VERSION (undefined = restore the constant). */
export function overrideWizardBb2025TargetingMinForTest(min: string | null | undefined): void {
  wizardTargetingMinOverride = min === undefined ? null : { min };
}

/** Dotted numeric compare ("3.10.0" > "3.9.2"); a non-numeric part compares as 0. NOT semver: a pre-release or build
 *  suffix ("3.4.0-rc1") is not ordered as semver would order it. Revisit against upstream's real version strings before
 *  PASTRIES_MIN_SERVER_VERSION is set. */
export function compareServerVersions(a: string, b: string): number {
  const pa = a.trim().split('.').map((x) => Number.parseInt(x, 10) || 0);
  const pb = b.trim().split('.').map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** The announced server is known to carry Bretonnian Pastries as a stock inducement. */
export function serverSupportsPastries(serverVersion: string | null | undefined, min: string | null = PASTRIES_MIN_SERVER_VERSION): boolean {
  const v = (serverVersion ?? '').trim();
  return min !== null && v !== '' && compareServerVersions(v, min) >= 0;
}

/** A released FFB version: exactly MAJOR.MINOR.PATCH, digits only (Sol r2 P3: '3.4oops.0' or '3.4.0-rc1' compare
 *  equal to 3.4.0 in compareServerVersions, yet prove nothing about the released fixes). */
const RELEASED_VERSION = /^\d+\.\d+\.\d+$/;

/** `serverVersion` is a released version and at least `min`; a null `min` (no release carries the change yet) is never
 *  met, and anything that is not a plain released version leaves the capability OFF. The coach-seat approval list
 *  (serverVersionApproved) keeps its exact-match semantics. */
function serverAtLeast(serverVersion: string | null | undefined, min: string | null): boolean {
  const v = (serverVersion ?? '').trim();
  return min !== null && RELEASED_VERSION.test(v) && RELEASED_VERSION.test(min.trim()) && compareServerVersions(v, min) >= 0;
}

/** Sol r2 P2: capability decisions for the live game read the version announced on the GAME connection, never the
 *  shared `lastServerVersion` (a lobby / prepared session consults the gate too and overwrites it). The store registers
 *  the source (its game session); null when there is none. */
let gameConnectionVersionSource: () => string | null = () => null;
export function setGameConnectionVersionSource(source: () => string | null): void {
  gameConnectionVersionSource = source;
}
export function activeGameServerVersion(): string | null {
  return gameConnectionVersionSource();
}

/**
 * Upstream christerk/ffb PR #325 ("Prevent client-injected Apothecary outcomes"): `clientApothecaryChoice` is read as
 * `{choiceNewInjury: boolean}` only; a command without it fails to deserialise and is dropped. Owner: held until
 * upstream merges. `null` = the wire stays exactly as today (legacy fields only). Set it to the FUMBBL release that
 * carries PR #325; from that server on the flag rides next to the legacy fields (which stay until a later patch).
 */
export const APOTHECARY_CHOICE_FLAG_MIN_SERVER_VERSION: string | null = '3.4.0';

/** The announced server reads `choiceNewInjury` on the apothecary choice (upstream PR #325). */
export function serverSupportsApothecaryChoiceFlag(
  serverVersion: string | null | undefined,
  min: string | null = APOTHECARY_CHOICE_FLAG_MIN_SERVER_VERSION,
): boolean {
  return serverAtLeast(serverVersion, min);
}

/**
 * Upstream christerk/ffb PR #341 (join client identification): `clientJoin` carries `protocolVersion`, `clientName` and
 * `clientVersion`, logged by the server only. `null` = joins stay exactly as today. Set it to the FUMBBL release that
 * carries PR #341.
 */
export const JOIN_CLIENT_IDENTIFICATION_MIN_SERVER_VERSION: string | null = '3.4.0';

/** The announced server logs the join's client identification (upstream PR #341). */
export function serverSupportsJoinClientIdentification(
  serverVersion: string | null | undefined,
  min: string | null = JOIN_CLIENT_IDENTIFICATION_MIN_SERVER_VERSION,
): boolean {
  return serverAtLeast(serverVersion, min);
}

/**
 * Upstream christerk/ffb PR #338 (fix/dwarfen-wisdom-reactivate-players): StepDwarfenWisdom.leave() re-activates the
 * players it locked for the Josef Bugman re-setup. Until a server carries it, High Kick unions local eligibility with
 * the server's ACTIVE set (owner-ruled divergence, 08-17; availableActions.highKickNomineeIds). `null` = no released
 * server carries the fix yet, so the union stays. Flip this to the FUMBBL release version that ships PR #338; from that
 * server on, High Kick reads the server's ACTIVE set alone (server-derived law).
 */
export const DWARFEN_WISDOM_REACTIVATES_MIN_SERVER_VERSION: string | null = '3.4.0';

/** The announced server re-activates the Dwarfen Wisdom-locked players itself (upstream PR #338). */
export function serverRestoresDwarfenWisdomActive(
  serverVersion: string | null | undefined,
  min: string | null = DWARFEN_WISDOM_REACTIVATES_MIN_SERVER_VERSION,
): boolean {
  return serverAtLeast(serverVersion, min);
}

export function serverVersionApproved(serverVersion: string, approved: readonly string[] = APPROVED_FFB_SERVER_VERSIONS): boolean {
  const v = serverVersion.trim();
  return v !== '' && approved.includes(v);
}

/** The refusal message for a join, or null when the join may go out. `enforced` = the public edition. */
export function serverVersionRefusal(
  version: Pick<ServerCommandVersion, 'serverVersion' | 'clientVersion'>,
  mode: ClientMode,
  opts: { enforced: boolean; approved?: readonly string[] },
): string | null {
  if (!opts.enforced) return null;
  if (mode !== 'player') return null; // spectate / replay: read-only, allowed (owner 10-17)
  const approved = opts.approved ?? APPROVED_FFB_SERVER_VERSIONS;
  if (serverVersionApproved(String(version.serverVersion ?? ''), approved)) return null;
  return `FUMBBL's game server is now version ${String(version.serverVersion ?? '?')}; this Super FUMBBL build is approved for ${approved.join(', ')}. Playing is disabled until a compatible update is released. Use the main FUMBBL client to play.`;
}

/** The FUMBBL page to play with the main client: the coach's own page (its current games carry FUMBBL's Play button).
 *  Astra 10-17: never a match page built from the FFB game id - the website's match ids are another namespace. */
export function fumbblPlayUrl(coach: string | null): string {
  const c = coach?.trim() ?? '';
  return c ? `https://fumbbl.com/~${encodeURIComponent(c)}` : 'https://fumbbl.com';
}

/** The announced server runs the 3.4.0 bb2025 wizard targeting rule (see WIZARD_BB2025_TARGETING_MIN_SERVER_VERSION). */
export function serverHasBb2025WizardTargeting(
  serverVersion: string | null | undefined,
  min: string | null = wizardTargetingMinOverride ? wizardTargetingMinOverride.min : WIZARD_BB2025_TARGETING_MIN_SERVER_VERSION,
): boolean {
  const v = (serverVersion ?? '').trim();
  return min !== null && v !== '' && compareServerVersions(v, min) >= 0;
}
