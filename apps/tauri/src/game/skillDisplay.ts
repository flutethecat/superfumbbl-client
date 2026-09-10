import type { GameJson, PlayerJson, TeamJson } from '@fumbbl40k/ffb-protocol';
import { playerSkillDisplayEntries, playerSkillNames } from '@fumbbl40k/ffb-protocol';
import type { AutoMarkingConfig } from './markings';
import {
  settings,
  iconBehaviourDefault,
  MARKER_BEHAVIOUR_DEFAULT,
  type SkillBehaviour,
  type AppSettings,
} from './settings';

/**
 * Per-skill display config (owner 2026-07-03 r6f). Turns the sparse
 * `settings.skillConfig` into the per-player icon-skill lists + marker strings the
 * renderer draws (renderer.setPlayerIconSkills / setPlayerMarkings), honouring the
 * MY TEAM (home coach) / OPPOSITION (away coach) behaviour columns:
 *   - "All the time" (always) — always show the skill,
 *   - "Only if added" (added) — show only when the skill was GAINED as an
 *     advancement (i.e. NOT a baseline positional skill),
 *   - "Never" — always hidden.
 * Markers additionally carry a per-skill glyph (`markerText`), pre-filled from the
 * imported FUMBBL JSON but overridden by a user value.
 */

interface PositionLike {
  positionId: string;
  skillArray?: string[];
  movement?: number;
  strength?: number;
  agility?: number;
  passing?: number;
  armour?: number;
}

function baselineSkillsFor(team: TeamJson, player: PlayerJson): Set<string> {
  const roster = team.roster as { positionArray?: PositionLike[] };
  const position = roster.positionArray?.find((p) => p.positionId === player.positionId);
  return new Set(position?.skillArray ?? []);
}

/** Does a skill show given its behaviour and whether it's a baseline (positional) skill? */
function shows(behaviour: SkillBehaviour, isBaseline: boolean): boolean {
  return behaviour === 'always' ? true : behaviour === 'added' ? !isBaseline : false;
}

function iconBehaviour(skill: string, mine: boolean): SkillBehaviour {
  const entry = settings.skillConfig[skill];
  const v = mine ? entry?.iconMine : entry?.iconOpp;
  return v ?? iconBehaviourDefault();
}

function markerBehaviour(skill: string, mine: boolean): SkillBehaviour {
  const entry = settings.skillConfig[skill];
  const v = mine ? entry?.markerMine : entry?.markerOpp;
  return v ?? MARKER_BEHAVIOUR_DEFAULT;
}

/**
 * Base + TEMPORARY skills, through the one shared decoder. The Wisdom-only special case (which scraped the
 * protocol's `ffb40k:` diagnostic log because incremental changes never reached the model) is gone: every
 * temporary grant — prayers, Intensive Training, cards, Wisdom — now lands in `temporarySkillsMap` under its
 * upstream source name on both the incremental and the full-sync path, and expires through
 * FIELD_MODEL_REMOVE_PRAYER / REMOVE_SKILL_ENHANCEMENTS.
 */
function displayedSkills(player: PlayerJson): string[] {
  return playerSkillNames(player);
}

/** Permanent characteristic changes and niggling injuries are status icons, not
 * configurable skills. Keep them at the front of the four-icon rail so a lasting
 * injury cannot be hidden behind ordinary skill badges. */
function characteristicStatusIcons(team: TeamJson, player: PlayerJson): string[] {
  const roster = team.roster as { positionArray?: PositionLike[] };
  const position = roster.positionArray?.find((candidate) => candidate.positionId === player.positionId);
  const icons: string[] = [];
  const compare = (
    key: 'MA' | 'ST' | 'AG' | 'PA' | 'AV',
    current: number | undefined,
    base: number | undefined,
    lowerIsBetter: boolean,
  ) => {
    if (!Number.isFinite(current) || !Number.isFinite(base) || current === base) return;
    const improved = lowerIsBetter ? current! < base! : current! > base!;
    icons.push(`${improved ? '+' : '-'}${key}`);
  };
  if (position) {
    compare('MA', player.movement, position.movement, false);
    compare('ST', player.strength, position.strength, false);
    compare('AG', player.agility, position.agility, true);
    compare('PA', player.passing, position.passing, true);
    compare('AV', player.armour, position.armour, false);
  }
  if ((player.lastingInjuries ?? []).some((injury) => /niggl|\bNI\b/i.test(String(injury)))) icons.push('NI');
  return icons;
}

export interface PlayerDetailSkill {
  /** Canonical key retained for icons and rules text. */
  name: string;
  /** Human-readable label, including server-valued skills. */
  label: string;
  /** Not part of the positional baseline (Classic's green-acquired style). */
  added: boolean;
}

/** Shared Modern/Classic player-card skill projection. */
export function playerDetailSkills(
  player: PlayerJson,
  baselineSkills: ReadonlySet<string> = new Set(),
): PlayerDetailSkill[] {
  return playerSkillDisplayEntries(player).map((entry) => {
    const rawDisplayValue = player.skillDisplayValuesMap?.[entry.name];
    const displayValue = rawDisplayValue == null ? '' : String(rawDisplayValue).trim();
    return {
      name: entry.name,
      label: entry.label !== entry.name
        ? entry.label
        : displayValue ? `${entry.name} (${displayValue})` : entry.name,
      added: !baselineSkills.has(entry.name),
    };
  });
}

/** The glyph a marker shows for a skill — the user text if set, else the skill's
 *  short initials (upstream markings use the config text; JSON pre-fill fills it).
 *  Owner 2026-07-08: exported — the reroll menu (markings mode) shows each skill
 *  source with the SAME glyph the user's markings use on the pitch. */
export function markerGlyph(skill: string): string {
  const text = settings.skillConfig[skill]?.markerText;
  if (text && text.trim()) return text.trim();
  // fallback: the skill initials (e.g. "Sure Hands" → "SH"), so an enabled marker
  // without a configured glyph still shows something legible.
  return skill.split(/\s+/).map((w) => w[0]?.toUpperCase() ?? '').join('').slice(0, 3);
}

/** Per-player list of skills to draw as ICONS, honouring the per-skill config +
 *  MY TEAM / OPPOSITION behaviour + the baseline (only-if-added) rule. */
export function computeIconSkills(game: GameJson): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [team, mine] of [
    [game.teamHome, true],
    [game.teamAway, false],
  ] as [TeamJson, boolean][]) {
    for (const player of team.playerArray) {
      const baseline = baselineSkillsFor(team, player);
      const skills = displayedSkills(player).filter((s) => shows(iconBehaviour(s, mine), baseline.has(s)));
      // Owner 09-06: a stat increase already arrives as a '+ST'/'+AG'/… SKILL in skillArray AND as a characteristic
      // diff vs the roster position — one icon, not two (Set keeps first-seen order: characteristic icons lead).
      out.set(player.playerId, [...new Set([...characteristicStatusIcons(team, player), ...skills])]);
    }
  }
  return out;
}

/** True when the user has opted at least one skill into the per-skill MARKER
 *  system (any marker behaviour set to something other than Never). While false,
 *  the FUMBBL-JSON marking path stays the marking source. */
export function anyMarkerConfigured(): boolean {
  return Object.values(settings.skillConfig).some(
    (e) => (e.markerMine && e.markerMine !== 'never') || (e.markerOpp && e.markerOpp !== 'never'),
  );
}

/** Per-player marker string built from the per-skill MARKER config (glyphs joined,
 *  most specific — gained/added — first). Empty when nothing applies. */
export function computeConfigMarkings(game: GameJson): Map<string, string> {
  const out = new Map<string, string>();
  for (const [team, mine] of [
    [game.teamHome, true],
    [game.teamAway, false],
  ] as [TeamJson, boolean][]) {
    for (const player of team.playerArray) {
      const baseline = baselineSkillsFor(team, player);
      const glyphs: string[] = [];
      for (const skill of displayedSkills(player)) {
        if (shows(markerBehaviour(skill, mine), baseline.has(skill))) glyphs.push(markerGlyph(skill));
      }
      // Pitch markers are a compact glyph rail, not prose. Keep independently
      // configured skill glyphs adjacent so a five-skill player does not span
      // several squares before the renderer applies its width guard.
      const marking = glyphs.filter(Boolean).join('');
      if (marking) out.set(player.playerId, marking);
    }
  }
  return out;
}

/** #6 (owner ruling 08-17, refined 08-17b): decides how a CoachAction.icon (currently only 'Jump Up', Move row
 *  only — availableActions.ts) presents in the SpectateView context menu, branching on the SAME skillDisplay
 *  field the skill-marking cycle button + pitch glyphs use (see SpectateView skillMode/cycleSkillDisplay).
 *  TEXT mode ('markings') has no icon glyphs to reuse, so it falls back to the pre-#6 "Jump Up Move" text
 *  prefix; icon-capable modes ('icons', either bb3/bb2 style) keep the row label plain and let the caller
 *  resolve the icon (SpectateView owns skillIconUrl/effectiveIconStyle, kept out of this pure module). */
export function jumpUpMenuPresentation(
  icon: string | undefined,
  label: string,
  skillDisplay: AppSettings['skillDisplay'],
): { label: string; useIcon: boolean } {
  if (!icon) return { label, useIcon: false };
  if (skillDisplay === 'markings') return { label: `${icon} ${label}`, useIcon: false };
  return { label, useIcon: true };
}

/** Pre-fill the per-skill `markerText` defaults from a FUMBBL auto-marking config:
 *  every single-skill record (skillArray === [skill]) seeds that skill's glyph
 *  UNLESS the user already entered one. Returns the number of glyphs seeded. */
export function prefillMarkerTextFromJson(config: AutoMarkingConfig): number {
  let seeded = 0;
  for (const record of config.autoMarkingRecords ?? []) {
    if (record.skillArray?.length !== 1 || !record.marking) continue;
    const skill = record.skillArray[0]!;
    const entry = (settings.skillConfig[skill] ??= {});
    if (entry.markerText && entry.markerText.trim()) continue; // user value wins
    entry.markerText = record.marking;
    seeded++;
  }
  return seeded;
}
