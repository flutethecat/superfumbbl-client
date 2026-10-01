/**
 * S43: what the "unanswered server prompt" panel says. Pure text projection of one server dialog: nothing here
 * answers, infers or computes anything. Every value shown is a value the server sent (names are looked up in the
 * received game; a value that cannot be looked up is shown as sent).
 */

export interface UnknownDialogRow { label: string; value: string; raw: boolean; shortened: boolean }
export type UnknownDialogAsked = 'you' | 'opponent' | 'unstated';
export interface UnknownDialogView {
  title: string;
  /** One sentence: what the server is asking. */
  what: string;
  /** True when the dialog id is not in the client's registry at all. */
  isNew: boolean;
  asked: UnknownDialogAsked;
  askedText: string;
  rows: UnknownDialogRow[];
  /** Values beyond the rows the panel lists (they are all in Copy details). */
  moreCount: number;
}
export interface UnknownDialogLookup {
  myTeamId: string | null;
  teamName(teamId: string): string | null;
  player(playerId: string): { name: string; nr: number | null; teamId: string | null } | null;
}

export const UNKNOWN_DIALOG_TITLE = 'The server is asking something this client cannot answer yet';

/**
 * One plain-English sentence per registry entry marked `unhandled`, paraphrased from the official client's own dialog
 * title and text (ffb-client-logic/src/main/java/com/fumbbl/ffb/client/dialog/, commit b7f355af4). `source` names the file.
 */
export const UNKNOWN_DIALOG_WORDS: Readonly<Record<string, { what: string; source: string }>> = {
  information: { what: 'The server is showing a notice and waiting for it to be closed.', source: 'DialogInformation.java' },
  teamChoice: { what: 'The server wants a team picked from a list.', source: 'DialogTeamChoice.java ("Select Team")' },
  reRollForTargets: { what: 'The server asks whether to use a reroll on the failed rolls against one or more targets.', source: 'DialogReRollForTargets.java ("Use a Re-roll")' },
  reRollBlockForTargets: { what: 'The server asks whether to reroll the block dice against one or more targets.', source: 'DialogReRollBlockForTargets.java ("Block Roll")' },
  useIgors: { what: 'The server asks for which of your players an Igor should reroll a failed Regeneration.', source: 'DialogUseIgorsHandler.java ("Select players to use igor for")' },
  useMortuaryAssistants: { what: 'The server asks for which of your players a Mortuary Assistant (or Plague Doctor) should reroll a failed Regeneration.', source: 'DialogUseMortuaryAssistantsHandler.java' },
  winningsReRoll: { what: 'The server asks whether to keep the winnings roll or roll it again.', source: 'DialogWinningsReRoll.java ("Re-roll Winnings")' },
  pilingOn: { what: 'The server asks whether a player should use Piling On to reroll an armour or injury roll.', source: 'DialogPilingOn.java ("Use Piling On")' },
  useIgor: { what: 'The server asks whether to use your Igor to reroll a failed Regeneration.', source: 'DialogUseIgor.java ("Use Igor")' },
  useMortuaryAssistant: { what: 'The server asks whether to use your Mortuary Assistant (or Plague Doctor) to reroll a failed Regeneration.', source: 'DialogUseMortuaryAssistant.java' },
  opponentBlockSelection: { what: 'The server asks a coach to pick the block dice results for one or more targets.', source: 'DialogOpponentBlockSelectionHandler.java ("Select Block Results")' },
  useChainsaw: { what: 'The server asks whether to use the chainsaw on the foul.', source: 'DialogUseChainsaw.java ("Use Chainsaw")' },
  briberyAndCorruptionReRoll: { what: 'The server asks whether to use Bribery and Corruption to reroll a natural 1 on Argue the Call.', source: 'DialogBriberyAndCorruption.java' },
  penaltyShootout: { what: 'The server is showing the penalty shootout and waiting for it to be closed.', source: 'DialogPenaltyShootout.java ("Penalty Shootout")' },
  opponentBlockSelectionProperties: { what: 'The server asks a coach to pick the block dice results for one or more targets.', source: 'DialogOpponentBlockSelectionPropertiesHandler.java ("Select Block Results")' },
  pickUpChoice: { what: 'The server asks whether to attempt to pick up the ball.', source: 'DialogPickUpChoice.java ("Attempt to pick up the ball?")' },
  selectPosition: { what: 'The server asks for one or more positions to be chosen from a list.', source: 'DialogSelectPosition.java ("Position Choice")' },
};

/** `reRollModifierChoice` -> "Re-roll modifier choice". */
export function readableDialogName(id: string): string {
  const words = id.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim().toLowerCase();
  const text = words.replace(/\bre roll\b/g, 'reroll');
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : id;
}

const LABELS: Readonly<Record<string, string>> = {
  teamId: 'Team', choosingTeamId: 'Team', playerId: 'Player', playerIds: 'Players',
  skill: 'Skill', modifyingSkill: 'Modifying skill', minimumRoll: 'Roll needed',
  roll: 'Roll', rolls: 'Rolls', oldRoll: 'Current roll', rollsHome: 'Home rolls', rollsAway: 'Away rolls',
  reRolledAction: 'Rerolled action', reRollSource: 'Reroll source', nrOfDice: 'Number of dice',
  blockRoll: 'Block roll', blockRolls: 'Block rolls',
};
const RAW_MAX = 140;
const ROWS_MAX = 60;
export const SHORTENED_NOTE = 'shortened - full value in Copy details';

function readableKey(key: string): string {
  const text = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim().toLowerCase();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : key;
}

function compactJson(value: unknown): string {
  try { return JSON.stringify(value) ?? String(value); } catch { return String(value); }
}
/** Cut one line at RAW_MAX; `shortened` says it was cut. */
function cut(text: string): { text: string; shortened: boolean } {
  return text.length > RAW_MAX ? { text: `${text.slice(0, RAW_MAX - 1)}…`, shortened: true } : { text, shortened: false };
}
function done(label: string, text: string, raw: boolean): UnknownDialogRow {
  const c = cut(text);
  return { label, value: c.text, raw, shortened: c.shortened };
}

const isScalar = (v: unknown): v is string | number | boolean => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
const isRollScalar = (v: unknown): v is number | string => typeof v === 'number' || (typeof v === 'string' && v !== '');
const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function playerText(lookup: UnknownDialogLookup, id: unknown): string | null {
  if (typeof id !== 'string' || !id) return null;
  const p = lookup.player(id);
  if (!p) return null;
  return p.nr != null ? `${p.name} (#${p.nr})` : p.name;
}

/** One element of an array of objects: `key: value` pairs, values as sent. */
function pairsLine(el: Record<string, unknown>): string {
  return Object.entries(el).map(([k, v]) => `${k}: ${Array.isArray(v) && v.every(isScalar) ? v.join(', ') : isScalar(v) ? String(v) : compactJson(v)}`).join(', ');
}
/** An array of objects: one element per line (each line cut on its own). */
function objectLines(label: string, value: unknown[], raw: boolean): UnknownDialogRow {
  const lines = value.map((el) => cut(pairsLine(el as Record<string, unknown>)));
  return { label, value: lines.map((l) => l.text).join('\n'), raw, shortened: lines.some((l) => l.shortened) };
}
const isObjectArray = (v: unknown): v is unknown[] => Array.isArray(v) && v.length > 0 && v.every(isPlainObject);

function rowFor(key: string, value: unknown, lookup: UnknownDialogLookup): UnknownDialogRow {
  const rawRow = (): UnknownDialogRow => {
    if (isObjectArray(value)) return objectLines(key, value, true);
    if (typeof value === 'boolean') return done(key, String(value), true);
    return done(key, compactJson(value), true);
  };
  const label = LABELS[key];
  switch (key) {
    case 'teamId':
    case 'choosingTeamId':
      return typeof value === 'string' ? done(label!, lookup.teamName(value) ?? value, false) : rawRow();
    case 'playerId': {
      if (typeof value !== 'string' || !value) return rawRow();
      const p = playerText(lookup, value);
      if (p) return done(label!, p, false);
      // Some dialogs (opponentBlockSelection ...) write the TEAM id into playerId: show it as the team.
      const team = lookup.teamName(value);
      return team != null ? done('Team', team, false) : done(label!, value, false);
    }
    case 'playerIds':
      return Array.isArray(value) ? done(label!, value.map((id) => playerText(lookup, id) ?? String(id)).join(', ') || 'none', false) : rawRow();
    case 'minimumRoll':
      return typeof value === 'number' ? done(label!, `${value}+`, false) : rawRow();
    default:
  }
  if (!label) return rawRow();
  if (isScalar(value)) return done(label, typeof value === 'boolean' ? (value ? 'yes' : 'no') : String(value), false);
  if (value == null) return done(label, 'none', false);
  if (Array.isArray(value) && value.every(isRollScalar)) return done(label, value.join(', ') || 'none', false);
  if (isObjectArray(value)) return objectLines(label, value, false);
  return done(label, compactJson(value), true);
}

/** Who the server addressed: the dialog's own teamId, else choosingTeamId, else the team of its playerId. */
export function unknownDialogAsked(payload: Record<string, unknown>, lookup: UnknownDialogLookup): UnknownDialogAsked {
  let teamId: string | null = null;
  if (typeof payload.teamId === 'string' && payload.teamId) teamId = payload.teamId;
  else if (typeof payload.choosingTeamId === 'string' && payload.choosingTeamId) teamId = payload.choosingTeamId;
  else if (typeof payload.playerId === 'string' && payload.playerId) {
    // The server sometimes writes the TEAM id into playerId (opponentBlockSelection): a team id is the team.
    teamId = lookup.player(payload.playerId)?.teamId ?? (lookup.teamName(payload.playerId) != null ? payload.playerId : null);
  }
  if (!teamId || !lookup.myTeamId) return 'unstated';
  return teamId === lookup.myTeamId ? 'you' : 'opponent';
}

export function describeUnknownDialog(
  id: string,
  payload: Record<string, unknown>,
  registered: boolean,
  lookup: UnknownDialogLookup,
): UnknownDialogView {
  const words = registered ? UNKNOWN_DIALOG_WORDS[id]?.what : undefined;
  const name = readableDialogName(id);
  const what = words ?? (registered
    ? `${name}: the server sent this prompt and this client has no way to show it yet.`
    : `${name}: this prompt is new to this client.`);
  const asked = unknownDialogAsked(payload, lookup);
  const askedText = asked === 'you' ? 'The server is asking you.' : asked === 'opponent' ? 'The server is asking your opponent.' : 'The server does not say who it is asking.';
  const keys = Object.keys(payload).filter((k) => k !== 'dialogId');
  const rows = keys.slice(0, ROWS_MAX).map((k) => rowFor(k, payload[k], lookup));
  return { title: UNKNOWN_DIALOG_TITLE, what, isNew: !registered, asked, askedText, rows, moreCount: Math.max(0, keys.length - ROWS_MAX) };
}

/**
 * S43: what the game's global key handler does while the panel is up. Enter, Space and Escape never reach a game
 * command (no planner confirm, no chat focus, no Esc cascade); Escape may close the open confirmation and nothing more.
 * Enter/Space on a focused button are cancelled so a keyboard can never press "Send End Turn" / "Send End Activation".
 */
export function unknownPanelKeyDecision(i: { panelUp: boolean; confirming: boolean; key: string; code: string; confirmKey: string; targetIsButton: boolean }):
  { handled: boolean; preventDefault: boolean; closeConfirmation: boolean } {
  const none = { handled: false, preventDefault: false, closeConfirmation: false };
  if (!i.panelUp) return none;
  if (i.key === 'Escape') return { handled: true, preventDefault: false, closeConfirmation: i.confirming };
  const gameKey = i.key === 'Enter' || i.code === 'Space' || i.code === 'Enter' || i.code === i.confirmKey;
  return gameKey ? { handled: true, preventDefault: i.targetIsButton, closeConfirmation: false } : none;
}
