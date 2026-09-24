import { Assets, ExtensionType, ImageSource, Texture, type LoaderParser } from 'pixi.js';

/**
 * Owner 09-23/24: the ART PACK. The public installer no longer carries the walk sprite sheets (≈200 MB); the
 * client downloads them once into app-data and re-downloads only the parts that changed. Every bundled art URL
 * keeps its build-time string (`/assets/<name>-<hash>.png`, root-relative or absolute) — nothing at the call
 * sites changes. A Pixi LoaderParser recognises those basenames and decodes the bytes the host hands it
 * (Tauri IPC read of the on-disk file), so no asset-protocol URL, no cross-origin fetch, no worker fetch is
 * involved (live 09-24: that path silently fell back to default sprites). Loads that start before the pack is
 * ready simply wait for it. Without an installed pack (dev server, fork edition) everything resolves as before.
 */
export interface ArtPackFileRef { group: string; name: string }
export interface ArtPackSource {
  /** basename → where the bytes live */
  files: Record<string, ArtPackFileRef>;
  /** resolves once every file in `files` is on disk (downloads finished) */
  ready: Promise<void>;
  /** the bytes of one file */
  read(ref: ArtPackFileRef): Promise<Uint8Array>;
}

let source: ArtPackSource | null = null;
let parserInstalled = false;
const blobUrls = new Map<string, Promise<string>>();

function basename(url: string): string {
  const q = url.indexOf('?');
  const clean = q >= 0 ? url.slice(0, q) : url;
  return clean.slice(clean.lastIndexOf('/') + 1);
}

function packRef(url: string): ArtPackFileRef | null {
  if (!source) return null;
  return source.files[basename(url)] ?? null;
}

function mime(name: string): string {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  return ext === 'webp' ? 'image/webp' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png';
}

async function readBytes(ref: ArtPackFileRef): Promise<Uint8Array> {
  if (!source) throw new Error('art pack not installed');
  await source.ready;
  return source.read(ref);
}

/** The parser: high priority so it wins over loadTextures for pack files; other URLs fall through untouched. */
const artPackParser: LoaderParser<Texture> = {
  id: 'super-fumbbl-art-pack',
  name: 'super-fumbbl-art-pack',
  extension: { type: ExtensionType.LoadParser, priority: 2 /* LoaderParserPriority.High */, name: 'super-fumbbl-art-pack' },
  test: (url) => !!packRef(url),
  async load(url) {
    const ref = packRef(url);
    if (!ref) throw new Error(`art pack: ${url} is not a pack file`);
    const bytes = await readBytes(ref);
    const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: mime(ref.name) }), { premultiplyAlpha: 'none' });
    const texture = new Texture({ source: new ImageSource({ resource: bitmap, alphaMode: 'premultiply-alpha-on-upload', label: url }) });
    return texture;
  },
  unload(texture) { texture.destroy(true); },
};

/** Register the pack. Call as soon as the manifest is known (before the download finishes) so early loads wait. */
export function installArtPack(next: ArtPackSource): void {
  source = next;
  blobUrls.clear();
  if (!parserInstalled) {
    Assets.loader.parsers.push(artPackParser);
    parserInstalled = true;
  }
}

/** Live 09-24 (second run): every sheet load pins `parser: 'loadTextures'`, and a pinned parser skips `test()` —
 *  so the pack parser never ran. Call sites that pin a parser pick it through here instead. */
export const ART_PACK_PARSER = 'super-fumbbl-art-pack';
export function textureParserFor(url: string): string { return packRef(url) ? ART_PACK_PARSER : 'loadTextures'; }

/** Whether this URL names a file the pack serves. */
export function artPackHas(url: string): boolean { return !!packRef(url); }

/** True when a pack source is registered (bundled art is being served from the pack). */
export function artPackActive(): boolean { return !!source && Object.keys(source.files).length > 0; }

/** Kept for call sites that only need a URL string: the pack does not change URLs, so this is the identity. */
export function artUrl(url: string): string { return url; }

/** For non-Pixi consumers (<img>): a blob: URL of the pack bytes, or the URL itself when it is not a pack file. */
export function artBlobUrl(url: string): Promise<string> {
  const ref = packRef(url);
  if (!ref) return Promise.resolve(url);
  let p = blobUrls.get(ref.name);
  if (!p) {
    p = readBytes(ref).then((bytes) => URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime(ref.name) })));
    blobUrls.set(ref.name, p);
  }
  return p;
}

/** Test seam. */
export function resetArtPackForTests(): void {
  source = null;
  blobUrls.clear();
  const i = Assets.loader.parsers.indexOf(artPackParser);
  if (i >= 0) Assets.loader.parsers.splice(i, 1);
  parserInstalled = false;
}
