import { data } from '../i18n';

/**
 * Owner 10-26 ("server side FUMBBL explanation lines ... consume those if they're available"): FFB 3.4.0 attaches
 * explanatory text to several prompts. This module is the ONE projection of that text for the modern cards.
 *
 * Wire fields (upstream ffb-common):
 *  - `skillUse.messageArray`            DialogSkillUseParameter.getMessages  ("You are only asked because ...")
 *  - `reRollModifierChoice.messageArray` DialogReRollModifierChoiceParameter.getMessages ("Diving Tackle can ...")
 *  - `reRoll.messageArray`              older re-roll dialogs (same field name)
 *  - `playerChoice.descriptions`        DialogPlayerChoiceParameter.getDescriptions; per player, the Java client's
 *                                       PlayerCheckList appends descriptions[min(i, length - 1)] to player i
 *
 * Laws: server-derived (only what the server SENT, verbatim, server order), never answers anything, holds no text of
 * its own, and every returned line is wrapped in the i18n `data()` marker: it is English wire data, never translated.
 * A 3.3.1 server that sends none of these fields yields empty results, so callers keep their own copy unchanged.
 */

type DialogLike = Readonly<Record<string, unknown>> | null | undefined;

/** Trim every string entry, drop non-strings and blanks, de-duplicate keeping the first occurrence (server order). */
export function serverExplanationLines(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    const line = entry.trim();
    if (!line || seen.has(line)) continue;
    seen.add(line);
    lines.push(data(line));
  }
  return lines;
}

/** The free-text lines a dialog carries: `messageArray` for skillUse / reRoll / reRollModifierChoice. */
export function dialogExplanationLines(dialog: DialogLike): string[] {
  if (!dialog) return [];
  return serverExplanationLines(dialog.messageArray);
}

const skillKey = (value: unknown): string => {
  const raw = value && typeof value === 'object' && 'name' in value ? (value as { name: unknown }).name : value;
  return String(raw ?? '').toLowerCase().replace(/[^a-z]/g, '');
};

/**
 * The skill-use card's server lines: only while the LIVE dialog is the skillUse prompt for exactly the card's
 * player and skill. A stale or different dialog contributes nothing (the card falls back to its own copy).
 */
export function skillUseExplanationLines(
  dialog: DialogLike,
  card: { playerId: string; skill: string } | null | undefined,
): string[] {
  if (!dialog || !card || dialog.dialogId !== 'skillUse') return [];
  if (String(dialog.playerId ?? '') !== card.playerId || skillKey(dialog.skill) !== skillKey(card.skill)) return [];
  return dialogExplanationLines(dialog);
}

export interface PlayerChoiceExplanation {
  /** A line that explains the choice as a whole, not one player: only for modes whose server builds ONE description
   *  for every offered player (Diving Tackle: "This will trip the dodger."). */
  shared: string[];
  /** Each offered player's own non-blank line, in offer order (the Catch pick's forced catcher, Tentacles' ST
   *  comparison). Always filled when lines exist, so a card can put a line beside the player it names. */
  perPlayer: { playerId: string; line: string }[];
}

/** Modes whose server builds a single description about the choice itself, never about one player
 *  (bb2025 DivingTackleBehaviour.description / StepJump.divingTackleDescription). Every other mode is per player. */
const SHARED_DESCRIPTION_MODES = new Set(['divingTackle']);

const noPlayerChoiceLines = (): PlayerChoiceExplanation => ({ shared: [], perPlayer: [] });

const offeredIds = (dialog: Readonly<Record<string, unknown>>): string[] => (Array.isArray(dialog.playerIds)
  ? (dialog.playerIds as unknown[]).filter((id): id is string => typeof id === 'string' && id !== '')
  : []);

/**
 * playerChoice `descriptions`, aligned to `playerIds` the way the Java client's PlayerCheckList aligns them (index
 * clamped to the last description). Blank lines (the Catch pick's " " fillers) give that player no line.
 */
export function playerChoiceExplanation(
  dialog: DialogLike,
  mode?: string,
): PlayerChoiceExplanation {
  if (!dialog || dialog.dialogId !== 'playerChoice') return noPlayerChoiceLines();
  const dialogMode = String(dialog.playerChoiceMode ?? '');
  if (mode !== undefined && dialogMode !== mode) return noPlayerChoiceLines();
  const descriptions = Array.isArray(dialog.descriptions)
    ? (dialog.descriptions as unknown[]).map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    : [];
  const playerIds = offeredIds(dialog);
  if (!descriptions.length || !playerIds.length) return noPlayerChoiceLines();
  const aligned = playerIds.map((playerId, i) => ({ playerId, line: descriptions[Math.min(i, descriptions.length - 1)]! }));
  const first = aligned[0]!.line;
  const perPlayer = aligned.filter((entry) => entry.line !== '').map((entry) => ({ playerId: entry.playerId, line: data(entry.line) }));
  const shared = SHARED_DESCRIPTION_MODES.has(dialogMode) && first && aligned.every((entry) => entry.line === first)
    ? [data(first)] : [];
  return { shared, perPlayer };
}

/**
 * The armed player pick's explanation: only while the live dialog is the very playerChoice the pick answers - its
 * occurrence is live (`occurrenceLive`, the store's cardDialogLive for the pick's answersInstance), its mode is the
 * pick's mode and it offers exactly the pick's players. A replaced, stale or other-coach dialog contributes nothing.
 */
export function playerPickExplanation(
  dialog: DialogLike,
  pick: { key: string; eligibleIds: readonly string[] } | null | undefined,
  occurrenceLive: boolean,
): PlayerChoiceExplanation {
  if (!dialog || !pick || !occurrenceLive || !pick.key.startsWith('pchoice:')) return noPlayerChoiceLines();
  const mode = pick.key.split(':')[1] ?? '';
  if (!mode || dialog.dialogId !== 'playerChoice' || String(dialog.playerChoiceMode ?? '') !== mode) return noPlayerChoiceLines();
  const offered = offeredIds(dialog);
  const eligible = new Set(pick.eligibleIds);
  if (offered.length !== eligible.size || !offered.every((id) => eligible.has(id))) return noPlayerChoiceLines();
  return playerChoiceExplanation(dialog, mode);
}

/** The per-player line for one player, or null. */
export function playerChoiceLineFor(explanation: PlayerChoiceExplanation, playerId: string | null | undefined): string | null {
  if (!playerId) return null;
  return explanation.perPlayer.find((entry) => entry.playerId === playerId)?.line ?? null;
}

/** Per-player lines with the server's player name, for cards that list the offered players. */
export function playerChoiceRows(
  explanation: PlayerChoiceExplanation,
  game: { teamHome?: { playerArray?: readonly { playerId?: unknown; playerName?: unknown }[] }; teamAway?: { playerArray?: readonly { playerId?: unknown; playerName?: unknown }[] } } | null | undefined,
): { playerId: string; name: string; line: string }[] {
  const players = [...(game?.teamHome?.playerArray ?? []), ...(game?.teamAway?.playerArray ?? [])];
  return explanation.perPlayer.map((entry) => {
    const name = players.find((player) => player.playerId === entry.playerId)?.playerName;
    return { ...entry, name: typeof name === 'string' ? name : '' };
  });
}
