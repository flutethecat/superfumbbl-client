import { ModelChangeId } from './modelChangeId';
import type {
  FieldModelJson,
  GameJson,
  InducementSetJson,
  ModelChangeJson,
  ModelChangeListJson,
  PlayerDataJson,
  PlayerJson,
  PlayerResultJson,
  TeamResultJson,
  TurnDataJson,
} from './types';
import {
  BB2025_PRAYERS,
  BB2025_SKILL_DEFAULT_VALUES,
  INTENSIVE_TRAINING_SOURCE,
  WISDOM_ENHANCEMENT_SOURCE,
  WISDOM_GRANTABLE_SKILLS,
  type PrayerEnhancementMeta,
} from './prayerEnhancements.generated';
import { encodeSkillWithValue } from './playerSkills';

/**
 * Port of ffb-common ModelChangeProcessor.apply() operating on the wire-shape
 * game state (see types.ts). Behavior mirrors the Java switch case-for-case;
 * differences are commented at the site.
 */

const HOME = 'home';

function isHomeData(change: ModelChangeJson): boolean {
  return change.modelChangeKey === HOME;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Java remove() relies on equals(), which for pitch decorations compares by
 * coordinate. Try full deep-equal first, then fall back to coordinate match.
 */
function removeFromArray(array: unknown[], value: unknown): void {
  let index = array.findIndex((entry) => deepEqual(entry, value));
  if (index < 0 && value != null && typeof value === 'object') {
    const coordinate = (value as Record<string, unknown>).coordinate;
    if (coordinate !== undefined) {
      index = array.findIndex(
        (entry) => deepEqual((entry as Record<string, unknown>)?.coordinate, coordinate),
      );
    }
  }
  if (index >= 0) array.splice(index, 1);
}

function addToStringArray(array: string[], value: string): void {
  if (!array.includes(value)) array.push(value);
}

function removeFromStringArray(array: string[], value: string): void {
  const index = array.indexOf(value);
  if (index >= 0) array.splice(index, 1);
}

function getPlayerById(game: GameJson, playerId: string | null): PlayerJson | undefined {
  if (!playerId) return undefined;
  return (
    game.teamHome.playerArray.find((p) => p.playerId === playerId) ??
    game.teamAway.playerArray.find((p) => p.playerId === playerId)
  );
}

function getPlayerData(fieldModel: FieldModelJson, playerId: string): PlayerDataJson | undefined {
  return fieldModel.playerDataArray.find((entry) => entry.playerId === playerId);
}

function upsertPlayerData(fieldModel: FieldModelJson, playerId: string): PlayerDataJson {
  let data = getPlayerData(fieldModel, playerId);
  if (!data) {
    data = { playerId, playerCoordinate: null, playerState: 0, cards: [], cardEffects: [] };
    fieldModel.playerDataArray.push(data);
  }
  return data;
}

function getTurnData(game: GameJson, homeData: boolean): TurnDataJson {
  return homeData ? game.turnDataHome : game.turnDataAway;
}

function getInducementSet(game: GameJson, homeData: boolean): InducementSetJson {
  return getTurnData(game, homeData).inducementSet;
}

function getTeamResult(game: GameJson, homeData: boolean): TeamResultJson {
  return homeData ? game.gameResult.teamResultHome : game.gameResult.teamResultAway;
}

function getPlayerResult(game: GameJson, playerId: string | null): PlayerResultJson | undefined {
  if (!playerId) return undefined;
  return (
    game.gameResult.teamResultHome.playerResults.find((r) => r.playerId === playerId) ??
    game.gameResult.teamResultAway.playerResults.find((r) => r.playerId === playerId)
  );
}

type Handler = (game: GameJson, change: ModelChangeJson) => void;

function actingPlayerSetter(field: string): Handler {
  return (game, change) => {
    game.actingPlayer[field] = change.modelChangeValue;
  };
}

function gameSetter(field: string): Handler {
  return (game, change) => {
    game[field] = change.modelChangeValue;
  };
}

/** Game setters whose value rides in modelChangeKey, not modelChangeValue. */
function gameKeySetter(field: string): Handler {
  return (game, change) => {
    game[field] = change.modelChangeKey;
  };
}

function fieldModelSetter(field: string): Handler {
  return (game, change) => {
    game.fieldModel[field] = change.modelChangeValue;
  };
}

function fieldModelAdd(arrayField: keyof FieldModelJson & string): Handler {
  return (game, change) => {
    (game.fieldModel[arrayField] as unknown[]).push(change.modelChangeValue);
  };
}

/**
 * Idempotent-by-COORDINATE add — the wire-faithful applier for the fieldModel collections upstream keeps in a
 * `Set<X>` whose `X.equals`/`hashCode` is BY COORDINATE ONLY: PushbackSquare (FieldModel.java:72 `Set`,
 * PushbackSquare.java:82-87), MoveSquare, DiceDecoration, TrackNumber (all `Set` + coordinate-keyed equals).
 * A `Set.add` of an already-present coordinate is a NO-OP, so re-adding an existing coordinate must NOT create a
 * second entry. Our previous bare `array.push` was a WIRE-SEMANTICS PARITY bug: the server's one-frame
 * add-then-remove (e.g. a Stand-Firm push negate — g478 seq73: ADD [11,7],[11,8] then REMOVE [11,7],[11,8])
 * left duplicates the single-entry `removeFromArray` couldn't clear, so the array RETAINED the stale squares →
 * phantom crosshair + a PUSHBACK derive + an unsolicited clientPushback → dead game. Matching the Set: skip the
 * add when a same-coordinate entry already exists (keep the existing, exactly as `Set.add` does). The
 * List-backed collections (bloodspots, trapDoors) + the identity-equality Sets (field/player markers) keep the
 * bare `fieldModelAdd` — they have no coordinate-dedup semantics upstream.
 */
function fieldModelAddByCoordinate(arrayField: keyof FieldModelJson & string): Handler {
  return (game, change) => {
    const arr = game.fieldModel[arrayField] as unknown[];
    const coordinate = (change.modelChangeValue as Record<string, unknown> | null)?.coordinate;
    if (coordinate !== undefined) {
      const present = arr.some((entry) => deepEqual((entry as Record<string, unknown>)?.coordinate, coordinate));
      if (present) return; // Set.add no-op: a same-coordinate entry already exists
    }
    arr.push(change.modelChangeValue);
  };
}

function fieldModelRemove(arrayField: keyof FieldModelJson & string): Handler {
  return (game, change) => {
    removeFromArray(game.fieldModel[arrayField] as unknown[], change.modelChangeValue);
  };
}

function turnDataSetter(field: string): Handler {
  return (game, change) => {
    getTurnData(game, isHomeData(change))[field] = change.modelChangeValue;
  };
}

function teamResultSetter(field: string): Handler {
  return (game, change) => {
    getTeamResult(game, isHomeData(change))[field] = change.modelChangeValue;
  };
}

function playerResultSetter(field: string): Handler {
  return (game, change) => {
    const result = getPlayerResult(game, change.modelChangeKey);
    if (result) result[field] = change.modelChangeValue;
  };
}

function inducementArrayAdd(arrayField: keyof InducementSetJson & string): Handler {
  return (game, change) => {
    (getInducementSet(game, isHomeData(change))[arrayField] as unknown[]).push(change.modelChangeValue);
  };
}

function inducementArrayRemove(arrayField: keyof InducementSetJson & string): Handler {
  return (game, change) => {
    removeFromArray(getInducementSet(game, isHomeData(change))[arrayField] as unknown[], change.modelChangeValue);
  };
}

/**
 * Player temporary-enhancement changes we cannot yet reproduce exactly (generic ADD_ENHANCEMENTS reads the
 * server's EnhancementRegistry) stay a per-player diagnostic log: nothing is lost, but skillArray-derived
 * displays won't reflect them. HATRED / PRAYER / INTENSIVE_TRAINING / WISDOM have exact appliers below;
 * ADD_SKILL_ENHANCEMENTS is exact for the skills in SKILL_ENHANCEMENT_GRANTS.
 */
function playerEnhancementLog(kind: string): Handler {
  return (game, change) => {
    const player = getPlayerById(game, change.modelChangeKey);
    if (!player) return;
    const log = (player.temporaryPropertiesMap[`ffb40k:${kind}`] ??= []) as unknown[];
    log.push(change.modelChangeValue);
  };
}

// ---- temporary enhancement maps (exact ffb-common Player/FieldModel mirror) --------------------------------

/** RosterPlayer.addTemporarySkills/Modifiers/Properties (RosterPlayer.java:774-826): the source key is created
 *  even for an EMPTY set, then the set is unioned into. */
function addTemporaryEntries(map: Record<string, unknown>, source: string, entries: readonly string[]): void {
  let bucket = map[source] as unknown[] | undefined;
  if (!Array.isArray(bucket)) map[source] = bucket = [];
  for (const entry of entries) if (!bucket.some((value) => String(value) === entry)) bucket.push(entry);
}

/** RosterPlayer.getEnhancementSources (RosterPlayer.java:792-799) — the union of the three map key sets. */
function hasActiveEnhancement(player: PlayerJson, source: string): boolean {
  return source in (player.temporaryModifiersMap ?? {})
    || source in (player.temporarySkillsMap ?? {})
    || source in (player.temporaryPropertiesMap ?? {});
}

/** Player.removeEnhancements (Player.java:389-393) — drops the source from all three maps. */
function removeEnhancements(player: PlayerJson, source: string): void {
  delete player.temporaryModifiersMap?.[source];
  delete player.temporaryPropertiesMap?.[source];
  delete player.temporarySkillsMap?.[source];
}

/** Player.addEnhancement (Player.java:403-411) — no-op when the source is already active, otherwise writes the
 *  modifier/property/skill sets under it. Modifier wire names are `${stat}-${class}`
 *  (TemporaryStatModifier.java:9,20-23); skills are `Name` / `Name_value`. */
function addEnhancement(player: PlayerJson, meta: PrayerEnhancementMeta): void {
  if (hasActiveEnhancement(player, meta.name)) return;
  player.temporaryModifiersMap ??= {};
  player.temporaryPropertiesMap ??= {};
  player.temporarySkillsMap ??= {};
  addTemporaryEntries(player.temporaryModifiersMap, meta.name,
    meta.modifiers.map((modifier) => `${modifier.stat}-${modifier.modifierClass}`));
  addTemporaryEntries(player.temporaryPropertiesMap, meta.name, []); // enhancements().getProperties() is empty for every prayer
  addTemporaryEntries(player.temporarySkillsMap, meta.name, meta.skills.map(encodeSkillWithValue));
}

/** BB2025 KickoffResult.DODGY_SNACK uses the generic addEnhancements wire rather than the prayer wire. */
const DODGY_SNACK_ENHANCEMENT: PrayerEnhancementMeta = {
  name: 'Dodgy Snack',
  description: 'Movement and armour are reduced by one for the drive.',
  duration: 'drive',
  affectsBothTeams: false,
  changingPlayer: true,
  eventMessage: null,
  skills: [],
  modifiers: [
    { stat: 'AV', modifierClass: 'com.fumbbl.ffb.modifiers.TemporaryStatDecrementer' },
    { stat: 'MA', modifierClass: 'com.fumbbl.ffb.modifiers.TemporaryStatDecrementer' },
  ],
};

function addGenericEnhancements(game: GameJson, change: ModelChangeJson): void {
  const source = change.modelChangeValue == null ? '' : String(change.modelChangeValue);
  const player = getPlayerById(game, change.modelChangeKey);
  if (player && source === DODGY_SNACK_ENHANCEMENT.name) {
    addEnhancement(player, DODGY_SNACK_ENHANCEMENT);
    return;
  }
  playerEnhancementLog('enhancements')(game, change);
}

/**
 * BB2025 Getting Even (FieldModel.addHatred): the selected wire keyword is the
 * temporary Hatred skill's value and also scopes its enhancement source. Keep
 * every keyword as an independent source so repeated frames de-duplicate while
 * distinct selections coexist exactly as they do upstream.
 */
function addHatred(game: GameJson, change: ModelChangeJson): void {
  const player = getPlayerById(game, change.modelChangeKey);
  if (!player) return;
  const keyword = typeof change.modelChangeValue === 'string' ? change.modelChangeValue.trim() : '';
  // ModelChangeProcessor.FIELD_MODEL_ADD_HATRED first records the chosen keyword
  // in PlayerResult, then FieldModel.addHatred installs the temporary skill.
  // A catch-up/replay frame can be applied more than once client-side, so mirror
  // the result as a set-like array while preserving its first-seen order.
  const result = getPlayerResult(game, change.modelChangeKey);
  if (result && keyword) {
    const gainedHatred = Array.isArray(result.gainedHatred)
      ? result.gainedHatred as string[]
      : [];
    addToStringArray(gainedHatred, keyword);
    result.gainedHatred = gainedHatred;
  }
  const source = keyword ? `Getting Even ${keyword}` : 'Getting Even';
  player.temporarySkillsMap ??= {};
  addTemporaryEntries(player.temporarySkillsMap, source, [
    encodeSkillWithValue({ name: 'Hatred', value: keyword || null }),
  ]);
}

interface SkillEnhancementGrant {
  readonly skills: readonly { name: string; value: string | null }[];
  readonly properties: readonly string[];
}

/** Exact `TemporaryEnhancements` tables used by `ffb-common/.../FieldModel.java` `addSkillEnhancements`. */
const SKILL_ENHANCEMENT_GRANTS: Record<string, SkillEnhancementGrant> = {
  // `mixed/special/ShotToNothing.java` `postConstruct`: Hail Mary Pass for this activation.
  'Shot to Nothing': {
    skills: [{ name: 'Hail Mary Pass', value: null }], properties: [],
  },
  // `bb2025/special/IllCarryYou.java` `postConstruct`: Break Tackle + Dodge while carrying.
  "I'll Carry You": {
    skills: [{ name: 'Break Tackle', value: null }, { name: 'Dodge', value: null }], properties: [],
  },
  // `bb2025/special/Incorporeal.java` `postConstruct`: ignoreTacklezonesWhenMoving;
  // `JsonSkillPropertiesMapOption.addTo` serializes `property.getName()`.
  Incorporeal: { skills: [], properties: ['Ignore Tacklezones When Moving'] },
};

const handlers: Record<string, Handler> = {
  [ModelChangeId.ACTING_PLAYER_MARK_SKILL_USED]: (game, change) =>
    addToStringArray(game.actingPlayer.usedSkills, change.modelChangeValue as string),
  [ModelChangeId.ACTING_PLAYER_MARK_SKILL_UNUSED]: (game, change) =>
    removeFromStringArray(game.actingPlayer.usedSkills, change.modelChangeValue as string),
  [ModelChangeId.ACTING_PLAYER_SET_CURRENT_MOVE]: actingPlayerSetter('currentMove'),
  [ModelChangeId.ACTING_PLAYER_SET_DODGING]: actingPlayerSetter('dodging'),
  [ModelChangeId.ACTING_PLAYER_SET_GOING_FOR_IT]: actingPlayerSetter('goingForIt'),
  [ModelChangeId.ACTING_PLAYER_SET_HAS_BLOCKED]: actingPlayerSetter('hasBlocked'),
  [ModelChangeId.ACTING_PLAYER_SET_HAS_FED]: actingPlayerSetter('hasFed'),
  [ModelChangeId.ACTING_PLAYER_SET_HAS_FOULED]: actingPlayerSetter('hasFouled'),
  [ModelChangeId.ACTING_PLAYER_SET_HAS_JUMPED]: actingPlayerSetter('hasJumped'),
  [ModelChangeId.ACTING_PLAYER_SET_HAS_TRIGGERED_EFFECT]: actingPlayerSetter('hasTriggeredEffect'),
  // Upstream ffb-common/.../ModelChangeProcessor.java:131-132 delegates the string array;
  // ffb-common/.../ActingPlayer.java:521-526 replaces the set.
  [ModelChangeId.ACTING_PLAYER_SET_INITIAL_ADJACENT_PARTNER_IDS]: (game, change) => {
    game.actingPlayer.initialAdjacentPartnerIds = Array.isArray(change.modelChangeValue)
      ? change.modelChangeValue.filter((id): id is string => typeof id === 'string')
      : [];
  },
  [ModelChangeId.ACTING_PLAYER_SET_HAS_MOVED]: actingPlayerSetter('hasMoved'),
  [ModelChangeId.ACTING_PLAYER_SET_HAS_PASSED]: actingPlayerSetter('hasPassed'),
  [ModelChangeId.ACTING_PLAYER_SET_JUMPING]: actingPlayerSetter('leaping'),
  [ModelChangeId.ACTING_PLAYER_SET_OLD_PLAYER_STATE]: actingPlayerSetter('playerStateOld'),
  [ModelChangeId.ACTING_PLAYER_SET_PLAYER_ACTION]: actingPlayerSetter('playerAction'),
  // Owner 2026-07-08 (vampire bloodlust bug): the FFB server's ActingPlayer.setPlayerId RESETS every
  // per-activation flag when the acting player changes — and the server RELIES on it (it never sends
  // e.g. `sufferingBloodLust:false`). A bare setter left `sufferingBloodlust` (and other flags) stale,
  // so a vampire's bloodlust 🩸 leaked onto every NEXT activating player (seen on a Necromantic team,
  // game 1919968). Mirror the Java reset here. NOT `strength` — Java recomputes it internally, whereas
  // our wire delivers it via actingPlayerSetStrength (sent BEFORE playerId in the frame), so resetting
  // it would wipe that value; every OTHER reset-flag is sent AFTER playerId so the reset is safe.
  [ModelChangeId.ACTING_PLAYER_SET_PLAYER_ID]: (game, change) => {
    const next = (change.modelChangeValue ?? null) as string | null;
    const ap = game.actingPlayer;
    if (ap.playerId !== next) {
      ap.playerStateOld = null;
      ap.usedSkills = [];
      // Upstream ffb-common/.../ActingPlayer.java:72-105 clears the set on actor change.
      ap.initialAdjacentPartnerIds = [];
      ap.skillsGrantedBy = {};
      ap.currentMove = 0;
      ap.playerAction = null;
      for (const f of ['goingForIt', 'dodging', 'hasBlocked', 'hasFouled', 'hasPassed', 'hasMoved', 'hasFed',
        'leaping', 'standingUp', 'sufferingBloodlust', 'sufferingAnimosity', 'hasJumped', 'jumpsWithoutModifiers',
        'heldInPlace', 'mustCompleteAction', 'fellFromRush', 'hasTriggeredEffect']) ap[f] = false;
    }
    ap.playerId = next;
  },
  [ModelChangeId.ACTING_PLAYER_SET_STANDING_UP]: actingPlayerSetter('standingUp'),
  [ModelChangeId.ACTING_PLAYER_SET_STRENGTH]: actingPlayerSetter('strength'),
  [ModelChangeId.ACTING_PLAYER_SET_SUFFERING_ANIMOSITY]: actingPlayerSetter('sufferingAnimosity'),
  [ModelChangeId.ACTING_PLAYER_SET_SUFFERING_BLOOD_LUST]: actingPlayerSetter('sufferingBloodlust'),
  [ModelChangeId.ACTING_PLAYER_SET_JUMPS_WITHOUT_MODIFIERS]: actingPlayerSetter('jumpsWithoutModifiers'),
  [ModelChangeId.ACTING_PLAYER_SET_HELD_IN_PLACE]: actingPlayerSetter('heldInPlace'),
  [ModelChangeId.ACTING_PLAYER_SET_MUST_COMPLETE_ACTION]: actingPlayerSetter('mustCompleteAction'),
  [ModelChangeId.ACTING_PLAYER_SET_FELL_FROM_RUSH]: actingPlayerSetter('fellFromRush'),

  [ModelChangeId.FIELD_MODEL_ADD_BLOOD_SPOT]: fieldModelAdd('bloodspotArray'),
  [ModelChangeId.FIELD_MODEL_ADD_CARD]: (game, change) => {
    if (change.modelChangeKey) upsertPlayerData(game.fieldModel, change.modelChangeKey).cards.push(change.modelChangeValue);
  },
  [ModelChangeId.FIELD_MODEL_ADD_CARD_EFFECT]: (game, change) => {
    if (change.modelChangeKey)
      upsertPlayerData(game.fieldModel, change.modelChangeKey).cardEffects.push(change.modelChangeValue);
  },
  [ModelChangeId.FIELD_MODEL_ADD_DICE_DECORATION]: fieldModelAddByCoordinate('diceDecorationArray'),
  [ModelChangeId.FIELD_MODEL_ADD_ENHANCEMENTS]: addGenericEnhancements,
  [ModelChangeId.FIELD_MODEL_ADD_HATRED]: addHatred,
  // FieldModel.addIntensiveTrainingSkill (FieldModel.java:451-457): the chosen skill lands in
  // temporarySkillsMap under the Intensive Training prayer's NAME, ALWAYS carrying an explicit value —
  // `String.valueOf(skill.getDefaultSkillValue())` — so a 0-default skill encodes as `Name_0`, not `Name`.
  // No addEnhancement() guard upstream: this writes the skill map directly.
  [ModelChangeId.FIELD_MODEL_ADD_INTENSIVE_TRAINING]: (game, change) => {
    const player = getPlayerById(game, change.modelChangeKey);
    const skill = change.modelChangeValue == null ? '' : String(change.modelChangeValue);
    if (!player || !skill) return;
    player.temporarySkillsMap ??= {};
    addTemporaryEntries(player.temporarySkillsMap, INTENSIVE_TRAINING_SOURCE,
      [`${skill}_${BB2025_SKILL_DEFAULT_VALUES[skill] ?? 0}`]);
  },
  [ModelChangeId.FIELD_MODEL_ADD_FIELD_MARKER]: fieldModelAdd('fieldMarkerArray'),
  [ModelChangeId.FIELD_MODEL_ADD_MOVE_SQUARE]: fieldModelAddByCoordinate('moveSquareArray'),
  [ModelChangeId.FIELD_MODEL_ADD_PLAYER_MARKER]: fieldModelAdd('playerMarkerArray'),
  // FieldModel.addPrayerEnhancements (FieldModel.java:409-414) -> Player.addEnhancement under
  // `prayer.getName()`; the wire value is the ENUM name (`prayer.name()`), resolved by
  // ModelChangeProcessor.java:170-172 through the BB2025 PrayerFactory. An unknown enum name keeps the old
  // diagnostic log so nothing is silently dropped.
  [ModelChangeId.FIELD_MODEL_ADD_PRAYER]: (game, change) => {
    const meta: PrayerEnhancementMeta | undefined = BB2025_PRAYERS[String(change.modelChangeValue)];
    if (!meta) return playerEnhancementLog('prayer')(game, change);
    const player = getPlayerById(game, change.modelChangeKey);
    if (player) addEnhancement(player, meta);
  },
  [ModelChangeId.FIELD_MODEL_ADD_PUSHBACK_SQUARE]: fieldModelAddByCoordinate('pushbackSquareArray'),
  // FieldModel.addSkillEnhancements (FieldModel.java:425-429): Player.addEnhancement under the skill's NAME
  // (the enhancement SOURCE hasActiveEnhancement checks), granting its skills and properties.
  // Known skills are exact; unknown ones keep the diagnostic log.
  [ModelChangeId.FIELD_MODEL_ADD_SKILL_ENHANCEMENTS]: (game, change) => {
    const source = change.modelChangeValue == null ? '' : String(change.modelChangeValue);
    const grant = SKILL_ENHANCEMENT_GRANTS[source];
    if (!grant) return playerEnhancementLog('skillEnhancements')(game, change);
    const player = getPlayerById(game, change.modelChangeKey);
    if (!player) return;
    if (hasActiveEnhancement(player, source)) return; // addEnhancement's already-active no-op
    player.temporaryModifiersMap ??= {};
    player.temporaryPropertiesMap ??= {};
    player.temporarySkillsMap ??= {};
    addTemporaryEntries(player.temporaryModifiersMap, source, []);
    addTemporaryEntries(player.temporaryPropertiesMap, source, grant.properties);
    addTemporaryEntries(player.temporarySkillsMap, source, grant.skills.map(encodeSkillWithValue));
  },
  [ModelChangeId.FIELD_MODEL_ADD_TRACK_NUMBER]: fieldModelAddByCoordinate('trackNumberArray'),
  [ModelChangeId.FIELD_MODEL_ADD_TRAP_DOOR]: fieldModelAdd('trapDoors'),
  // FieldModel.addWisdomSkill (FieldModel.java:459-464) via ModelChangeProcessor.java:187-190: the wire skill
  // NAME is matched against Constant.GRANT_ABLE_SKILLS (which carries Mighty Blow's "1"), then written under
  // WisdomOfTheWhiteDwarf.enhancementSourceName(). A name outside that set is ignored, exactly as upstream's
  // `findFirst().ifPresent(...)` does.
  [ModelChangeId.FIELD_MODEL_ADD_WISDOM]: (game, change) => {
    const skill = change.modelChangeValue == null ? '' : String(change.modelChangeValue);
    const grant = WISDOM_GRANTABLE_SKILLS.find((entry) => entry.name === skill);
    const player = getPlayerById(game, change.modelChangeKey);
    if (!player || !grant) return;
    player.temporarySkillsMap ??= {};
    addTemporaryEntries(player.temporarySkillsMap, WISDOM_ENHANCEMENT_SOURCE, [encodeSkillWithValue(grant)]);
  },
  [ModelChangeId.FIELD_MODEL_KEEP_DEACTIVATED_CARD]: (game, change) => {
    if (change.modelChangeKey) upsertPlayerData(game.fieldModel, change.modelChangeKey).cards.push(change.modelChangeValue);
  },
  [ModelChangeId.FIELD_MODEL_REMOVE_CARD]: (game, change) => {
    if (change.modelChangeKey) {
      const data = getPlayerData(game.fieldModel, change.modelChangeKey);
      if (data) removeFromArray(data.cards, change.modelChangeValue);
    }
  },
  [ModelChangeId.FIELD_MODEL_REMOVE_CARD_EFFECT]: (game, change) => {
    if (change.modelChangeKey) {
      const data = getPlayerData(game.fieldModel, change.modelChangeKey);
      if (data) removeFromArray(data.cardEffects, change.modelChangeValue);
    }
  },
  [ModelChangeId.FIELD_MODEL_REMOVE_DICE_DECORATION]: fieldModelRemove('diceDecorationArray'),
  [ModelChangeId.FIELD_MODEL_REMOVE_FIELD_MARKER]: fieldModelRemove('fieldMarkerArray'),
  [ModelChangeId.FIELD_MODEL_REMOVE_MOVE_SQUARE]: fieldModelRemove('moveSquareArray'),
  [ModelChangeId.FIELD_MODEL_REMOVE_PLAYER]: (game, change) => {
    // Upstream FieldModel.remove(Player) (FieldModel.java:234) removes ONLY the field
    // COORDINATE (fCoordinateByPlayerId.remove) — playerState and cards live in SEPARATE
    // maps and are left UNTOUCHED (the change's data type is FIELD_COORDINATE, i.e. "leave
    // the field", not "delete the player"). Our combined playerData object must mirror that:
    // clear the coordinate, KEEP the entry (state/cards). Splicing the whole entry destroyed a
    // just-set KO/CAS state — the injury wire is setPlayerState(5/6) → removePlayer →
    // setPlayerCoordinate(box); the splice dropped the state, then setPlayerCoordinate
    // re-created the entry via upsertPlayerData with the default playerState:0 (UNKNOWN),
    // so KO'd/casualtied players landed in the RESERVES catch-all instead of the KO/CAS box
    // (#33 / #29). Nulling the coordinate preserves the state → correct box.
    if (change.modelChangeKey) {
      const data = game.fieldModel.playerDataArray.find((entry) => entry.playerId === change.modelChangeKey);
      if (data) data.playerCoordinate = null;
    }
  },
  [ModelChangeId.FIELD_MODEL_REMOVE_PLAYER_MARKER]: fieldModelRemove('playerMarkerArray'),
  // FieldModel.removePrayerEnhancements (FieldModel.java:466-469) -> Player.removeEnhancements(prayer), i.e.
  // drop the prayer's NAME key from all three temporary maps.
  [ModelChangeId.FIELD_MODEL_REMOVE_PRAYER]: (game, change) => {
    const meta: PrayerEnhancementMeta | undefined = BB2025_PRAYERS[String(change.modelChangeValue)];
    if (!meta) return playerEnhancementLog('prayerRemoved')(game, change);
    const player = getPlayerById(game, change.modelChangeKey);
    if (player) removeEnhancements(player, meta.name);
  },
  [ModelChangeId.FIELD_MODEL_REMOVE_PUSHBACK_SQUARE]: fieldModelRemove('pushbackSquareArray'),
  // FieldModel.removeSkillEnhancements (FieldModel.java:442-449) -> Player.removeEnhancements(sourceName).
  // The wire value is the enhancement SOURCE name, so this is what expires a Wisdom grant at end of
  // activation; removing an absent source is a no-op, exactly as the Java Map.remove is.
  [ModelChangeId.FIELD_MODEL_REMOVE_SKILL_ENHANCEMENTS]: (game, change) => {
    const player = getPlayerById(game, change.modelChangeKey);
    const source = change.modelChangeValue == null ? '' : String(change.modelChangeValue);
    if (player && source) removeEnhancements(player, source);
  },
  [ModelChangeId.FIELD_MODEL_REMOVE_TRACK_NUMBER]: fieldModelRemove('trackNumberArray'),
  [ModelChangeId.FIELD_MODEL_REMOVE_TRAP_DOOR]: fieldModelRemove('trapDoors'),
  [ModelChangeId.FIELD_MODEL_SET_BALL_COORDINATE]: fieldModelSetter('ballCoordinate'),
  [ModelChangeId.FIELD_MODEL_SET_BALL_IN_PLAY]: fieldModelSetter('ballInPlay'),
  [ModelChangeId.FIELD_MODEL_SET_BALL_MOVING]: fieldModelSetter('ballMoving'),
  // Upstream maps both BLITZ_STATE and TARGET_SELECTION_STATE to targetSelectionState.
  [ModelChangeId.FIELD_MODEL_SET_BLITZ_STATE]: fieldModelSetter('targetSelectionState'),
  [ModelChangeId.FIELD_MODEL_SET_TARGET_SELECTION_STATE]: fieldModelSetter('targetSelectionState'),
  [ModelChangeId.FIELD_MODEL_SET_BOMB_COORDINATE]: fieldModelSetter('bombCoordinate'),
  [ModelChangeId.FIELD_MODEL_SET_BOMB_MOVING]: fieldModelSetter('bombMoving'),
  [ModelChangeId.FIELD_MODEL_SET_OUT_OF_BOUNDS]: fieldModelSetter('outOfBounds'),
  [ModelChangeId.FIELD_MODEL_SET_PLAYER_COORDINATE]: (game, change) => {
    if (change.modelChangeKey)
      upsertPlayerData(game.fieldModel, change.modelChangeKey).playerCoordinate =
        change.modelChangeValue as PlayerDataJson['playerCoordinate'];
  },
  [ModelChangeId.FIELD_MODEL_SET_PLAYER_STATE]: (game, change) => {
    if (change.modelChangeKey)
      upsertPlayerData(game.fieldModel, change.modelChangeKey).playerState = change.modelChangeValue as number;
  },
  [ModelChangeId.FIELD_MODEL_SET_RANGE_RULER]: fieldModelSetter('rangeRuler'),
  [ModelChangeId.FIELD_MODEL_SET_WEATHER]: fieldModelSetter('weather'),
  [ModelChangeId.FIELD_MODEL_ADD_CHOMP]: (game, change) => {
    if (change.modelChangeKey && typeof change.modelChangeValue === 'string') {
      addToStringArray(game.fieldModel.chomped[change.modelChangeKey] ??= [], change.modelChangeValue);
    }
  },
  [ModelChangeId.FIELD_MODEL_REMOVE_CHOMP]: (game, change) => {
    if (change.modelChangeKey && typeof change.modelChangeValue === 'string') {
      const chompees = game.fieldModel.chomped[change.modelChangeKey];
      if (chompees) removeFromStringArray(chompees, change.modelChangeValue);
    }
  },

  [ModelChangeId.GAME_SET_ADMIN_MODE]: gameSetter('adminMode'),
  [ModelChangeId.GAME_SET_CONCEDED_LEGALLY]: gameSetter('concededLegally'),
  [ModelChangeId.GAME_SET_CONCESSION_POSSIBLE]: gameSetter('concessionPossible'),
  [ModelChangeId.GAME_SET_DEFENDER_ACTION]: gameSetter('defenderAction'),
  [ModelChangeId.GAME_SET_DEFENDER_ID]: gameKeySetter('defenderId'),
  [ModelChangeId.GAME_SET_DIALOG_PARAMETER]: gameSetter('dialogParameter'),
  [ModelChangeId.GAME_SET_FINISHED]: gameSetter('finished'),
  [ModelChangeId.GAME_SET_HALF]: gameSetter('half'),
  [ModelChangeId.GAME_SET_HOME_FIRST_OFFENSE]: gameSetter('homeFirstOffense'),
  [ModelChangeId.GAME_SET_HOME_PLAYING]: gameSetter('homePlaying'),
  [ModelChangeId.GAME_SET_ID]: gameSetter('gameId'),
  [ModelChangeId.GAME_SET_LAST_DEFENDER_ID]: gameKeySetter('lastDefenderId'),
  [ModelChangeId.GAME_SET_LAST_TURN_MODE]: gameSetter('lastTurnMode'),
  [ModelChangeId.GAME_SET_PASS_COORDINATE]: gameSetter('passCoordinate'),
  [ModelChangeId.GAME_SET_SCHEDULED]: gameSetter('scheduled'),
  [ModelChangeId.GAME_SET_SETUP_OFFENSE]: gameSetter('setupOffense'),
  [ModelChangeId.GAME_SET_STARTED]: gameSetter('started'),
  [ModelChangeId.GAME_SET_TESTING]: gameSetter('testing'),
  [ModelChangeId.GAME_SET_THROWER_ID]: gameKeySetter('throwerId'),
  [ModelChangeId.GAME_SET_THROWER_ACTION]: gameSetter('throwerAction'),
  [ModelChangeId.GAME_SET_TIMEOUT_ENFORCED]: gameSetter('timeoutEnforced'),
  [ModelChangeId.GAME_SET_TIMEOUT_POSSIBLE]: gameSetter('timeoutPossible'),
  [ModelChangeId.GAME_SET_TURN_MODE]: gameSetter('turnMode'),
  [ModelChangeId.GAME_SET_WAITING_FOR_OPPONENT]: gameSetter('waitingForOpponent'),

  [ModelChangeId.GAME_OPTIONS_ADD_OPTION]: (game, change) => {
    const option = change.modelChangeValue as { gameOptionId: string };
    const array = game.gameOptions.gameOptionArray;
    const index = array.findIndex((entry) => entry.gameOptionId === option.gameOptionId);
    if (index >= 0) array[index] = option as (typeof array)[number];
    else array.push(option as (typeof array)[number]);
  },

  [ModelChangeId.INDUCEMENT_SET_ACTIVATE_CARD]: (game, change) => {
    const set = getInducementSet(game, isHomeData(change));
    removeFromArray(set.cardsAvailable, change.modelChangeValue);
    set.cardsActive.push(change.modelChangeValue);
  },
  [ModelChangeId.INDUCEMENT_SET_ADD_AVAILABLE_CARD]: inducementArrayAdd('cardsAvailable'),
  [ModelChangeId.INDUCEMENT_SET_ADD_INDUCEMENT]: (game, change) => {
    // InducementSet.java:112-118 replaces by type; IJsonOption.java:249 names the wire key inducementType.
    const set = getInducementSet(game, isHomeData(change));
    const value = change.modelChangeValue as Record<string, unknown>;
    const index = set.inducementArray.findIndex(
      (entry) => (entry as Record<string, unknown>).inducementType === value.inducementType,
    );
    if (index >= 0) set.inducementArray[index] = value;
    else set.inducementArray.push(value);
  },
  [ModelChangeId.INDUCEMENT_SET_ADD_PRAYER]: inducementArrayAdd('prayers'),
  [ModelChangeId.INDUCEMENT_SET_CARD_CHOICES]: (game, change) => {
    if (game.dialogParameter && typeof game.dialogParameter === 'object') {
      (game.dialogParameter as Record<string, unknown>).cardChoices = change.modelChangeValue;
    }
  },
  [ModelChangeId.INDUCEMENT_SET_DEACTIVATE_CARD]: (game, change) => {
    const set = getInducementSet(game, isHomeData(change));
    removeFromArray(set.cardsActive, change.modelChangeValue);
    set.cardsDeactivated.push(change.modelChangeValue);
  },
  [ModelChangeId.INDUCEMENT_SET_REMOVE_AVAILABLE_CARD]: inducementArrayRemove('cardsAvailable'),
  [ModelChangeId.INDUCEMENT_SET_REMOVE_INDUCEMENT]: inducementArrayRemove('inducementArray'),
  [ModelChangeId.INDUCEMENT_SET_REMOVE_PRAYER]: inducementArrayRemove('prayers'),

  [ModelChangeId.PLAYER_MARK_SKILL_USED]: (game, change) => {
    const player = getPlayerById(game, change.modelChangeKey);
    if (player) addToStringArray(player.usedSkills, change.modelChangeValue as string);
  },
  [ModelChangeId.PLAYER_MARK_SKILL_UNUSED]: (game, change) => {
    const player = getPlayerById(game, change.modelChangeKey);
    if (player) removeFromStringArray(player.usedSkills, change.modelChangeValue as string);
  },

  [ModelChangeId.PLAYER_RESULT_SET_BLOCKS]: playerResultSetter('blocks'),
  [ModelChangeId.PLAYER_RESULT_SET_CASUALTIES]: playerResultSetter('casualties'),
  [ModelChangeId.PLAYER_RESULT_SET_CASUALTIES_WITH_ADDITIONAL_SPP]: playerResultSetter('casualtiesWithAdditionalSpp'),
  [ModelChangeId.PLAYER_RESULT_SET_CATCHES_WITH_ADDITIONAL_SPP]: playerResultSetter('catchesWithAdditionalSpp'),
  [ModelChangeId.PLAYER_RESULT_SET_COMPLETIONS]: playerResultSetter('completions'),
  [ModelChangeId.PLAYER_RESULT_SET_COMPLETIONS_WITH_ADDITIONAL_SPP]: playerResultSetter('completionsWithAdditionalSpp'),
  [ModelChangeId.PLAYER_RESULT_SET_CURRENT_SPPS]: playerResultSetter('currentSpps'),
  [ModelChangeId.PLAYER_RESULT_SET_DEFECTING]: playerResultSetter('defecting'),
  [ModelChangeId.PLAYER_RESULT_SET_FOULS]: playerResultSetter('fouls'),
  [ModelChangeId.PLAYER_RESULT_SET_HAS_USED_SECRET_WEAPON]: playerResultSetter('hasUsedSecretWeapon'),
  [ModelChangeId.PLAYER_RESULT_SET_INTERCEPTIONS]: playerResultSetter('interceptions'),
  [ModelChangeId.PLAYER_RESULT_SET_DEFLECTIONS]: playerResultSetter('deflections'),
  [ModelChangeId.PLAYER_RESULT_SET_LANDINGS]: playerResultSetter('landings'),
  [ModelChangeId.PLAYER_RESULT_SET_PASSING]: playerResultSetter('passing'),
  [ModelChangeId.PLAYER_RESULT_SET_PLAYER_AWARDS]: playerResultSetter('playerAwards'),
  [ModelChangeId.PLAYER_RESULT_SET_RUSHING]: playerResultSetter('rushing'),
  [ModelChangeId.PLAYER_RESULT_SET_SEND_TO_BOX_BY_PLAYER_ID]: playerResultSetter('sendToBoxByPlayerId'),
  [ModelChangeId.PLAYER_RESULT_SET_SEND_TO_BOX_HALF]: playerResultSetter('sendToBoxHalf'),
  [ModelChangeId.PLAYER_RESULT_SET_SEND_TO_BOX_REASON]: playerResultSetter('sendToBoxReason'),
  [ModelChangeId.PLAYER_RESULT_SET_SEND_TO_BOX_TURN]: playerResultSetter('sendToBoxTurn'),
  [ModelChangeId.PLAYER_RESULT_SET_SERIOUS_INJURY]: playerResultSetter('seriousInjury'),
  [ModelChangeId.PLAYER_RESULT_SET_SERIOUS_INJURY_DECAY]: playerResultSetter('seriousInjuryDecay'),
  [ModelChangeId.PLAYER_RESULT_SET_TOUCHDOWNS]: playerResultSetter('touchdowns'),
  [ModelChangeId.PLAYER_RESULT_SET_TURNS_PLAYED]: playerResultSetter('turnsPlayed'),

  [ModelChangeId.SKETCH_UPDATE]: (game, change) => {
    game.sketchState = change.modelChangeValue;
  },
  [ModelChangeId.TARGET_SELECTION_COMMITTED]: (game) => {
    const state = game.fieldModel.targetSelectionState as Record<string, unknown> | undefined;
    if (state) state.targetSelectionStatusIsCommitted = true;
  },

  [ModelChangeId.TEAM_RESULT_SET_CONCEDED]: teamResultSetter('conceded'),
  [ModelChangeId.TEAM_RESULT_SET_DEDICATED_FANS_MODIFIER]: teamResultSetter('dedicatedFans'),
  [ModelChangeId.TEAM_RESULT_SET_FAME]: teamResultSetter('fame'),
  [ModelChangeId.TEAM_RESULT_SET_FAN_FACTOR]: teamResultSetter('fanFactor'),
  [ModelChangeId.TEAM_RESULT_SET_BADLY_HURT_SUFFERED]: teamResultSetter('badlyHurtSuffered'),
  [ModelChangeId.TEAM_RESULT_SET_FAN_FACTOR_MODIFIER]: teamResultSetter('fanFactorModifier'),
  [ModelChangeId.TEAM_RESULT_SET_PENALTY_SCORE]: teamResultSetter('penaltyScore'),
  [ModelChangeId.TEAM_RESULT_SET_PETTY_CASH_TRANSFERRED]: teamResultSetter('pettyCashTransferred'),
  [ModelChangeId.TEAM_RESULT_SET_PETTY_CASH_USED]: teamResultSetter('pettyCashUsed'),
  [ModelChangeId.TEAM_RESULT_SET_RAISED_DEAD]: teamResultSetter('raisedDead'),
  [ModelChangeId.TEAM_RESULT_SET_RIP_SUFFERED]: teamResultSetter('ripSuffered'),
  [ModelChangeId.TEAM_RESULT_SET_SCORE]: teamResultSetter('score'),
  [ModelChangeId.TEAM_RESULT_SET_SERIOUS_INJURY_SUFFERED]: teamResultSetter('seriousInjurySuffered'),
  [ModelChangeId.TEAM_RESULT_SET_SPECTATORS]: teamResultSetter('spectators'),
  [ModelChangeId.TEAM_RESULT_SET_SPIRALLING_EXPENSES]: teamResultSetter('spirallingExpenses'),
  [ModelChangeId.TEAM_RESULT_SET_TEAM_VALUE]: teamResultSetter('teamValue'),
  [ModelChangeId.TEAM_RESULT_SET_WINNINGS]: teamResultSetter('winnings'),

  [ModelChangeId.TURN_DATA_SET_APOTHECARIES]: turnDataSetter('apothecaries'),
  [ModelChangeId.TURN_DATA_SET_BLITZ_USED]: turnDataSetter('blitzUsed'),
  [ModelChangeId.TURN_DATA_SET_BOMB_USED]: turnDataSetter('bombUsed'),
  [ModelChangeId.TURN_DATA_SET_FIRST_TURN_AFTER_KICKOFF]: turnDataSetter('firstTurnAfterKickoff'),
  [ModelChangeId.TURN_DATA_SET_FOUL_USED]: turnDataSetter('foulUsed'),
  [ModelChangeId.TURN_DATA_SET_HAND_OVER_USED]: turnDataSetter('handOverUsed'),
  [ModelChangeId.TURN_DATA_SET_LEADER_STATE]: turnDataSetter('leaderState'),
  [ModelChangeId.TURN_DATA_SET_PASS_USED]: turnDataSetter('passUsed'),
  [ModelChangeId.TURN_DATA_SET_PLAGUE_DOCTORS]: turnDataSetter('plagueDoctors'),
  [ModelChangeId.TURN_DATA_SET_TTM_USED]: turnDataSetter('ttmUsed'),
  [ModelChangeId.TURN_DATA_SET_KTM_USED]: turnDataSetter('ktmUsed'),
  [ModelChangeId.TURN_DATA_SET_SECURE_THE_BALL_USED]: turnDataSetter('secureTheBallUsed'),
  [ModelChangeId.TURN_DATA_SET_PUNT_USED]: turnDataSetter('puntUsed'),
  [ModelChangeId.TURN_DATA_SET_RE_ROLLS]: turnDataSetter('reRolls'),
  [ModelChangeId.TURN_DATA_SET_RE_ROLLS_BRILLIANT_COACHING_ONE_DRIVE]: turnDataSetter('rerollBrilliantCoachingOneDrive'),
  [ModelChangeId.TURN_DATA_SET_RE_ROLLS_PUMP_UP_THE_CROWD_ONE_DRIVE]: turnDataSetter('rerollPumpUpTheCrowdOneDrive'),
  [ModelChangeId.TURN_DATA_SET_RE_ROLLS_SHOW_STAR_ONE_DRIVE]: turnDataSetter('rerollShowStarOneDrive'),
  [ModelChangeId.TURN_DATA_SET_RE_ROLLS_SINGLE_USE]: turnDataSetter('singleUseReRolls'),
  [ModelChangeId.TURN_DATA_SET_RE_ROLL_USED]: turnDataSetter('reRollUsed'),
  [ModelChangeId.TURN_DATA_SET_TURN_NR]: turnDataSetter('turnNr'),
  [ModelChangeId.TURN_DATA_SET_TURN_STARTED]: turnDataSetter('turnStarted'),
  [ModelChangeId.TURN_DATA_SET_WANDERING_APOTHECARIES]: turnDataSetter('wanderingApothecaries'),
  [ModelChangeId.TURN_DATA_SET_COACH_BANNED]: turnDataSetter('coachBanned'),
  [ModelChangeId.TURN_DATA_SET_CHEERING_FANS_BLOCK_ASSIST]: turnDataSetter('cheeringFansBlockAssist'),
};

export interface ApplyResult {
  applied: number;
  unknown: string[];
}

export function applyModelChange(game: GameJson, change: ModelChangeJson): boolean {
  const handler = handlers[change.modelChangeId];
  if (!handler) return false;
  handler(game, change);
  return true;
}

export function applyModelChangeList(game: GameJson, list: ModelChangeListJson | undefined | null): ApplyResult {
  const result: ApplyResult = { applied: 0, unknown: [] };
  if (!list?.modelChangeArray) return result;
  for (const change of list.modelChangeArray) {
    if (applyModelChange(game, change)) result.applied++;
    else result.unknown.push(change.modelChangeId);
  }
  return result;
}

/** All wire ids with a handler — used by coverage tests. */
export function handledModelChangeIds(): string[] {
  return Object.keys(handlers);
}
