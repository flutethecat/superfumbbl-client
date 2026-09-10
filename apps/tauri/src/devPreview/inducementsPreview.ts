/**
 * DEV-ONLY verification harness for the inducements phase screen (not shipped —
 * reachable only at /inducements-preview.html under `vite dev`).
 *
 * Drives InducementsPhase.vue with MOCKED server state so all three phases and
 * both seats can be eyeballed against `Inducements Pane.dc.html` without a live
 * fork game. The fixture numbers are the handoff's (petty 340k / treasury 150k →
 * scum 50k) so the money readouts can be checked by hand.
 */
import { createApp, h, reactive } from 'vue';
import { applyTheme } from '../game/theme';
import InducementsPhase, { type PanelView, type PickerCard, type SummaryCardView } from '../components/InducementsPhase.vue';
import {
  KIND_LABEL, bladeOf, phaseMoney, summaryCards,
  type Blade, type InducementPhase, type InducementRole, type PhaseOption,
} from '../game/inducementsPhase';

const OPTIONS: PhaseOption[] = [
  { key: 'bribes', label: 'Bribe', cost: 100_000, max: 3, available: true },
  { key: 'halflingMasterChef', label: 'Halfling Master Chef', cost: 300_000, max: 1, available: true },
  { key: 'wanderingApothecaries', label: 'Wandering Apothecary', cost: 100_000, max: 2, available: true },
  { key: 'biasedRef', label: 'Biased Referee', cost: 120_000, max: 1, available: true },
  { key: 'prayers', label: 'Prayers to Nuffle', cost: 50_000, max: 3, available: true },
  { key: 'teamMascot', label: 'Team Mascot', cost: 30_000, max: 1, available: true },
  { key: 'partTimeCoach', label: 'Part-time Assistant Coach', cost: 20_000, max: 5, available: true },
  { key: 'tempCheerleader', label: 'Temp Agency Cheerleader', cost: 20_000, max: 5, available: true },
  { key: 'weatherMage', label: 'Weather Mage', cost: 30_000, max: 1, available: true },
  { key: 'wizard', label: 'Sports Wizard', cost: 150_000, max: 1, available: true },
  { key: 'bloodweiserBabes', label: "Blitzer's Best Kegs", cost: 50_000, max: 2, available: true },
  { key: 'josefBugman', label: 'Infamous Coaching Staff: Josef Bugman', cost: 100_000, max: 1, available: true },
  { key: 'star:M1', label: "Morg 'n' Thorg", cost: 340_000, max: 1, available: true, star: true },
  { key: 'star:M2', label: 'Karla von Kill', cost: 210_000, max: 1, available: true, star: true },
  { key: 'star:M3', label: 'Zolcath the Zoat', cost: 230_000, max: 1, available: true, star: true },
  { key: 'star:M4', label: 'Akhorne the Squirrel', cost: 80_000, max: 1, available: true, star: true },
  { key: 'star:M5', label: 'Grak & Crumbleberry', cost: 250_000, max: 1, available: true, star: true },
  { key: 'star:M6', label: 'Glotl Stop', cost: 270_000, max: 1, available: true, star: true },
  { key: 'merc:P1', label: 'Mercenary Lineman', cost: 130_000, max: 3, available: true },
  { key: 'merc:P2', label: 'Mercenary Thrower', cost: 150_000, max: 1, available: true },
  { key: 'merc:P3', label: 'Mercenary Catcher', cost: 145_000, max: 1, available: true },
  { key: 'merc:P4', label: 'Mercenary Blitzer', cost: 175_000, max: 2, available: true },
];

const STATS: Record<string, number[]> = {
  'star:M1': [5, 6, 3, 4, 11], 'star:M2': [6, 4, 3, 4, 9], 'star:M3': [5, 5, 4, 5, 10],
  'star:M4': [7, 1, 2, 0, 6], 'star:M5': [5, 5, 4, 5, 10], 'star:M6': [4, 5, 4, 0, 10],
  'merc:P1': [6, 3, 3, 4, 9], 'merc:P2': [6, 3, 3, 2, 9], 'merc:P3': [8, 2, 3, 5, 8], 'merc:P4': [7, 3, 3, 4, 9],
};
const SKILLS: Record<string, string[]> = {
  'star:M1': ['Block', 'Mighty Blow (+2)', 'Thick Skull', 'Throw Team-mate', 'Loner (4+)'],
  'star:M2': ['Block', 'Dauntless', 'Dodge', 'Jump Up', 'Loner (4+)'],
  'star:M3': ['Dodge', 'Juggernaut', 'Prehensile Tail', 'Regeneration', 'Sure Feet', 'Loner (4+)'],
  'star:M4': ['Claws', 'Dauntless', 'Dodge', 'Frenzy', 'Jump Up', 'Loner (4+)'],
  'star:M5': ['Kick Team-mate', 'Loner (4+)', 'Mighty Blow (+1)', 'Thick Skull'],
  'star:M6': ['Frenzy', 'Loner (4+)', 'Mighty Blow (+1)', 'Prehensile Tail', 'Stand Firm'],
};
const SPECIAL: Record<string, string> = {
  'star:M1': 'The Ballista: +1 to injury with Mighty Blow',
  'star:M2': 'Indomitable: re-roll a failed Dauntless roll',
  'star:M3': 'Excuse Me, Are You a Zoat?',
  'star:M4': 'The Death of Kings',
  'star:M5': 'Two for One: hired with Crumbleberry',
  'star:M6': 'Blind Rage',
};
const GLYPH: Record<string, string> = {
  bribes: '⚖', halflingMasterChef: '🍲', wanderingApothecaries: '✚', biasedRef: '⚑',
  prayers: '☨', teamMascot: '☂', partTimeCoach: '📣', tempCheerleader: '★',
  weatherMage: '☁', wizard: '⚡', bloodweiserBabes: '🍺', josefBugman: '🍻',
};

const STAT_KEYS = ['MA', 'ST', 'AG', 'PA', 'AV'] as const;
const statChips = (key: string) =>
  (STATS[key] ?? []).map((v, i) => ({ k: STAT_KEYS[i] ?? '', v: i >= 2 ? `${v}+` : String(v) }));

// The pane reads --ui-* tokens; the real app applies them at boot, so do the same
// here with the Black/Red preset the handoff's palette was derived from.
applyTheme('brand-red', '#790004', '#000000');

const state = reactive({
  phase: 'overdog' as InducementPhase,
  seat: 'overdog' as InducementRole,
  blade: 'inducements' as Blade,
  picks: {} as Record<string, number>,
  /** Tournament/league preset mode: read-only allocations + TOURNAMENT MODE banner. */
  preset: false,
});

/** Preselections mirroring the prototype's fixture, so the summaries are populated. */
// Kept inside each side's cap so the readouts stay meaningful: the overdog sits
// at 180k of 400k, and the underdog at 350k — 340k petty exhausted plus 10k drawn
// from scum, which is exactly the petty→scum→treasury cascade to eyeball.
const OVERDOG_PICKS = { bribes: 1, 'star:M4': 1 };
const UNDERDOG_PICKS = { halflingMasterChef: 1, prayers: 1 };

function pickerCards(): Record<Blade, PickerCard[]> {
  const out: Record<Blade, PickerCard[]> = { inducements: [], stars: [], mercenaries: [] };
  for (const option of OPTIONS) {
    const blade = bladeOf(option.key);
    const taken = state.picks[option.key] ?? 0;
    out[blade].push({
      key: option.key, name: option.label, cost: option.cost,
      costLabel: option.cost > 0 ? `${option.cost / 1000}k` : '—',
      countLabel: blade === 'stars' ? (taken > 0 ? 'Hired' : '1 available')
        : `${taken} of ${option.max} ${blade === 'mercenaries' ? 'hired' : 'taken'}`,
      portrait: { url: null, glyph: blade === 'inducements' ? (GLYPH[option.key] ?? '◆') : blade === 'stars' ? '★' : '⚔' },
      stats: statChips(option.key), skills: SKILLS[option.key] ?? [], special: SPECIAL[option.key] ?? null,
      option,
    });
  }
  return out;
}

function cardsOf(picks: Record<string, number>): SummaryCardView[] {
  return summaryCards(picks, OPTIONS).map((c) => ({
    key: c.key, name: c.name, blade: c.blade, kind: KIND_LABEL[c.blade], qty: c.qty,
    totalLabel: `${c.total / 1000}k`, showBadge: c.showBadge,
    portrait: { url: null, glyph: c.blade === 'inducements' ? (GLYPH[c.key] ?? '◆') : c.blade === 'stars' ? '★' : '⚔' },
    skills: SKILLS[c.key] ?? [],
  }));
}

const OVER_MONEY = (spent: number) => phaseMoney({
  role: 'overdog', availableGold: 400_000, pettyCash: 0, scumPool: 400_000, teamTreasury: 400_000, spent,
});
const UNDER_MONEY = (spent: number) => phaseMoney({
  role: 'underdog', availableGold: 390_000, pettyCash: 340_000, scumPool: 50_000, teamTreasury: 150_000, spent,
});

function panelFor(role: InducementRole): PanelView {
  const mine = role === state.seat;
  const live = state.phase === role;
  const picks = mine && live ? state.picks : role === 'overdog' ? OVERDOG_PICKS : UNDERDOG_PICKS;
  const confirmed = state.phase === 'done' || (role === 'overdog' && state.phase === 'underdog');
  const spent = summaryCards(picks, OPTIONS).reduce((n, c) => n + c.total, 0);
  const showCards = confirmed || live;
  return {
    role, seat: role === 'overdog' ? 'home' : 'away',
    team: role === 'overdog' ? 'Deathskull Ladz · GrimIronjaw' : 'Penguin Academy · TheArtemisBlack',
    status: confirmed ? 'confirmed' : live ? 'selecting' : 'waiting',
    money: mine ? (role === 'overdog' ? OVER_MONEY(spent) : UNDER_MONEY(spent)) : null,
    cards: showCards ? cardsOf(picks) : [],
    editable: mine && live,
    dimmed: role === 'underdog' && state.phase === 'overdog',
    emptyNote: live ? 'Nothing selected yet.' : confirmed ? 'No inducements.' : 'Waiting…',
  };
}

/** The seat may act only during its own leg ('done' matches neither role). */
const canAct = () => state.phase === state.seat;

createApp({
  render: () => h(InducementsPhase, {
    phase: state.phase,
    overdog: panelFor('overdog'),
    underdog: panelFor('underdog'),
    mySide: state.seat,
    canAct: canAct() && !state.preset,
    picks: state.picks,
    options: canAct() ? OPTIONS : [],
    cap: state.seat === 'overdog' ? 400_000 : 390_000,
    blade: state.blade,
    cards: pickerCards(),
    selectorLimits: { stars: 2, mercenaries: 4, staff: 2 },
    confirmPending: false,
    presetMode: state.preset,
    onAcknowledge: () => { state.preset = false; },
    onBlade: (b: Blade) => { state.blade = b; },
    onAdd: (k: string) => { state.picks[k] = (state.picks[k] ?? 0) + 1; },
    onRemove: (k: string) => {
      const n = (state.picks[k] ?? 0) - 1;
      if (n <= 0) delete state.picks[k]; else state.picks[k] = n;
    },
    onClear: () => { for (const k of Object.keys(state.picks)) delete state.picks[k]; },
    onConfirm: () => { state.phase = state.phase === 'overdog' ? 'underdog' : 'done'; },
  }),
}).mount('#app');

// Harness toolbar: phase × seat switches, so both seats can be shot in every phase.
const bar = document.getElementById('bar')!;
function button(label: string, on: () => boolean, go: () => void) {
  const b = document.createElement('button');
  b.textContent = label;
  const sync = () => b.setAttribute('data-on', String(on()));
  b.onclick = () => { go(); document.querySelectorAll('#bar button').forEach((x) => (x as HTMLElement & { sync?: () => void }).sync?.()); };
  (b as HTMLElement & { sync?: () => void }).sync = sync;
  sync();
  bar.appendChild(b);
}
for (const p of ['overdog', 'underdog', 'done'] as const) {
  button(`phase: ${p}`, () => state.phase === p, () => { state.phase = p; for (const k of Object.keys(state.picks)) delete state.picks[k]; });
}
for (const s of ['overdog', 'underdog'] as const) {
  button(`seat: ${s}`, () => state.seat === s, () => { state.seat = s; });
}
button('preset (tournament)', () => state.preset, () => { state.preset = !state.preset; });
