export { KICK_ARC_GATE_CAP_MS, KICK_ARC_LONGEST_LEGIT_MS, KICK_FLYIN_MS, KICKOFF_CINE_MS, PUNT_BALL_ARC_MS, TTM_THROW_MS, activePlayerAuraVisible, ballThrowArcMs, isServerKickoffScatterTransition, kickArcGateCapMs, kickArcLongestLegitMs, setFumbblPitchFallbacks, staticSelectionHaloVisible, PitchRenderer, type ActionMode, type BoardPresentationFence, type ContextTarget, type MovementPresentationFence, type MovementPresentationRecovery, type PassDestinationKind, type ServerKickoffScatterOccurrence } from './renderer';
export { blockDicePreview, type BlockPreview } from './blocks';
export { BlockPipeline, PIPELINE_TIMINGS, BEAT_MS, HALF_BEAT_MS, type StageSpec, type PipelineTier, type PipelineHooks } from './blockPipeline';
export { bundledFumbblAsset, cachedBundledFumbblAsset, knockdownFrameInfo, loadIconsetManifest, loadShadowlessManifest, setClassicIconTextureResolver, setClassicIconUrlRewriter } from './classicIcons';
export type { ClassicIconTextureSource } from './classicIcons';
export {
  activateAssetPresentationPack,
  activateSkillIconPack,
  assetPresentationCacheStats,
  canonicalSkillIconKey,
  generatedSkillIconUrl,
  skillBadgePresentation,
  playerSprite,
  playerSpriteAsset,
  playerSpriteUrl,
  skillIconUrl,
  skillIconLarge,
  activeBundledSkillBadgeFamily,
  setBundledSkillBadgeFamily,
  supersedeAssetPresentationIntent,
  waitForAssetPresentationRetirement,
  type AssetPresentationSnapshot,
  type AssetSide,
  type BundledSkillBadgeFamily,
  type PlayerSpriteBinding,
  type SkillIconBinding,
  type SkillIconContext,
  type SkillIconPackSnapshot,
  type SkillBadgePresentation,
  type SkillIconStyle,
} from './skillIcons';
export * from './actions';
export * from './geometry';
export * from './movement';
export * from './passing';
export * from './playerState';
export * from './apothecaryBox';
export { rushTargetForPlayer } from './rushTarget';
export { RING_TYPE_COLORS, ringTypeForName, type RingType } from './positionTypes';
export {
  DEFAULT_D6_FACE_VARIANT,
  D6_FACE_VALUES,
  D6_FACE_VARIANTS,
  d6FaceUrl,
  d6FaceVisualScale,
  isD6FaceValue,
  type D6FaceValue,
  type D6FaceVariant,
} from './d6';
export { presentationMs, setPresentationMode, SPECTATOR_PACING_FACTOR, type PresentationMode } from './presentationTiming';
export { SPIKE_CURSOR, SPIKE_CURSOR_HOTSPOT, SPIKE_CURSOR_PRIMED } from './cursors';
export * from './setup';
export * from './setupTemplates';
export * from './walkers';
export * from './bundledWalk';
export { renderStadiumPack, validateStadiumPack, modelToSquare, stadiumFootprint, planImageCorners, type StadiumPackManifest, type RenderedStadium, type PlanCorners } from './stadiumModel';
export { bundledStadiumPacks, type BundledStadiumPack } from './bundledStadium';
/** Keep the 3D dice controller and Three.js in lazy chunks. */
export const loadBlockDice3d = () => import('./blockDice3d');
export type { BlockDiceRow } from './blockDice3d';
