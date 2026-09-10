export type GameEntryClassification =
  | { kind: 'replay'; reason: string }
  | { kind: 'live'; reason: string }
  | { kind: 'ambiguous'; reason: string };

const MODE_FLAGS = new Set(['-player', '-spectator', '-replay']);
const VALUE_FLAGS = new Set([
  '-coach', '-gameid', '-teamid', '-teamname', '-teamhome', '-teamaway',
  '-auth', '-port', '-server', '-build', '-layout',
  // Existing private-fork envelope fields do not change the upstream client mode.
  '-gamename', '-password',
]);
const FLAG_ONLY = new Set(['-fork']);

interface ArgumentShape {
  mode: string;
  values: Map<string, string>;
}

function readShape(args: readonly string[]): ArgumentShape | string {
  const modes: string[] = [];
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index]?.trim().toLowerCase() ?? '';
    if (MODE_FLAGS.has(flag)) {
      modes.push(flag);
      continue;
    }
    if (FLAG_ONLY.has(flag)) continue;
    if (!VALUE_FLAGS.has(flag)) return `unknown JNLP argument at index ${index}`;
    if (values.has(flag)) return `duplicate ${flag} argument`;
    const value = args[index + 1]?.trim();
    if (!value) return `${flag} is missing its value`;
    values.set(flag, value);
    index += 1;
  }
  if (modes.length === 0) return 'JNLP has no upstream client mode token';
  if (modes.length !== 1) return 'JNLP has more than one upstream client mode token';
  return { mode: modes[0]!, values };
}

function positiveGameId(values: ReadonlyMap<string, string>): boolean {
  const raw = values.get('-gameid');
  return raw !== undefined && /^[0-9]+$/.test(raw) && Number(raw) > 0;
}

/**
 * Pure front-door classification from JNLP argument vocabulary only.
 * Upstream: ffb-common/.../ClientMode.java `ClientMode` defines the three mode tokens.
 * Upstream: ffb-client-logic/.../ClientParameters.java `USAGE` and `validate()` define
 * the supported selector shapes; replay alone has `-replay -gameId` and no `-coach`.
 */
export function classifyGameEntry(args: readonly string[]): GameEntryClassification {
  const shape = readShape(args);
  if (typeof shape === 'string') return { kind: 'ambiguous', reason: shape };

  const { mode, values } = shape;
  const has = (flag: string) => values.has(flag);
  const coach = has('-coach');
  const gameId = positiveGameId(values);
  const teamId = has('-teamid');
  const teamName = has('-teamname');
  const teamHome = has('-teamhome');
  const teamAway = has('-teamaway');

  if (mode === '-replay') {
    if (gameId && !coach && !teamId && !teamName && !teamHome && !teamAway) {
      return { kind: 'replay', reason: 'upstream -replay -gameId shape' };
    }
    return { kind: 'ambiguous', reason: 'replay token does not match the upstream replay shape' };
  }

  if (mode === '-spectator') {
    if (coach && (!has('-gameid') || gameId) && !teamId && !teamName && !teamHome && !teamAway) {
      return { kind: 'live', reason: 'upstream spectator shape' };
    }
    return { kind: 'ambiguous', reason: 'spectator token does not match an upstream spectator shape' };
  }

  const gameSelector = gameId && !teamId && !teamName && teamHome === teamAway;
  const teamSelector = !has('-gameid') && !teamHome && !teamAway && teamId === teamName;
  if (coach && (gameSelector || teamSelector)) {
    return { kind: 'live', reason: 'upstream player shape' };
  }
  return { kind: 'ambiguous', reason: 'player token does not match an upstream player shape' };
}
