// The art of the applied block RESULT on the pitch: the stamp that pops over the affected token(s) and the face that
// replaces the blocked player's fist (SpectateView -> PitchRenderer.playBlockResultStamp / setAppliedBlockResult).
// Report Fesz g1951899 (10-10): the block choice card drew the coach's pack-bound Pow / Push faces, the pitch drew
// the bundled ones. The card reads PitchRenderer.blockFaceUrls() (pack binding first, then the bundled family); the
// stamp only ever chose between the two bundled families. Both now read the pack layer through the same accessor
// (PitchRenderer.packBlockFaceUrl); only the bundled fallback differs, on purpose: the stamp is a plain symbol
// (owner 10-04: no die tile), so the block die SURFACE (plate) never applies to it.
export type BlockResultStampSymbol = 'attacker-down' | 'both-down' | 'push' | 'defender-stumbles' | 'pow';

/** Result symbol -> face index in tumble order [skull, bothdown, push, powpush, pow]. */
export const BLOCK_STAMP_FACE_INDEX: Readonly<Record<string, number>> = { 'attacker-down': 0, 'both-down': 1, push: 2, 'defender-stumbles': 3, pow: 4 };

export interface BlockStampArtSources {
  /** The pack-bound face for a tumble index (the user-files pack, else the assigned block-dice pack); null = none. */
  packFaceUrl(faceIndex: number): string | null;
  family: 'default' | 'krisb' | 'fumbbl';
  /** KrisB's original (plate-less) faces in tumble order. */
  krisbFaceUrls(): readonly string[];
  /** Owner 11-04: the FUMBBL dice's plate-less symbols (their glyphs: the die tile knocked out) in tumble order. */
  fumbblFaceUrls(): readonly string[];
  /** The Super FUMBBL plain result symbols, by symbol. */
  plainSymbolUrls: Readonly<Record<string, string>>;
}

/** The bundled (no pack) stamp art of a symbol: KrisB's plate-less face, the FUMBBL glyph, else the plain Super
 *  FUMBBL symbol. */
export function bundledBlockStampUrl(symbol: string, sources: BlockStampArtSources): string | null {
  const index = BLOCK_STAMP_FACE_INDEX[symbol];
  if (index === undefined) return null;
  if (sources.family === 'krisb') return sources.krisbFaceUrls()[index] ?? null;
  if (sources.family === 'fumbbl') return sources.fumbblFaceUrls()[index] ?? null;
  return sources.plainSymbolUrls[symbol] ?? null;
}

/** The stamp art of a symbol: the pack-bound face when one is bound (what the choice card shows), else the bundled
 *  art. `fallbackUrl` is the bundled art when `url` is a pack face (a pack image that fails to load on the pitch). */
export function resolveBlockStampArt(symbol: string, sources: BlockStampArtSources): { url: string; fallbackUrl: string | null } | null {
  const index = BLOCK_STAMP_FACE_INDEX[symbol];
  if (index === undefined) return null;
  const bundled = bundledBlockStampUrl(symbol, sources);
  const pack = sources.packFaceUrl(index);
  if (pack) return { url: pack, fallbackUrl: bundled };
  return bundled ? { url: bundled, fallbackUrl: null } : null;
}
