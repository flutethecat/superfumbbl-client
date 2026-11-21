import type { GameJson } from '@fumbbl40k/ffb-protocol';
import { t } from '../i18n';

/**
 * Team reroll choices and their composed wire sources, ported from upstream FFB at c66198ac4 (PR #349 / #367):
 *  - ffb-common ReRollSourceComposer.java: `teamReRollSources(properties, includeMascot)` (:66-84) and `compose` (:46-53);
 *  - ffb-client-logic AbstractReRollDialogHandler.java (:33-78): Pro or the Team Mascot first ask "which reroll if it
 *    fails" (DialogReRollFallback, a client-local dialog the server never sends) and the answer is ONE composed source;
 *  - ffb-client-logic DialogExtensionReRolls.java (:31-58): the button labels, the drive bonus named from TurnData.
 *
 * Our cards offer every answer that fallback flow can produce as its own button (the existing flat idiom: "Pro, then
 * Team Reroll", "Team Mascot (no reroll if it fails)"), so one click sends exactly the source upstream's two clicks send.
 *
 * Property names: an older 3.4.0 server (and 3.3.1 replays) send TRR / MASCOT / PRO / LONER and BRILLIANT_COACHING /
 * PUMP_UP_THE_CROWD / SHOW_STAR; the c66198ac4 server sends TRR / MASCOT / PRO / LONER / DRIVE_BONUS / LEADER and only
 * ever adds DRIVE_BONUS and LEADER together with TRR (bb2025 RollMechanic.findTeamReRollProperties:656-672). LONER never
 * offers anything (it only adds the Loner warning); a team reroll is offered by TRR alone.
 */

export const TEAM_RE_ROLL_SOURCE = 'Team ReRoll';
export const DRIVE_BONUS_RE_ROLL_SOURCE = 'Drive Bonus ReRoll';
export const LEGACY_DRIVE_BONUS_PROPERTIES = ['BRILLIANT_COACHING', 'PUMP_UP_THE_CROWD', 'SHOW_STAR'] as const;

/** The team reroll part of a composed source. Leader is sent as Team ReRoll (compose :47-48: the server uses Leader first). */
export type TeamReRollPart = 'team' | 'leader' | 'driveBonus';
export type TeamReRollButton = 'mascot' | TeamReRollPart;

export interface ComposedReRollChoice {
  /** The exact ReRollSources name sent to the server. */
  source: string;
  pro: boolean;
  mascot: boolean;
  team: TeamReRollPart | null;
}

const props = (properties: readonly unknown[] | null | undefined): Set<string> =>
  new Set((properties ?? []).map((property) => String(property)));

/** True when the dialog carries the c66198ac4 property names (a drive bonus or a Leader reroll is offered). */
export function hasDriveBonusOrLeader(properties: readonly unknown[] | null | undefined): boolean {
  const set = props(properties);
  return set.has('DRIVE_BONUS') || set.has('LEADER');
}

/** ReRollSourceComposer.teamReRollSources (c66198ac4 :66-84): Mascot, drive bonus, Leader, else the regular team reroll;
 *  the last three only with TRR. */
export function teamReRollButtons(properties: readonly unknown[] | null | undefined, includeMascot: boolean): TeamReRollButton[] {
  const set = props(properties);
  const out: TeamReRollButton[] = [];
  if (includeMascot && set.has('MASCOT')) out.push('mascot');
  if (set.has('TRR')) {
    const driveBonus = set.has('DRIVE_BONUS');
    const leader = set.has('LEADER');
    if (driveBonus) out.push('driveBonus');
    if (leader) out.push('leader');
    if (!driveBonus && !leader) out.push('team');
  }
  return out;
}

const COMPOSITIONS: readonly (readonly [string, boolean, boolean, 'team' | 'driveBonus' | null])[] = [
  ['Team ReRoll', false, false, 'team'],
  ['Drive Bonus ReRoll', false, false, 'driveBonus'],
  ['Team Mascot', false, true, null],
  ['Mascot TRR', false, true, 'team'],
  ['Mascot Drive Bonus', false, true, 'driveBonus'],
  ['Pro', true, false, null],
  ['Pro TRR', true, false, 'team'],
  ['Pro Drive Bonus', true, false, 'driveBonus'],
  ['Pro Mascot', true, true, null],
  ['Pro Mascot TRR', true, true, 'team'],
  ['Pro Mascot Drive Bonus', true, true, 'driveBonus'],
];

/** ReRollSourceComposer.compose (c66198ac4 :46-53, COMPOSITIONS :17-38); null when the parts form no source. */
export function composeReRollSource(pro: boolean, mascot: boolean, team: TeamReRollPart | null): string | null {
  const normalized = team === 'leader' ? 'team' : team;
  return COMPOSITIONS.find(([, p, m, tr]) => p === pro && m === mascot && tr === normalized)?.[0] ?? null;
}

/** ReRollSourceComposer.decompose: the parts of a composed source, or null for any other source. */
export function decomposeReRollSource(source: unknown): { pro: boolean; mascot: boolean; team: 'team' | 'driveBonus' | null } | null {
  const hit = COMPOSITIONS.find(([name]) => name === source);
  return hit ? { pro: hit[1], mascot: hit[2], team: hit[3] } : null;
}

function choice(pro: boolean, mascot: boolean, team: TeamReRollPart | null): ComposedReRollChoice {
  return { source: composeReRollSource(pro, mascot, team)!, pro, mascot, team };
}

/** Every answer of AbstractReRollDialogHandler.select for a Mascot selection: the mascot alone ("No Re-Roll" in the
 *  fallback dialog) and the mascot with each fallback of teamReRollSources(includeMascot = false). */
export function mascotChoices(properties: readonly unknown[] | null | undefined): ComposedReRollChoice[] {
  if (!props(properties).has('MASCOT')) return [];
  const parts = teamReRollButtons(properties, false) as TeamReRollPart[];
  return [choice(false, true, null), ...parts.map((part) => choice(false, true, part))];
}

/** The direct team buttons (teamReRollSources without the Mascot): Drive Bonus ReRoll, Leader (Team ReRoll), Team ReRoll. */
export function directTeamChoices(properties: readonly unknown[] | null | undefined): ComposedReRollChoice[] {
  return (teamReRollButtons(properties, false) as TeamReRollPart[]).map((part) => choice(false, false, part));
}

/** Every answer of the Pro selection: Pro alone, Pro with each team fallback, and (when the Mascot is a fallback)
 *  Pro + Mascot alone and with each second fallback. Plain Pro is first; callers that show Pro separately drop it. */
export function proChoices(properties: readonly unknown[] | null | undefined): ComposedReRollChoice[] {
  const parts = teamReRollButtons(properties, false) as TeamReRollPart[];
  const out = [choice(true, false, null), ...parts.map((part) => choice(true, false, part))];
  if (props(properties).has('MASCOT')) out.push(choice(true, true, null), ...parts.map((part) => choice(true, true, part)));
  return out;
}

/** The drive bonus label when the team's TurnData is not at hand (DialogExtensionReRolls: "Drive Bonus Re-Roll"). */
export function genericDriveBonusName(): string {
  return t('dialogs.reroll.text.driveBonusReroll');
}

/** DialogExtensionReRolls.driveBonusLabel (PR #367, c66198ac4 :45-58): the drive bonus the server consumes first, read
 *  from the rerolling team's TurnData (upstream reads getTurnDataHome(), which is the coach's own team in the Java client). */
export function driveBonusName(game: GameJson | null | undefined, teamId: string | null | undefined): string {
  const home = !!game && !!teamId && String((game.teamHome as { teamId?: unknown }).teamId ?? '') === teamId;
  const away = !!game && !!teamId && String((game.teamAway as { teamId?: unknown }).teamId ?? '') === teamId;
  const turnData = (home ? game!.turnDataHome : away ? game!.turnDataAway : null) as Record<string, unknown> | null;
  const n = (key: string) => Number(turnData?.[key] ?? 0);
  if (n('rerollBrilliantCoachingOneDrive') > 0) return t('dialogs.reroll.specialTeamLabel.brilliantCoaching');
  if (n('rerollPumpUpTheCrowdOneDrive') > 0) return t('dialogs.reroll.specialTeamLabel.pumpUpTheCrowd');
  if (n('rerollShowStarOneDrive') > 0) return t('dialogs.reroll.specialTeamLabel.starOfTheShow');
  return genericDriveBonusName();
}

/** Owner 11-21: the "i" text beside an answer that spends a drive bonus reroll ("Uses Pump up the Crowd reroll!"),
 *  the bonus named by driveBonusName; "Uses a drive bonus reroll!" when the name is unknown. Undefined for any other
 *  answer (plain team reroll, Leader, Mascot alone, Pro alone). */
export function driveBonusInfo(c: Pick<ComposedReRollChoice, 'team'>, driveBonus: () => string = genericDriveBonusName): string | undefined {
  if (c.team !== 'driveBonus') return undefined;
  const name = driveBonus();
  return name === genericDriveBonusName()
    ? t('dialogs.reroll.text.usesADriveBonusReroll')
    : t('dialogs.reroll.text.usesNamedReroll', { bonus: name });
}

/** The team owning a player (null when unknown). */
export function teamIdOfPlayer(game: GameJson | null | undefined, playerId: string | null | undefined): string | null {
  if (!game || !playerId) return null;
  for (const team of [game.teamHome, game.teamAway]) {
    if (team?.playerArray?.some((player) => player.playerId === playerId)) return String((team as { teamId?: unknown }).teamId ?? '') || null;
  }
  return null;
}

/** The card label of a composed answer. The legacy (TRR-only) labels are unchanged; a Leader part is named
 *  (DialogExtensionReRolls.label: "Leader Re-Roll"). Owner 11-21: a drive bonus part reads as the plain team reroll
 *  ("Team reroll", "Pro, then Team Reroll"); which bonus it spends is told by the "i" beside it (driveBonusInfo).
 *  The source sent is unchanged (Drive Bonus ReRoll and its composed forms). */
export function composedChoiceLabel(c: Pick<ComposedReRollChoice, 'pro' | 'mascot' | 'team'>, _driveBonus?: () => string): string {
  const named = c.team === 'leader' ? t('dialogs.reroll.text.leaderReroll') : null;
  if (c.pro && c.mascot) {
    if (!c.team) return t('dialogs.reroll.text.proThenTeamMascot');
    return named ? t('dialogs.reroll.text.proThenTeamMascotThenReroll', { reroll: named }) : t('dialogs.reroll.text.proThenTeamMascot2');
  }
  if (c.pro) {
    if (!c.team) return t('dialogs.reroll.text.pro');
    return named ? t('dialogs.reroll.text.proThenReroll', { reroll: named }) : t('dialogs.reroll.text.proThenTeamReroll');
  }
  if (c.mascot) {
    if (!c.team) return t('dialogs.reroll.text.teamMascotNoReroll');
    return named ? t('dialogs.reroll.text.mascotThenReroll', { reroll: named }) : t('dialogs.reroll.text.mascotRr');
  }
  return named ?? t('dialogs.reroll.text.teamReroll');
}
