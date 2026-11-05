/**
 * Copy for "this Blitz uses your team's Blitz". Presentation only: every fact comes from the server's own state
 * (`turnDataHome/Away.blitzUsed`, the acting player's skills). Nothing is predicted or sent.
 *
 * Upstream (bb2025): the Blitz target is chosen in StepSelectBlitzTarget; the activation steps that follow
 * (ActivationSequenceBuilder.addTo) roll Animal Savagery, Bone Head, Really Stupid, Take Root, Unchannelled Fury and
 * Blood Lust on that selection, and StepSelectBlitzTargetEnd marks the Blitz used whatever those rolls did.
 * That is why the server sets `blitzUsed` the moment the target is selected.
 */
import type { GameJson } from '@fumbbl40k/ffb-protocol';
import { hasSkill, playerSideIsHome } from './availableActions';

/** Skills the server rolls at Blitz target selection, in ActivationSequenceBuilder order (display names). */
export const BLITZ_TARGET_ROLL_TRAITS = [
  'Animal Savagery', 'Bone Head', 'Really Stupid', 'Take Root', 'Unchannelled Fury', 'Blood Lust',
] as const;

/** Display name for the copy ("Bloodlust" is how the rest of the client spells it). */
const TRAIT_DISPLAY: Record<(typeof BLITZ_TARGET_ROLL_TRAITS)[number], string> = {
  'Animal Savagery': 'Animal Savagery',
  'Bone Head': 'Bone Head',
  'Really Stupid': 'Really Stupid',
  'Take Root': 'Take Root',
  'Unchannelled Fury': 'Unchannelled Fury',
  'Blood Lust': 'Bloodlust',
};

/** Any Blitz-family player action (blitzMove, blitz, blitzSelect, kickEmBlitz, putridRegurgitationBlitz...). */
export function isBlitzPlayerAction(playerAction: unknown): boolean {
  return /blitz/i.test(String(playerAction ?? ''));
}

const FLAG_ROOTED = 0x400; // ffb-common PlayerState _BIT_ROOTED

/** bb2025 TakeRootBehaviour rolls only when the activation STARTED standing and the player is not already rooted. A
 *  prone Treeman (or a rooted one) is not rolled, so the copy must not promise it. Read from the server's player state. */
function takeRootRollsNow(game: GameJson, playerId: string): boolean {
  const data = (game.fieldModel?.playerDataArray ?? []).find((d) => d.playerId === playerId);
  const ps = Number(data?.playerState ?? 0);
  if ((ps & FLAG_ROOTED) !== 0) return false;
  // Declaring a Blitz moves a prone player's CURRENT state to MOVING; the server keeps the state the activation began in
  // (`actingPlayer.playerStateOld`) and checks THAT. Use it when the wire carries it; else fall back to the field state.
  const acting = game.actingPlayer as { playerId?: string | null; playerStateOld?: unknown } | null | undefined;
  const old = acting?.playerId === playerId ? acting.playerStateOld : undefined;
  if (typeof old === 'number') return (old & 0xff) === 1;
  const base = ps & 0xff;
  return base === 1 || base === 2;
}

/** The target-roll traits the player has AND the server will roll now, as display names. */
export function blitzTargetRollTraits(game: GameJson | null | undefined, playerId: string): string[] {
  if (!game || !playerId) return [];
  return BLITZ_TARGET_ROLL_TRAITS
    .filter((skill) => hasSkill(game, playerId, skill) && (skill !== 'Take Root' || takeRootRollsNow(game, playerId)))
    .map((skill) => TRAIT_DISPLAY[skill]);
}

/** The acting team's `blitzUsed`: true/false from server turn data, null when the side cannot be read. */
export function actingTeamBlitzUsed(game: GameJson | null | undefined, playerId: string): boolean | null {
  if (!game || !playerId) return null;
  const home = playerSideIsHome(game, playerId);
  if (home === null) return null;
  const td = (home ? game.turnDataHome : game.turnDataAway) as { blitzUsed?: unknown } | null | undefined;
  if (!td) return null;
  return td.blitzUsed === true;
}

/**
 * Text of the end-action confirmation card. Blitz actions name the player and say whether the team's Blitz is used.
 * Other actions (and an unreadable blitzUsed) keep `fallback`, the card's wording from before.
 */
export function endActionConfirmText(
  playerAction: unknown, playerName: string, blitzUsed: boolean | null, fallback: string,
): string {
  if (!isBlitzPlayerAction(playerAction) || blitzUsed === null) return fallback;
  const who = playerName ? `End ${playerName}'s Blitz?` : 'End the current blitz?';
  return blitzUsed
    ? `${who} Your team's Blitz for this turn is already used.`
    : `${who} Your Blitz is not used yet.`;
}

/** Cost line shown where the coach chooses / confirms a Blitz target. */
export function blitzTargetCostText(traits: readonly string[]): string {
  const base = "Choosing this target uses your team's Blitz for this turn.";
  if (traits.length === 0) return base;
  const joined = traits.length === 1 ? traits[0]! : `${traits.slice(0, -1).join(', ')} and ${traits[traits.length - 1]}`;
  return `${base} ${joined} ${traits.length === 1 ? 'is' : 'are'} rolled now; the Blitz is used even if ${traits.length === 1 ? 'the roll' : 'a roll'} fails.`;
}

/** Owner 11-04: the one-line cost note of the "Choose a Blitz target" prompt (the full note stays on the Confirm Blitz bar). */
export function blitzTargetCostShortText(traits: readonly string[]): string {
  if (traits.length === 0) return "Uses your team's Blitz.";
  const joined = traits.length === 1 ? traits[0]! : `${traits.slice(0, -1).join(', ')} or ${traits[traits.length - 1]}`;
  return `Uses your team's Blitz, even if ${joined} fails.`;
}
