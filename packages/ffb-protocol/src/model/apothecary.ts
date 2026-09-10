import { NetCommandId } from '../commands/netCommandId';

export type ApothecaryDecline =
  | {
      netCommandId: typeof NetCommandId.CLIENT_USE_APOTHECARY;
      playerId: string;
      apothecaryUsed: false;
    }
  | {
      netCommandId: typeof NetCommandId.CLIENT_USE_APOTHECARIES;
      injuryDescriptions: [];
    };

/**
 * Build the upstream decline response for either Apothecary offer.
 *
 * A single decline deliberately carries no offered type, serious injury, or
 * player state. A multi-injury decline is the distinct empty-list command.
 */
export function buildApothecaryDecline(
  dialog: Readonly<Record<string, unknown>>,
  loud: (message: string) => void = console.error,
): ApothecaryDecline | null {
  if (dialog.dialogId === 'useApothecary') {
    const playerId = typeof dialog.playerId === 'string' ? dialog.playerId : '';
    if (!playerId) {
      loud('apothecary election: useApothecary.playerId is missing');
      return null;
    }
    return { netCommandId: NetCommandId.CLIENT_USE_APOTHECARY, playerId, apothecaryUsed: false };
  }

  if (dialog.dialogId === 'useApothecaries') {
    return { netCommandId: NetCommandId.CLIENT_USE_APOTHECARIES, injuryDescriptions: [] };
  }

  loud(`apothecary election: unsupported dialog ${String(dialog.dialogId ?? '')}`);
  return null;
}

/** Backward-compatible name for callers that use the canonical decline in a headless path. */
export const buildHeadlessApothecaryDecline = buildApothecaryDecline;
export type HeadlessApothecaryDecline = ApothecaryDecline;

interface ApothecaryDriverTeam {
  coach?: unknown;
  teamId?: unknown;
  playerArray?: readonly { playerId?: unknown }[];
}

interface ApothecaryDriverGame {
  teamHome?: ApothecaryDriverTeam;
  teamAway?: ApothecaryDriverTeam;
  dialogParameter?: unknown;
}

const coachKey = (value: unknown): string => typeof value === 'string' ? value.trim().toLowerCase() : '';

/**
 * Select only an Apothecary dialog owned by this standalone player driver.
 * Player feeds transform the local team into teamHome; coach matching remains
 * case-insensitive, with transformed home as the safe fallback when names drift.
 */
export function ownedApothecaryDriverDialog(
  game: Readonly<ApothecaryDriverGame> | null | undefined,
  coach: string,
  dialog?: Readonly<Record<string, unknown>> | null,
): Readonly<Record<string, unknown>> | null {
  if (!game) return null;
  const rawDialog = dialog === undefined ? game.dialogParameter : dialog;
  if (!rawDialog || typeof rawDialog !== 'object' || Array.isArray(rawDialog)) return null;
  const candidate = rawDialog as Readonly<Record<string, unknown>>;
  if (candidate.dialogId !== 'useApothecary' && candidate.dialogId !== 'useApothecaries') return null;

  const me = coachKey(coach);
  const teams = [game.teamHome, game.teamAway].filter((team): team is ApothecaryDriverTeam => !!team);
  const team = (me ? teams.find((entry) => coachKey(entry.coach) === me) : undefined) ?? game.teamHome;
  if (!team) return null;
  if (candidate.dialogId === 'useApothecaries') {
    return typeof team.teamId === 'string' && candidate.teamId === team.teamId ? candidate : null;
  }
  const playerId = candidate.playerId;
  return typeof playerId === 'string' && (team.playerArray ?? []).some((player) => player.playerId === playerId)
    ? candidate
    : null;
}

function immutableOfferValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(immutableOfferValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, immutableOfferValue(item)]));
  }
  return value === undefined ? { $undefined: true } : value;
}

/** Identity of one immutable server offer; presentation-only fields are deliberately excluded. */
export function apothecaryOccurrenceKey(dialog: Readonly<Record<string, unknown>>): string | null {
  if (dialog.dialogId === 'useApothecary') {
    return JSON.stringify(immutableOfferValue({
      dialogId: dialog.dialogId,
      playerId: dialog.playerId,
      playerState: dialog.playerState,
      seriousInjury: dialog.seriousInjury,
      apothecaryTypes: dialog.apothecaryTypes,
    }));
  }
  if (dialog.dialogId === 'useApothecaries') {
    const injuries = Array.isArray(dialog.injuryDescriptions)
      ? dialog.injuryDescriptions.map((item) => {
          const injury = item && typeof item === 'object' ? item as Record<string, unknown> : {};
          return {
            playerId: injury.playerId,
            playerState: injury.playerState,
            seriousInjury: injury.seriousInjury,
            apothecaryTypes: injury.apothecaryTypes,
          };
        })
      : dialog.injuryDescriptions;
    return JSON.stringify(immutableOfferValue({
      dialogId: dialog.dialogId,
      teamId: dialog.teamId,
      injuryDescriptions: injuries,
    }));
  }
  return null;
}

/**
 * One-shot responder for the standalone drivers. A successful send latches only
 * the current immutable occurrence; withdrawal/replacement/reconnect calls clear().
 */
export class ApothecaryDriverOccurrence {
  private activeKey: string | null = null;
  private sent = false;
  private attempted = false;
  private retryUsed = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly retryDelayMs = 250) {}

  answer(
    dialog: Readonly<Record<string, unknown>> | null | undefined,
    send: (command: ApothecaryDecline) => void,
    loud: (message: string) => void = console.error,
    currentDialog: () => Readonly<Record<string, unknown>> | null | undefined = () => dialog,
  ): boolean {
    const key = dialog ? apothecaryOccurrenceKey(dialog) : null;
    if (!dialog || !key) {
      this.clear();
      return false;
    }
    if (key !== this.activeKey) {
      this.cancelRetry();
      this.activeKey = key;
      this.sent = false;
      this.attempted = false;
      this.retryUsed = false;
    }
    if (this.sent || this.attempted) return true;

    this.attempted = true;
    this.trySend(key, dialog, send, loud, currentDialog, false);
    return true;
  }

  private trySend(
    key: string,
    dialog: Readonly<Record<string, unknown>>,
    send: (command: ApothecaryDecline) => void,
    loud: (message: string) => void,
    currentDialog: () => Readonly<Record<string, unknown>> | null | undefined,
    retry: boolean,
  ): void {
    if (this.activeKey !== key || this.sent) return;
    const command = buildApothecaryDecline(dialog, loud);
    if (!command) return;
    try {
      send(command);
      if (this.activeKey === key) {
        this.sent = true;
        this.cancelRetry();
      }
    } catch (error) {
      loud(`apothecary election: send failed${retry ? ' on bounded retry' : ''}: ${error instanceof Error ? error.message : String(error)}`);
      if (!retry && !this.retryUsed && this.activeKey === key) {
        this.retryUsed = true;
        this.retryTimer = setTimeout(() => {
          this.retryTimer = null;
          if (this.activeKey !== key || this.sent) return;
          const live = currentDialog();
          if (!live || apothecaryOccurrenceKey(live) !== key) return;
          this.trySend(key, live, send, loud, currentDialog, true);
        }, this.retryDelayMs);
      }
    }
  }

  private cancelRetry(): void {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  clear(): void {
    this.cancelRetry();
    this.activeKey = null;
    this.sent = false;
    this.attempted = false;
    this.retryUsed = false;
  }
}
