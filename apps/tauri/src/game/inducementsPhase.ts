/**
 * In-game INDUCEMENTS PHASE view model (owner design handoff,
 * `HANDOFF-inducements-phase.md`). Pure projection: every number here is a
 * MIRROR of a server field — nothing predicts server acceptance.
 *
 * SERVER-DERIVED LAW. The whole money model comes off one dialog:
 * `DialogBuyPrayersAndInducementsParameter` (ffb-common
 * DialogBuyPrayersAndInducementsParameter.java:66-71 writes teamId /
 * availableGold / usesTreasury / pettyCash / treasury).
 * bb2025 StepBuyInducements.java:307-345 `getAvailableGold` fills them:
 *
 *   - OVERDOG leg (`showDialog(overDog, freeCash, true, …)`, line 265):
 *     usesTreasury = true  → pettyCash = 0, availableGold = treasury =
 *     freeCash + team.getTreasury(). One pool, no petty/scum split.
 *   - UNDERDOG leg (`swapTeam` → `showDialog(team, freeCash, parallel || …, true)`,
 *     line 349): usesTreasury = false → pettyCash = TV-diff petty (+ the
 *     overdog's spend), `treasury` = Math.min(MAX_UNDERDOG_ALLOWANCE (50000),
 *     team.getTreasury()) and availableGold = pettyCash + treasury.
 *
 * ⇒ `usesTreasury` IS the overdog/underdog discriminator on the wire, and the
 * dialog's `treasury` field is ALREADY the spec's "Scum Cash" (the server has
 * done the min(50k, treasury) itself). The client never recomputes that cap; the
 * team's ACTUAL treasury for the third readout is read off the team model
 * (`Team.treasury`), not the dialog.
 *
 * StepBuyInducements.java:171-175 throws (and shutdownGame closes both sessions)
 * when a coach spends past availableGold, so `canAdd` below is a UX guard that
 * keeps us away from that cliff — the spec requires it; the SERVER remains the
 * enforcer.
 */

import { BB2025_MERCENARY_SKILLS_BY_CATEGORY } from './bb2025MercenarySkills.generated';

/** One buyable row as the store projects it (store.ts `buildInducementOptions`). */
export interface PhaseOption {
  key: string;
  label: string;
  cost: number;
  max: number;
  available: boolean;
  star?: boolean;
}

/** Which coach a panel/dialog leg belongs to. */
export type InducementRole = 'overdog' | 'underdog';

/** Spec phase machine: overdog selecting → underdog selecting → locked. */
export type InducementPhase = 'overdog' | 'underdog' | 'done';

/** The three picker blades. `staff:` rows ride the Inducements blade (see `bladeOf`). */
export type Blade = 'inducements' | 'stars' | 'mercenaries';

export type PickMap = Readonly<Record<string, number>>;

/**
 * Wire → role. `usesTreasury` true is the overdog leg (unlimited-treasury pool,
 * pettyCash 0); false is the underdog leg (petty + capped scum).
 * StepBuyInducements.java:265 vs :349.
 */
export function roleFromWire(usesTreasury: boolean): InducementRole {
  return usesTreasury ? 'overdog' : 'underdog';
}

/**
 * Blade routing off the option key minted by inducementCatalog.ts
 * (`star:<id>` / `merc:<id>` / `staff:<id>` / bare BB2025 inducement type).
 *
 * The handoff only names three blades, but the server also offers INFAMOUS_STAFF
 * rows (InfamousStaffTableModel.java:105-121). Dropping them would hide a legal
 * purchase, which violates "only surface options the server offers", so they ride
 * the Inducements blade — `infamousStaff` is itself a BB2025 inducement type.
 * OPEN SPEC QUESTION for the owner: own blade, or keep them here?
 */
export function bladeOf(key: string): Blade {
  if (key.startsWith('star:')) return 'stars';
  if (key.startsWith('merc:')) return 'mercenaries';
  return 'inducements';
}

/** Stable blade order for the summary stacks: Inducements → Star Players → Mercenaries. */
const SUMMARY_ORDER: readonly Blade[] = ['inducements', 'stars', 'mercenaries'];

/** Spec: card kind label + its colour token. */
export const KIND_LABEL: Readonly<Record<Blade, string>> = {
  inducements: 'Inducement',
  stars: 'Star Player',
  mercenaries: 'Mercenary',
};

export interface PhaseMoney {
  role: InducementRole;
  /** Hard spend ceiling — the server's availableGold. Adds past this are refused. */
  cap: number;
  spent: number;
  /** Overdog only: cap − spent. */
  remaining: number;
  /** Underdog only: petty cash left (petty is spent FIRST). */
  pettyLeft: number;
  /** Underdog only: scum cash left, out of the server's capped allowance. */
  scumLeft: number;
  /** Underdog only: the team's live treasury, depleting 1:1 with scum spend. */
  treasuryLeft: number;
}

export interface MoneyInput {
  role: InducementRole;
  /** Dialog `availableGold`. */
  availableGold: number;
  /** Dialog `pettyCash` (0 on the overdog leg). */
  pettyCash: number;
  /** Dialog `treasury` — ALREADY min(50k, treasury); the scum-cash pool. */
  scumPool: number;
  /** Team model `treasury` — the actual balance, for the third readout only. */
  teamTreasury: number;
  spent: number;
}

/**
 * Money readouts. Underdog spends PETTY FIRST, then scum; scum spend depletes the
 * displayed treasury 1:1. The only arithmetic the client owns is subtraction from
 * server-sent pools — the min(50k, treasury) cap arrives pre-computed.
 */
export function phaseMoney(input: MoneyInput): PhaseMoney {
  const { role, availableGold, pettyCash, scumPool, teamTreasury, spent } = input;
  if (role === 'overdog') {
    // usesTreasury leg: a single pool, no petty/scum split (pettyCash is 0).
    return {
      role, cap: availableGold, spent,
      remaining: availableGold - spent,
      pettyLeft: 0, scumLeft: 0, treasuryLeft: Math.max(0, teamTreasury - spent),
    };
  }
  const pettySpent = Math.min(spent, pettyCash);
  const scumSpent = Math.max(0, spent - pettyCash);
  const treasuryLeft = Math.max(0, teamTreasury - scumSpent);
  return {
    role, cap: availableGold, spent,
    remaining: availableGold - spent,
    pettyLeft: Math.max(0, pettyCash - pettySpent),
    // Scum can never exceed what's actually left in the treasury (they move
    // together once treasury < 50k — the server already bound them at send).
    scumLeft: Math.max(0, Math.min(scumPool - scumSpent, treasuryLeft)),
    treasuryLeft,
  };
}

/** Total cost of a pick map against the offered options. */
export function spentOf(picks: PickMap, options: readonly PhaseOption[]): number {
  return options.reduce((sum, o) => sum + (picks[o.key] ?? 0) * o.cost, 0);
}

export interface AddGuard {
  ok: boolean;
  /** Why the add was refused — for the disabled/dimmed card state, never sent to the server. */
  reason?: 'unavailable' | 'at-max' | 'insufficient-funds' | 'selector-limit';
}

/**
 * The spec's required client-side add block (the prototype lacks it):
 * refuse any add that would push spend past petty + scum (= availableGold).
 * A UX guard only — StepBuyInducements.java:171-175 is the real enforcer.
 */
export function canAdd(
  option: PhaseOption,
  picks: PickMap,
  options: readonly PhaseOption[],
  cap: number,
  selectorLimit?: { taken: number; max: number },
): AddGuard {
  if (!option.available) return { ok: false, reason: 'unavailable' };
  if ((picks[option.key] ?? 0) >= option.max) return { ok: false, reason: 'at-max' };
  if (selectorLimit && selectorLimit.taken >= selectorLimit.max) return { ok: false, reason: 'selector-limit' };
  if (spentOf(picks, options) + option.cost > cap) return { ok: false, reason: 'insufficient-funds' };
  return { ok: true };
}

export interface SummaryCard {
  key: string;
  name: string;
  blade: Blade;
  kind: string;
  qty: number;
  /** qty × unit cost. */
  total: number;
  /** ×N badge: inducements and mercs only, never stars, and only when qty > 1. */
  showBadge: boolean;
}

/**
 * The side-panel stack. Order is ALWAYS Inducements → Star Players → Mercenaries
 * regardless of the order the coach picked them (spec, "Card list").
 */
export function summaryCards(picks: PickMap, options: readonly PhaseOption[]): SummaryCard[] {
  const byKey = new Map(options.map((o) => [o.key, o]));
  const cards: SummaryCard[] = [];
  for (const blade of SUMMARY_ORDER) {
    for (const [key, qty] of Object.entries(picks)) {
      if (qty <= 0) continue;
      const option = byKey.get(key);
      if (!option || bladeOf(key) !== blade) continue;
      cards.push({
        key, name: option.label, blade, kind: KIND_LABEL[blade], qty,
        total: option.cost * qty,
        // Stars are atomic 1-of hires (inducementCatalog max:1) — never badged.
        showBadge: blade !== 'stars' && qty > 1,
      });
    }
  }
  return cards;
}

/** Skill → category, inverted from the generated BB2025 table; unknown = TRAIT (Loner, Regeneration, …). */
const SKILL_CATEGORY: ReadonlyMap<string, string> = (() => {
  const index = new Map<string, string>();
  for (const [category, skills] of Object.entries(BB2025_MERCENARY_SKILLS_BY_CATEGORY)) {
    for (const skill of skills as readonly string[]) index.set(skill, category);
  }
  return index;
})();

/** Theme token for a printed skill's category colour (README skill-category colours). */
export function skillToken(skill: string): string {
  // Strip an upstream modifier suffix ("Mighty Blow (+2)") before the lookup.
  const base = skill.replace(/\s*\(.*\)\s*$/, '').trim();
  switch (SKILL_CATEGORY.get(base)) {
    case 'GENERAL': return 'var(--ui-skill-general)';
    case 'AGILITY': return 'var(--ui-skill-agility)';
    case 'STRENGTH': return 'var(--ui-skill-strength)';
    case 'PASSING':
    case 'DEVIOUS': return 'var(--ui-skill-passing)';
    case 'MUTATION': return 'var(--ui-skill-mutation)';
    default: return 'var(--ui-skill-trait)';
  }
}

/**
 * Phase machine. Derived from which leg of StepBuyInducements is live for us:
 * `myRole` is the role of the dialog currently addressed to me (null = no live
 * dialog), `oppConfirmed` mirrors inducementReveal.opp.ready, `mineConfirmed`
 * mirrors inducementReveal.mine.
 *
 * Note the overdog leg can be SKIPPED entirely — showDialog returns false when
 * minimumInducementCost > availableGold and init() falls straight to swapTeam
 * (StepBuyInducements.java:267-269). A phase that opens directly on 'underdog'
 * is therefore legal, not a bug.
 */
export function phaseOf(input: {
  myRole: InducementRole | null;
  iAmWaiting: boolean;
  mineConfirmed: boolean;
  oppConfirmed: boolean;
}): InducementPhase {
  if (input.myRole) return input.myRole;
  // No dialog addressed to me: either I'm waiting on the overdog leg (I'm the
  // underdog), or both legs are answered.
  if (input.iAmWaiting) return 'overdog';
  if (input.mineConfirmed && input.oppConfirmed) return 'done';
  // I've confirmed and the opponent hasn't — they hold the remaining leg.
  return input.mineConfirmed ? 'underdog' : 'done';
}

/** Format gold the way the rest of the client does (300000 → "300k"). */
export function fmtGold(gold: number): string {
  return `${Math.round(gold / 1000)}k`;
}
