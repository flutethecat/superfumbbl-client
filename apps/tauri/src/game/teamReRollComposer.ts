import type { GameJson } from '@fumbbl40k/ffb-protocol';
import { t, terms } from '../i18n';

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

/** ReRollSourceComposer.teamReRollSources (upstream Live :66-85): Mascot, then the team pool, only with TRR, in
 *  upstream's order (:74-82): the drive bonus, then Leader; the regular team reroll only when neither is offered.
 *  Owner 11-27 ("An extra icon isn't too bad, we can do two"): when the drive bonus AND Leader both apply, both are
 *  offered side by side, as upstream does (:74-79); each replaces the plain Team reroll. Every option list (first panel
 *  and every follow-up level, every card kind) is derived from this. */
export function teamReRollButtons(properties: readonly unknown[] | null | undefined, includeMascot: boolean): TeamReRollButton[] {
  const set = props(properties);
  const out: TeamReRollButton[] = [];
  if (includeMascot && set.has('MASCOT')) out.push('mascot');
  if (!set.has('TRR')) return out;
  if (set.has('DRIVE_BONUS')) out.push('driveBonus');
  if (set.has('LEADER')) out.push('leader');
  if (!set.has('DRIVE_BONUS') && !set.has('LEADER')) out.push('team');
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
 *  fallback dialog) and the mascot with each fallback of teamReRollSources(includeMascot = false). Callers tag them
 *  with mascotTag so the views can show one Mascot button and the follow-up (mascotFirstQuestion / mascotFollowUp). */
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

// ---------------------------------------------------------------------------------------------------------------------
// Owner 11-24 ("I like upstream's version better. I suggest we use theirs."): ONE Team Mascot button, then a
// client-local follow-up asking which reroll to use if the Mascot fails. Upstream Live (= master), ffb-client-logic:
//  - AbstractReRollDialogHandler.selectTeamReRoll / select (:33-53): a Mascot selection asks for the fallbacks
//    teamReRollSources(properties, includeMascot = pro && !mascot = false) (ReRollSourceComposer :66-85: drive bonus,
//    Leader, else Team Re-Roll; only with TRR). SKIP RULE (:44, :52): when that list is empty the Mascot answer is
//    sent at once ("Team Mascot"), no follow-up.
//  - DialogReRollFallback (:35-101): title "Use a Re-roll", question "Do you want to use another re-roll if Team
//    Mascot fails?" (:40-45), one button per fallback in that order (:79-86), then "No Re-Roll" (:87-92). No button
//    is pre-selected and the dialog is not closable (Dialog(client, title, false) :36): there is no way back.
//  - AbstractReRollDialogHandler.dialogClosed (:59-77) -> send (:55-57): compose(pro = false, mascot = true, fallback)
//    (ReRollSourceComposer.compose :46-53; Leader -> Team ReRoll): Mascot TRR / Mascot Drive Bonus / Team Mascot.
// Our cards keep every composed answer in their option lists (the wire and the store's sender gates are unchanged);
// the views show the one Mascot button and this follow-up. Divergence by owner rule: the follow-up has a Back control
// (nothing is sent; the first question returns). It adds no answer, so the reachable set is upstream's.
// Pro is NOT changed here (its composite buttons stay; see the Pro report).
// ---------------------------------------------------------------------------------------------------------------------

/** The fallback part of a Mascot answer: `none` = the Mascot alone ("No reroll" in the follow-up). */
export type MascotFallback = TeamReRollPart | 'none';

/** An option of a card that may be one of the Mascot answers. Only the Mascot answers carry `mascotFallback`. */
export interface MascotTaggedOption {
  source: string;
  mascotFallback?: MascotFallback;
}

/** The `mascotFallback` tag of a mascotChoices answer, as a spreadable object. */
export function mascotTag(c: Pick<ComposedReRollChoice, 'mascot' | 'pro' | 'team'>): { mascotFallback: MascotFallback } | Record<string, never> {
  return c.mascot && !c.pro ? { mascotFallback: c.team ?? 'none' } : {};
}

/** The first question: every option except the Mascot's fallback answers (the Mascot alone stays, as the one button). */
export function mascotFirstQuestion<T extends MascotTaggedOption>(options: readonly T[]): T[] {
  return options.filter((o) => !o.mascotFallback || o.mascotFallback === 'none');
}

/** The follow-up's answers, in upstream's order (drive bonus, Leader, Team reroll), then "No reroll" (the Mascot
 *  alone), or null under upstream's skip rule (no fallback offered: the one Mascot button sends "Team Mascot" itself)
 *  and when the card offers no Mascot at all. */
export function mascotFollowUp<T extends MascotTaggedOption>(options: readonly T[]): T[] | null {
  const alone = options.find((o) => o.mascotFallback === 'none');
  const fallbacks = options.filter((o) => !!o.mascotFallback && o.mascotFallback !== 'none');
  if (!alone || fallbacks.length === 0) return null;
  const order: MascotFallback[] = ['driveBonus', 'leader', 'team'];
  return [...fallbacks.sort((a, b) => order.indexOf(a.mascotFallback!) - order.indexOf(b.mascotFallback!)), alone];
}

/** The follow-up label of an answer (DialogExtensionReRolls.label: "Team Re-Roll" / "Leader Re-Roll" / the drive
 *  bonus; "No Re-Roll"). Owner 11-21: a drive bonus reads as the Team reroll; its corner badge names the bonus. */
export function mascotFollowUpLabel(part: MascotFallback | undefined): string {
  if (part === 'leader') return t('dialogs.reroll.text.leaderReroll');
  if (part === 'team' || part === 'driveBonus') return t('dialogs.reroll.text.teamReroll');
  return t('hud.rerollBar.noReroll');
}

// ---------------------------------------------------------------------------------------------------------------------
// Owner 11-25: upstream's follow-up for Pro. AbstractReRollDialogHandler.selectTeamReRoll / select (:33-53): a Pro
// selection asks for the fallbacks teamReRollSources(properties, includeMascot = pro && !mascot = true) (Team Mascot,
// drive bonus, Leader, else Team Re-Roll; the last three only with TRR) in DialogReRollFallback ("...if the Pro roll
// fails?", :40-41), then "No Re-Roll". Picking the Team Mascot there asks the Mascot's own fallbacks (dialogClosed
// :69-70 -> select with mascot = true, includeMascot = false). Each level is skipped when its list is empty (:44, :52):
// Pro alone / Pro Mascot is sent at once. The answer is compose(pro = true, mascot, fallback) (:55-57).
// ---------------------------------------------------------------------------------------------------------------------

/** The fallback part of a Pro answer: the Team Mascot (then `proMascotPart`), a team reroll part, or `none` (Pro alone). */
export type ProPart = 'mascot' | TeamReRollPart | 'none';
export interface ProTaggedOption {
  source: string;
  proPart?: ProPart;
  /** With proPart 'mascot': the Mascot's own fallback (`none` = Pro Mascot). */
  proMascotPart?: MascotFallback;
}

/** The Pro tag of a source (Pro, Pro TRR, Pro Drive Bonus, Pro Mascot...), or {} for any other source. A TRR part is the
 *  Leader when the dialog offers LEADER (the current server offers the plain team reroll only without Leader or drive
 *  bonus, ReRollSourceComposer.teamReRollSources :71-83; Leader is sent as TRR, compose :47-48). */
export function proTag(source: string, properties: readonly unknown[] | null | undefined): { proPart: ProPart; proMascotPart?: MascotFallback } | Record<string, never> {
  const parts = decomposeReRollSource(source);
  if (!parts?.pro) return {};
  const team: TeamReRollPart | null = parts.team === 'team' && props(properties).has('LEADER') ? 'leader' : parts.team;
  return parts.mascot ? { proPart: 'mascot', proMascotPart: team ?? 'none' } : { proPart: team ?? 'none' };
}

/** The first question: every option except the Pro fallback answers (Pro alone stays, as the one Pro button). */
export function proFirstQuestion<T extends ProTaggedOption>(options: readonly T[]): T[] {
  return options.filter((o) => !o.proPart || o.proPart === 'none');
}

const PRO_ORDER: ProPart[] = ['mascot', 'driveBonus', 'leader', 'team'];
const MASCOT_ORDER: MascotFallback[] = ['driveBonus', 'leader', 'team'];

/** The Pro follow-up (level 1) in upstream's order (Team Mascot, drive bonus, Leader, Team reroll), then "No reroll" (Pro
 *  alone); the Team Mascot entry is the Pro Mascot answer (its own fallbacks, if any, are level 2). Null under the skip
 *  rule (no fallback: Pro alone is sent at once) and when the card offers no Pro. */
export function proFollowUp<T extends ProTaggedOption>(options: readonly T[]): T[] | null {
  const alone = options.find((o) => o.proPart === 'none');
  const mascot = options.find((o) => o.proPart === 'mascot' && o.proMascotPart === 'none');
  const team = options.filter((o) => !!o.proPart && o.proPart !== 'none' && o.proPart !== 'mascot');
  const level = [...(mascot ? [mascot] : []), ...team].sort((a, b) => PRO_ORDER.indexOf(a.proPart!) - PRO_ORDER.indexOf(b.proPart!));
  if (!alone || level.length === 0) return null;
  return [...level, alone];
}

/** The Pro Mascot follow-up (level 2): the Mascot's fallbacks in upstream's order, then "No reroll" (Pro Mascot); null
 *  when there is none (skip rule: Pro Mascot is sent at once). */
export function proMascotFollowUp<T extends ProTaggedOption>(options: readonly T[]): T[] | null {
  const alone = options.find((o) => o.proPart === 'mascot' && o.proMascotPart === 'none');
  const fallbacks = options.filter((o) => o.proPart === 'mascot' && !!o.proMascotPart && o.proMascotPart !== 'none')
    .sort((a, b) => MASCOT_ORDER.indexOf(a.proMascotPart!) - MASCOT_ORDER.indexOf(b.proMascotPart!));
  if (!alone || fallbacks.length === 0) return null;
  return [...fallbacks, alone];
}

/** Sol 11-25 #2: a stored spectator checkpoint written before the follow-ups (1.0.336 and older) carries the composed
 *  answers ('Pro TRR', 'Pro Mascot', 'Mascot TRR'...) untagged, so the first-panel filters would keep them as their own
 *  buttons. Tag every untagged Pro / Mascot answer by its wire source (decomposeReRollSource; a TRR part is the Leader
 *  when the card offers Leader, as proTag), so the card shows one control per source. The plain Team reroll is dropped
 *  when a drive bonus is offered (upstream offers it only when neither a drive bonus nor Leader is); owner 11-27: a drive
 *  bonus and a Leader reroll offered together are both kept. Options that already carry tags, and every other option,
 *  are kept as they are.
 *  Sol r2: a 1.0.335 card hid the direct Team reroll beside the Mascot ([MASCOT, TRR] = Team Mascot + Mascot TRR only),
 *  so when a composite names a pool and the card has no direct control for that pool, that control is rebuilt (display
 *  only: the checkpoint is read-only) after the last Pro / Mascot answer, one per missing pool in upstream's order (drive
 *  bonus, Leader, Team reroll). A null list or a non-object element never throws: the elements that can be read are
 *  returned. */
export function normalizeReRollOptionsBySource<T extends MascotTaggedOption & ProTaggedOption & { label?: string; teamKind?: string; badgeSkill?: string }>(
  input: readonly (T | null | undefined)[] | null | undefined,
): T[] {
  const options = (Array.isArray(input) ? input : []).filter((o): o is T => !!o && typeof o === 'object' && typeof o.source === 'string');
  const leader = options.some((o) => o.teamKind === 'leader' || o.badgeSkill === 'Leader'
    || o.mascotFallback === 'leader' || o.proPart === 'leader' || o.proMascotPart === 'leader');
  const tagged = options.map((o): T => {
    if (o.mascotFallback !== undefined || o.proPart !== undefined) return o;
    const parts = decomposeReRollSource(o.source);
    if (!parts || (!parts.pro && !parts.mascot)) return o;
    const team: TeamReRollPart | null = parts.team === 'team' && leader ? 'leader' : parts.team;
    if (parts.pro) return parts.mascot ? { ...o, proPart: 'mascot', proMascotPart: team ?? 'none' } : { ...o, proPart: team ?? 'none' };
    return { ...o, mascotFallback: team ?? 'none' };
  });
  const pool = (o: T): MascotFallback | 'mascot' | null => {
    if (o.proPart !== undefined) return o.proPart === 'mascot' ? (o.proMascotPart ?? 'none') : o.proPart;
    if (o.mascotFallback !== undefined) return o.mascotFallback;
    const parts = decomposeReRollSource(o.source);
    if (!parts || parts.pro || parts.mascot) return null;
    // a direct Team ReRoll is the Leader control when the card offers Leader (Leader is sent as Team ReRoll)
    return parts.team === 'team' && (leader || o.teamKind === 'leader') ? 'leader' : parts.team;
  };
  const kept = tagged.some((o) => pool(o) === 'driveBonus') ? tagged.filter((o) => pool(o) !== 'team') : tagged;
  const isComposite = (o: T) => o.proPart !== undefined || o.mascotFallback !== undefined;
  const isDirect = (o: T) => !isComposite(o) && (() => { const p = decomposeReRollSource(o.source); return !!p && !p.pro && !p.mascot; })();
  const rebuilt: T[] = [];
  for (const part of ['driveBonus', 'leader', 'team'] as const) {
    const donor = kept.find((o) => isComposite(o) && pool(o) === part);
    if (!donor || kept.some((o) => isDirect(o) && pool(o) === part)) continue;
    const { mascotFallback: _m, proPart: _p, proMascotPart: _pm, info: _i, badgeTag: _bt, badgeSkill: _bs, badgeName: _bn, ...rest } =
      donor as T & { info?: unknown; badgeTag?: unknown; badgeName?: unknown };
    const donorBadge = part === 'driveBonus' && typeof (donor as { info?: unknown }).info === 'string'
      ? { info: (donor as { info?: string }).info, badgeTag: (donor as { badgeTag?: string }).badgeTag, badgeName: (donor as { badgeName?: string }).badgeName }
      : teamPartBadge({ team: part, mascot: false });
    rebuilt.push({
      ...rest, source: composeReRollSource(false, false, part)!, label: composedChoiceLabel({ pro: false, mascot: false, team: part }),
      ...(part !== 'team' ? { teamKind: part } : {}), ...donorBadge,
    } as unknown as T);
  }
  if (rebuilt.length === 0) return kept;
  let at = -1;
  kept.forEach((o, i) => { if (isComposite(o)) at = i; });
  const out = [...kept.slice(0, at + 1), ...rebuilt, ...kept.slice(at + 1)];
  // Sol 11-27: a rebuilt control must not jump ahead of a stored one of an earlier pool (a stored drive bonus with a
  // rebuilt Leader read Leader, drive bonus). The direct pool controls keep their slots and are put in pool order.
  const order = ['driveBonus', 'leader', 'team'];
  const slots = out.map((o, i) => (isDirect(o) && order.includes(String(pool(o))) ? i : -1)).filter((i) => i >= 0);
  const sorted = slots.map((i) => out[i] as T).sort((a, b) => order.indexOf(String(pool(a))) - order.indexOf(String(pool(b))));
  slots.forEach((slot, i) => { out[slot] = sorted[i] as T; });
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

/** Owner 11-21: the 3-character corner tag of a drive bonus ("BCR" / "PCR" / "SSR", "DBR" when it cannot be named),
 *  from the same name driveBonusName gives (the bonus the server consumes first). */
export function driveBonusTag(name: string): string {
  if (name === t('dialogs.reroll.specialTeamLabel.brilliantCoaching')) return t('dialogs.reroll.tag.brilliantCoaching');
  if (name === t('dialogs.reroll.specialTeamLabel.pumpUpTheCrowd')) return t('dialogs.reroll.tag.pumpUpTheCrowd');
  if (name === t('dialogs.reroll.specialTeamLabel.starOfTheShow')) return t('dialogs.reroll.tag.starOfTheShow');
  return t('dialogs.reroll.tag.driveBonus');
}

/** Owner 11-21: the corner badge of an answer presented as the Team reroll. A drive bonus part (direct, Pro then, Mascot
 *  then) carries its tag and "Uses <bonus> reroll!"; a Leader part (direct, Pro then, Mascot then; owner 11-25: the pool
 *  answer looks the same in every follow-up) carries the Leader skill icon and "Uses the Leader reroll!". Empty for every other answer. */
export function teamPartBadge(c: Pick<ComposedReRollChoice, 'team' | 'mascot'>, driveBonus: () => string = genericDriveBonusName):
  { info: string; badgeTag: string; badgeName: string } | { info: string; badgeSkill: 'Leader'; badgeName: string } | Record<string, never> {
  if (c.team === 'driveBonus') {
    const name = driveBonus();
    return { info: driveBonusInfo(c, driveBonus)!, badgeTag: driveBonusTag(name), badgeName: name };
  }
  if (c.team === 'leader') return { info: t('dialogs.reroll.text.usesLeaderReroll'), badgeSkill: 'Leader', badgeName: terms('Leader') };
  return {};
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
