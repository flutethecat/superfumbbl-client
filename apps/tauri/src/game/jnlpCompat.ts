import {
  JnlpHostPolicyError,
  JnlpValidationError,
  parseJnlpXmlAs,
  parseJnlpXml,
  readJnlpArguments,
  type StrictJnlpRequest,
} from './jnlpIntake';
import { classifyGameEntry, type GameEntryClassification } from './gameEntryClassifier';

export interface JnlpJoinRequest {
  mode: 'replay' | 'spectate' | 'player' | 'unknown';
  gameId: number | null;
  port: number | null;
  coach: string | null;
  auth: string | null;
  /** Owner 2026-07-07: FORK (standalone) join — the fork joins by gameName + teamId with a
   *  cleartext password (not FUMBBL's gameId + one-time -auth token). Marked by a `-fork` arg. */
  fork: boolean;
  gameName: string | null;
  teamId: string | null;
  /** FUMBBL live PLAYER joins carry -teamId + -teamName (and NO -gameId): the player joins
   *  with their team and the server matches/assigns the game. */
  teamName: string | null;
  password: string | null;
  /** hex md5(pw) from a `-passwordMd5` fork JNLP — the pre-hashed credential (owner ruling
   *  08-17). Preferred over `password` when present. */
  passwordMd5: string | null;
}

export interface ClassifiedJnlpJoinRequest extends JnlpJoinRequest {
  readonly entryClassification: GameEntryClassification;
  readonly sourceArguments: readonly string[];
  readonly sourceXml: string;
  readonly validation: 'valid' | 'host-policy' | 'invalid' | 'ambiguous';
}

function unknownRequest(): JnlpJoinRequest {
  return {
    mode: 'unknown', gameId: null, port: null, coach: null, auth: null,
    fork: false, gameName: null, teamId: null, teamName: null, password: null, passwordMd5: null,
  };
}

function toJoinRequest(request: StrictJnlpRequest): JnlpJoinRequest {
  return {
    mode: request.mode === 'spectator' ? 'spectate' : request.mode,
    gameId: request.gameId ?? null,
    // Legacy shape only; strict endpoint policy validates this before mapping.
    port: request.declaredPort ?? null,
    coach: request.coach ?? null,
    auth: request.auth ?? null,
    fork: request.fork,
    gameName: request.gameName ?? null,
    teamId: request.teamId ?? null,
    teamName: request.teamName ?? null,
    password: request.password ?? null,
    passwordMd5: request.passwordMd5 ?? null,
  };
}

export function parseJnlp(xml: string): JnlpJoinRequest {
  try {
    return toJoinRequest(parseJnlpXml(xml));
  } catch (error) {
    if (error instanceof JnlpValidationError) {
      // Fail closed: hostile endpoint overrides and malformed input must never
      // preserve a partial request that could match an existing join route.
      return unknownRequest();
    }
    throw error;
  }
}

/** Classify before strict parsing so every production JNLP entry shares one front door. */
export function parseClassifiedJnlp(xml: string): ClassifiedJnlpJoinRequest {
  const sourceArguments = readJnlpArguments(xml);
  const entryClassification = classifyGameEntry(sourceArguments);
  if (entryClassification.kind === 'ambiguous') {
    return {
      ...unknownRequest(), entryClassification, sourceArguments, sourceXml: xml, validation: 'ambiguous',
    };
  }
  try {
    parseJnlpXml(xml);
    return {
      ...parseJnlp(xml),
      entryClassification,
      sourceArguments,
      sourceXml: xml,
      validation: 'valid',
    };
  } catch (error) {
    if (!(error instanceof JnlpValidationError)) throw error;
    return {
      ...unknownRequest(),
      entryClassification,
      sourceArguments,
      sourceXml: xml,
      validation: error instanceof JnlpHostPolicyError ? 'host-policy' : 'invalid',
    };
  }
}

export function resolveClassifiedJnlpChoice(
  entry: ClassifiedJnlpJoinRequest,
  choice: 'replay' | 'live',
): ClassifiedJnlpJoinRequest {
  const sourceMode = entry.sourceArguments
    .map((value) => value.toLowerCase())
    .find((value) => value === '-player' || value === '-spectator');
  const withoutModes = entry.sourceArguments.filter((value) => {
    const lowered = value.toLowerCase();
    return lowered !== '-player' && lowered !== '-spectator' && lowered !== '-replay';
  });
  const playerVocabulary = new Set(['-teamid', '-teamname', '-teamhome', '-teamaway', '-auth', '-gamename', '-password', '-fork']);
  const liveMode = sourceMode ?? (withoutModes.some((value) => playerVocabulary.has(value.toLowerCase())) ? '-player' : '-spectator');
  const resolvedArguments = [choice === 'replay' ? '-replay' : liveMode, ...withoutModes];
  const request = parseJnlpXmlAs(entry.sourceXml, resolvedArguments);
  return {
    ...toJoinRequest(request),
    entryClassification: {
      kind: choice,
      reason: `user selected ${choice} for ambiguous JNLP`,
    },
    sourceArguments: resolvedArguments,
    sourceXml: entry.sourceXml,
    validation: 'valid',
  };
}
