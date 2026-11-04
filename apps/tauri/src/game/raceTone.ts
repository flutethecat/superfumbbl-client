// Vendored from the League Manager (bb-tournament-validator de887cb9, apps/config-web/spa/src/shared/raceTone.ts),
// copied verbatim below this note; sync with tools/sync-lm-ui.mjs. Owner 11-03 (lane 3): the race colour table is the
// source of the Modern result-card tints (game/teamTone.ts). It is a DATA table of raw colours, exempt from the
// stylesheet token rule, as in the League Manager.
// Result-card tint (owner 10-30, after TourPlay's results view): each side of a card fades in a colour for its team.
// No team colours are stored anywhere yet, so a small race -> colour map stands in; unknown races get a dark fallback.

export const RACE_TONE_FALLBACK = "#3a4150";

const TONES: Record<string, string> = {
  amazon: "#2f9e6e",
  blackorc: "#3d4a2a",
  bretonnian: "#3b6fd1",
  chaoschosen: "#a8322d",
  chaosdwarf: "#8a3b1f",
  chaosrenegade: "#7a2f5e",
  darkelf: "#5b2a86",
  dwarf: "#b7862c",
  elvenunion: "#2f8fbf",
  gnome: "#6a9b3a",
  goblin: "#5e8f2e",
  halfling: "#c9792b",
  highelf: "#d7b740",
  human: "#2f5fb3",
  imperialnobility: "#7d2a3a",
  khorne: "#9e1f1f",
  lizardmen: "#1f8a6b",
  necromantichorror: "#4b5e6e",
  norse: "#4f7ea8",
  nurgle: "#6f7d2a",
  ogre: "#9a6b3c",
  oldworldalliance: "#8a6d3b",
  orc: "#4c7d2b",
  shamblingundead: "#5a6b5a",
  skaven: "#6d5a3b",
  slann: "#2a8f9a",
  snotling: "#7da33a",
  tombkings: "#c2a050",
  underworlddenizens: "#5a7a2a",
  vampire: "#7a1f3a",
  woodelf: "#3f8a3a",
};

const key = (race: unknown): string => String(race ?? "").toLowerCase().replace(/[^a-z]/g, "");

/** The card colour for a race ("Wood Elf", "wood_elf" and "WOODELF" agree), or the dark fallback. */
export function raceTone(race: unknown): string {
  const k = key(race);
  if (!k) return RACE_TONE_FALLBACK;
  if (TONES[k]) return TONES[k];
  // "Chaos Chosen Team", "Orc (BB2025)": the longest known race the name starts with.
  const hit = Object.keys(TONES).filter((name) => k.startsWith(name)).sort((a, b) => b.length - a.length)[0];
  return hit ? TONES[hit]! : RACE_TONE_FALLBACK;
}
