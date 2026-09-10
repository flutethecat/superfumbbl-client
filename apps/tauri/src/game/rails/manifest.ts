import { RAIL_IDS, type RailId, type RailManifestEntry } from './contracts';

type RailManifestDetails = Pick<RailManifestEntry, 'upstreamOwners' | 'fixtureFamilies'>;

// This Record is the CI gate: adding a RailId without manifest details is a type error.
const RAIL_MANIFEST_DETAILS = {
  kickoff: { upstreamOwners: ['generator/bb2025/Kickoff.java'], fixtureFamilies: ['kickoff'] },
  setup: {
    upstreamOwners: ['bb2025/setup/StepSetup.java', 'bb2025/kickoff/StepSwarming.java'],
    fixtureFamilies: ['setup', 'swarming'],
  },
  'turn-control': { upstreamOwners: ['AbstractStep.java'], fixtureFamilies: ['turnEnd'] },
  move: { upstreamOwners: ['MoveLogicModule.java'], fixtureFamilies: ['move', 'pickup', 'trapdoor'] },
  block: {
    upstreamOwners: ['AbstractBlockLogicModule.java', 'bb2025/BlockLogicModule.java'],
    fixtureFamilies: ['block', 'pushback', 'followup'],
  },
  blitz: {
    upstreamOwners: ['BlitzLogicModule.java', 'bb2025/SelectBlitzTargetLogicModule.java'],
    fixtureFamilies: ['blitz'],
  },
  foul: { upstreamOwners: ['bb2025/FoulLogicModule.java'], fixtureFamilies: ['foul', 'sendoff'] },
  'pass-family': {
    upstreamOwners: ['bb2025/PassLogicModule.java', 'ThrowTeamMateLogicModule.java'],
    fixtureFamilies: ['pass', 'handoff', 'bomb', 'ttm'],
  },
  'special-action': { upstreamOwners: ['bb2025/SelectLogicModule.java'], fixtureFamilies: ['clientAction'] },
  'square-picker': { upstreamOwners: ['ClientStateFactory.java'], fixtureFamilies: ['coordinate-dialog'] },
  'skill-use': { upstreamOwners: ['DialogSkillUseHandler.java'], fixtureFamilies: ['skillUse'] },
  'reactive-dialog': { upstreamOwners: ['DialogManager.java'], fixtureFamilies: ['dialog'] },
  inducement: { upstreamOwners: ['DialogManager.java'], fixtureFamilies: ['inducement'] },
  reroll: { upstreamOwners: ['DialogReRollHandler.java'], fixtureFamilies: ['reroll'] },
  reaction: {
    upstreamOwners: ['InterceptionLogicModule.java', 'DumpOffLogicModule.java', 'PushbackLogicModule.java'],
    fixtureFamilies: ['reaction'],
  },
  'end-game': { upstreamOwners: ['generator/bb2025/EndGame.java'], fixtureFamilies: ['endGame'] },
  unknown: { upstreamOwners: ['DialogId.java', 'PlayerAction.java'], fixtureFamilies: ['unknown'] },
} as const satisfies Record<RailId, RailManifestDetails>;

export const RAIL_MANIFEST: readonly RailManifestEntry[] = Object.entries(RAIL_MANIFEST_DETAILS).map(([
  id,
  { upstreamOwners, fixtureFamilies },
]) => ({
  id: id as RailId,
  upstreamOwners,
  fixtureFamilies,
  modelOwner: 'server' as const,
  presentationFor: ['player', 'spectator', 'replay'] as const,
  commandFor: id === 'unknown' ? [] : ['player'],
  unknownPolicy: 'diagnostic-no-send' as const,
}));

export function assertSpectatorSafeManifest(entries: readonly RailManifestEntry[]): void {
  for (const entry of entries) {
    if (entry.commandFor.includes('spectator') || entry.commandFor.includes('replay')) {
      throw new Error(`${entry.id} grants a read-only audience command capability`);
    }
    if (entry.modelOwner !== 'server') throw new Error(`${entry.id} claims local model authority`);
  }
}

export function assertCompleteRailManifest(entries: readonly RailManifestEntry[]): void {
  const manifestIds = new Set(entries.map((entry) => entry.id));
  for (const rail of Object.keys(RAIL_IDS) as RailId[]) {
    if (!manifestIds.has(rail)) throw new Error(`RAIL_MANIFEST missing rail ${rail}`);
  }
}

assertSpectatorSafeManifest(RAIL_MANIFEST);
assertCompleteRailManifest(RAIL_MANIFEST);
