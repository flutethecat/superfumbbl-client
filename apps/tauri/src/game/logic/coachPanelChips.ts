import type { InducementSetJson, TurnDataJson } from '@fumbbl40k/ffb-protocol';

/**
 * Coach-panel resource chip: one icon per remaining charge-family (re-rolls,
 * apothecaries, purchased inducements/prayers/cards). Owner ruling 2026-08-17:
 * a used inducement DISAPPEARS from the panel — every count here must come
 * from a field the server actively decrements, never a purchase-time snapshot.
 */
export interface InducementChip {
  icon: string;
  count: number;
  label: string;
  pool?: 'base' | 'drive' | 'single-use';
  badge?: string;
}

type CoachPanelTurnData = Pick<TurnDataJson, 'reRolls' | 'apothecaries' | 'inducementSet'> & {
  wanderingApothecaries?: unknown;
  rerollBrilliantCoachingOneDrive?: unknown;
  rerollPumpUpTheCrowdOneDrive?: unknown;
  rerollShowStarOneDrive?: unknown;
  singleUseReRolls?: unknown;
};

function remaining(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
}

/** Resource icons for coach-panel inducement charges. This begins with upstream
 * slot-icon parity and includes owner-supplied client art for additional types. */
const INDUCEMENT_ICONS: Record<string, string> = {
  bribes: 'bribe',
  prayers: 'prayer',
  wizard: 'wizard',
  masterChef: 'master_chef',
  halflingMasterChef: 'master_chef',
  bloodweiserKegs: 'bloodweiser_keg',
  bloodweiserBabes: 'bloodweiser_keg',
  bugmansXXXXXX: 'bloodweiser_keg',
  biasedRef: 'biased_ref',
  igor: 'igor',
  igors: 'igor',
  mortuaryAssistant: 'mortuary_assistant',
  plagueDoctor: 'plague_doctor',
  wanderingApothecaries: 'wandering_apothecary',
  weatherMage: 'weather_mage',
  dwarfenWisdom: 'dwarfen_wisdom',
  teamMascot: 'team_mascot',
  briberyAndCorruption: 're_roll_argue',
};

/**
 * Bug (owner screenshot 2026-08-17): `wanderingApothecaries` is bought as a
 * regular inducementSet entry (`inducementSetAddInducement`), but the server
 * NEVER sends a matching inducementSet uses-decrement when one is consumed —
 * consumption rides `turnDataSetApothecaries`/`turnDataSetWanderingApothecaries`
 * on TurnData instead (server log game_861, frame commandNr 444: `{"modelChangeId":
 * "turnDataSetWanderingApothecaries","modelChangeKey":"home","modelChangeValue":1},
 * {"modelChangeId":"turnDataSetApothecaries","modelChangeKey":"home","modelChangeValue":1}`,
 * no inducementSet change in the same frame). So the purchase-time
 * inducementArray entry's `value - uses` is a frozen snapshot for this one
 * type; it must be overridden with the live turnData.wanderingApothecaries
 * count (and dropped once that hits zero) instead of trusted as-is.
 */
export function buildInducementChips(turnData: CoachPanelTurnData): InducementChip[] {
  // `reRolls` is the server's aggregate team-reroll total: each drive-scoped
  // grant increments it as well as its source counter, and consumption/expiry
  // decrements both. Subtract the source counters so the ordinary chip remains
  // the purchased/base pool instead of double-counting the temporary chips.
  const drivePools = [
    { count: remaining(turnData.rerollBrilliantCoachingOneDrive), badge: 'BC', source: 'Brilliant Coaching' },
    { count: remaining(turnData.rerollPumpUpTheCrowdOneDrive), badge: 'PU', source: 'Pump Up The Crowd' },
    { count: remaining(turnData.rerollShowStarOneDrive), badge: 'STAR', source: 'Star of the Show' },
  ];
  const driveTotal = drivePools.reduce((sum, pool) => sum + pool.count, 0);
  const chips: InducementChip[] = [{
    icon: 're_roll',
    count: Math.max(0, remaining(turnData.reRolls) - driveTotal),
    label: 'Base team re-rolls',
    pool: 'base',
  }];
  for (const pool of drivePools) {
    if (pool.count > 0) chips.push({
      icon: 're_roll',
      count: pool.count,
      label: `${pool.source} re-roll — expires at the end of the following drive`,
      pool: 'drive',
      badge: pool.badge,
    });
  }
  const singleUse = remaining(turnData.singleUseReRolls);
  if (singleUse > 0) chips.push({
    icon: 're_roll',
    count: singleUse,
    label: 'Single-use re-rolls',
    pool: 'single-use',
    badge: '1×',
  });
  if ((turnData.apothecaries ?? 0) > 0) chips.push({ icon: 'apothecary', count: turnData.apothecaries, label: 'Apothecary' });

  const set = turnData.inducementSet as InducementSetJson;
  const byType = new Map<string, number>();
  for (const entry of set.inducementArray as { inducementType?: string; value?: number; uses?: number }[]) {
    const remaining = Math.max(0, (entry.value ?? 1) - (entry.uses ?? 0));
    if (remaining > 0) byType.set(entry.inducementType ?? 'card', (byType.get(entry.inducementType ?? 'card') ?? 0) + remaining);
  }

  if (byType.has('wanderingApothecaries')) {
    const live = typeof turnData.wanderingApothecaries === 'number'
      ? turnData.wanderingApothecaries
      : byType.get('wanderingApothecaries')!;
    if (live > 0) byType.set('wanderingApothecaries', live);
    else byType.delete('wanderingApothecaries');
  }

  for (const [type, count] of byType) {
    const icon = INDUCEMENT_ICONS[type];
    if (icon) chips.push({ icon, count, label: type }); // unmapped types have no coach-panel chip
  }
  if (set.prayers.length > 0) chips.push({ icon: 'prayer', count: set.prayers.length, label: 'Prayers' });
  const cards = set.cardsAvailable.length + set.cardsActive.length;
  if (cards > 0) chips.push({ icon: 'card', count: cards, label: 'Cards' });
  return chips;
}
