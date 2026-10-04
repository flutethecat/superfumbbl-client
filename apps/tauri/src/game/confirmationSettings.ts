import type { EndActivationConfirmKind } from './logic/order66Interaction';

/** Owner 10-04: "let's make the confirmation modals toggleable in Settings. Each confirmation modal should have its
 *  own line item that users can disable in settings."
 *
 *  These are the CLIENT's own "are you sure" prompts - never a server dialog (the client does not answer those for
 *  the coach). Turning one off means the gesture goes straight through, exactly as the prompt's confirm button would
 *  have sent it. All default ON. */
export interface ConfirmationSettings {
  confirmEndTurn: boolean;
  confirmEndBlitz: boolean;
  confirmBlitzToMove: boolean;
  confirmEndPunt: boolean;
  confirmEndHandOff: boolean;
  confirmEndPass: boolean;
  confirmEndActivation: boolean;
  confirmSetup: boolean;
  confirmConcedeOffer: boolean;
}
export type ConfirmationSettingKey = keyof ConfirmationSettings;

export const CONFIRMATION_DEFAULTS: ConfirmationSettings = {
  confirmEndTurn: true,
  confirmEndBlitz: true,
  confirmBlitzToMove: true,
  confirmEndPunt: true,
  confirmEndHandOff: true,
  confirmEndPass: true,
  confirmEndActivation: true,
  confirmSetup: true,
  confirmConcedeOffer: true,
};

/** The Settings rows, in display order. */
export const CONFIRMATION_SETTING_ROWS: readonly { key: ConfirmationSettingKey; label: string; hint: string }[] = [
  { key: 'confirmEndTurn', label: 'End Turn with players still to act', hint: 'Asks before ending your turn while some of your players have not activated.' },
  { key: 'confirmEndBlitz', label: 'End or cancel a Blitz', hint: 'Asks before a right-click, Escape or End gesture ends your Blitz.' },
  { key: 'confirmBlitzToMove', label: 'Keep Blitz? (convert a Blitz to a Move)', hint: 'Asks when you click an open square instead of a Blitz target. Off: that click converts the Blitz to a Move at once.' },
  { key: 'confirmEndHandOff', label: 'End or cancel a Hand-off', hint: 'Asks before a right-click, Escape or End gesture ends your Hand-off.' },
  { key: 'confirmEndPass', label: 'End or cancel a Pass', hint: 'Asks before a right-click, Escape or End gesture ends your Pass action.' },
  { key: 'confirmEndPunt', label: 'End or cancel a Punt', hint: 'Asks before your Punt is ended.' },
  { key: 'confirmEndActivation', label: 'End activation with Escape', hint: 'Asks before Escape ends any other activation, and before an End that would roll for the player.' },
  { key: 'confirmSetup', label: 'Confirm Setup', hint: 'Asks before a legal setup is locked in. A setup that is not legal always shows what is wrong.' },
  { key: 'confirmConcedeOffer', label: 'Offer to concede at setup', hint: 'Asks whether to concede when you have too few players to field. You can still concede from the Game Menu.' },
];

const END_ACTIVATION_KEY: Record<EndActivationConfirmKind, ConfirmationSettingKey> = {
  blitz: 'confirmEndBlitz',
  punt: 'confirmEndPunt',
  handOver: 'confirmEndHandOff',
  pass: 'confirmEndPass',
  generic: 'confirmEndActivation',
};

/** Is the end-activation prompt of this kind switched on? */
export function endActivationConfirmEnabled(kind: EndActivationConfirmKind, settings: Partial<ConfirmationSettings>): boolean {
  return settings[END_ACTIVATION_KEY[kind]] !== false;
}

/** Fail-closed read of the stored settings blob: only an explicit `false` turns a prompt off. */
export function normalizeConfirmationSettings(raw: Record<string, unknown> | null | undefined): ConfirmationSettings {
  const out = { ...CONFIRMATION_DEFAULTS };
  for (const key of Object.keys(CONFIRMATION_DEFAULTS) as ConfirmationSettingKey[]) out[key] = raw?.[key] !== false;
  return out;
}
