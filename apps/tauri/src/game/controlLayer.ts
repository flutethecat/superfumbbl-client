import { CONFIRMATION_DEFAULTS, normalizeConfirmationSettings, type ConfirmationSettingKey, type ConfirmationSettings } from './confirmationSettings';

/**
 * FUMBBL Controls (owner 11-03, spec-fumbbl-controls-2026-11-03.md §1, §3, §4): the CONTROL LAYER settings - pure, no
 * settings import (settings.ts imports this).
 *
 * Two layers change INPUT only: Super FUMBBL Controls (the default, today's behaviour) and FUMBBL Controls (an exact
 * mirror of the FUMBBL client's mouse model). Presentation is ours in both.
 *
 * Storage:
 *  - `controlLayer`: the layer the coach picked in Settings (a switch during their own activation waits - see
 *    controlLayerSwitch.ts - and the flat confirmation values below keep the old layer's until it applies).
 *  - `rightClickBehaviour`: one value PER LAYER (§3).
 *  - Confirmation cards (§4): the flat ConfirmationSettings keys on AppSettings are the values of the layer named by
 *    `confirmationsLayer` (every consumer keeps reading them unchanged). `layerConfirmations` keeps the OTHER layer's
 *    values; switching swaps them, so a change sticks to the layer it was made in and switching back restores it.
 *    FUMBBL Controls starts with every confirmation OFF.
 */
export type ControlLayer = 'super' | 'fumbbl';
export const CONTROL_LAYERS: readonly ControlLayer[] = ['super', 'fumbbl'];

/** FFB "Right Click Behaviour" (ClientStateAwt.mouseReleased) plus our own cascade. */
export type RightClickBehaviour = 'super' | 'endAction' | 'leftClick' | 'contextMenu' | 'disabled';
export const RIGHT_CLICK_BEHAVIOURS: readonly RightClickBehaviour[] = ['super', 'endAction', 'leftClick', 'contextMenu', 'disabled'];
export const RIGHT_CLICK_DEFAULTS: Readonly<Record<ControlLayer, RightClickBehaviour>> = { super: 'super', fumbbl: 'contextMenu' };

export interface ControlLayerSettings {
  controlLayer: ControlLayer;
  /** FUMBBL Controls sub-option (FFB "Automove", default on): a distant square click walks a safe path at once. */
  automove: boolean;
  rightClickBehaviour: Record<ControlLayer, RightClickBehaviour>;
  /** The layer whose values the flat confirmation keys hold right now. */
  confirmationsLayer: ControlLayer;
  /** The confirmation values of the layer NOT in the flat keys (a missing entry = that layer's defaults). */
  layerConfirmations: Partial<Record<ControlLayer, ConfirmationSettings>>;
  /** FUMBBL keyboard shortcuts (§5): one toggle, off by default, usable in either layer. On = WASD camera pan off. */
  fumbblShortcuts: boolean;
}

export const CONTROL_LAYER_DEFAULTS: ControlLayerSettings = {
  controlLayer: 'super',
  automove: true,
  rightClickBehaviour: { ...RIGHT_CLICK_DEFAULTS },
  confirmationsLayer: 'super',
  layerConfirmations: {},
  fumbblShortcuts: false,
};

/** FUMBBL Controls starts with every confirmation card OFF (§4). */
export const FUMBBL_CONFIRMATION_DEFAULTS: ConfirmationSettings = Object.fromEntries(
  Object.keys(CONFIRMATION_DEFAULTS).map((key) => [key, false]),
) as unknown as ConfirmationSettings;

export function confirmationDefaultsFor(layer: ControlLayer): ConfirmationSettings {
  return { ...(layer === 'fumbbl' ? FUMBBL_CONFIRMATION_DEFAULTS : CONFIRMATION_DEFAULTS) };
}

const isLayer = (v: unknown): v is ControlLayer => v === 'super' || v === 'fumbbl';
const isRightClick = (v: unknown): v is RightClickBehaviour => typeof v === 'string' && (RIGHT_CLICK_BEHAVIOURS as readonly string[]).includes(v);

/** A stored per-layer confirmation block, read strictly (only booleans count; a missing key = that layer's default). */
function normalizeLayerConfirmations(layer: ControlLayer, raw: unknown): ConfirmationSettings {
  if (layer === 'super') return normalizeConfirmationSettings(raw && typeof raw === 'object' ? raw as Record<string, unknown> : {});
  const out = confirmationDefaultsFor('fumbbl');
  if (raw && typeof raw === 'object') {
    for (const key of Object.keys(out) as ConfirmationSettingKey[]) {
      const v = (raw as Record<string, unknown>)[key];
      if (typeof v === 'boolean') out[key] = v;
    }
  }
  return out;
}

/** Load-time read of the stored blob (fail closed to the defaults on junk). */
export function normalizeControlLayerSettings(raw: Record<string, unknown> | null | undefined): ControlLayerSettings {
  const r = raw ?? {};
  const rc = r.rightClickBehaviour && typeof r.rightClickBehaviour === 'object' ? r.rightClickBehaviour as Record<string, unknown> : {};
  const lc = r.layerConfirmations && typeof r.layerConfirmations === 'object' ? r.layerConfirmations as Record<string, unknown> : {};
  const layerConfirmations: Partial<Record<ControlLayer, ConfirmationSettings>> = {};
  for (const layer of CONTROL_LAYERS) if (lc[layer] && typeof lc[layer] === 'object') layerConfirmations[layer] = normalizeLayerConfirmations(layer, lc[layer]);
  return {
    controlLayer: isLayer(r.controlLayer) ? r.controlLayer : 'super',
    automove: r.automove !== false,
    rightClickBehaviour: {
      super: isRightClick(rc.super) ? rc.super : RIGHT_CLICK_DEFAULTS.super,
      fumbbl: isRightClick(rc.fumbbl) ? rc.fumbbl : RIGHT_CLICK_DEFAULTS.fumbbl,
    },
    // A blob from before this feature stored only Super FUMBBL's confirmation values in the flat keys.
    confirmationsLayer: isLayer(r.confirmationsLayer) ? r.confirmationsLayer : 'super',
    layerConfirmations,
    fumbblShortcuts: r.fumbblShortcuts === true,
  };
}

type SwapTarget = ConfirmationSettings & Pick<ControlLayerSettings, 'confirmationsLayer' | 'layerConfirmations'>;

/** Put `layer`'s confirmation values into the flat keys (saving the outgoing layer's). Idempotent; true when it swapped. */
export function applyLayerConfirmations(s: SwapTarget, layer: ControlLayer): boolean {
  if (s.confirmationsLayer === layer) return false;
  const keys = Object.keys(CONFIRMATION_DEFAULTS) as ConfirmationSettingKey[];
  const outgoing = {} as ConfirmationSettings;
  for (const key of keys) outgoing[key] = s[key] === true;
  const incoming = s.layerConfirmations[layer] ?? confirmationDefaultsFor(layer);
  s.layerConfirmations = { ...s.layerConfirmations, [s.confirmationsLayer]: outgoing };
  delete s.layerConfirmations[layer];
  for (const key of keys) s[key] = incoming[key] === true;
  s.confirmationsLayer = layer;
  return true;
}

/** The right-click behaviour in effect for `layer`. */
export function rightClickBehaviourFor(s: Pick<ControlLayerSettings, 'rightClickBehaviour'>, layer: ControlLayer): RightClickBehaviour {
  const v = s.rightClickBehaviour?.[layer];
  return isRightClick(v) ? v : RIGHT_CLICK_DEFAULTS[layer];
}
