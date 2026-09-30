export interface AppPatchFile { path: string; name: string; size: number }
export interface AppPatchPart { group: string; hash: string; size: number; sha256: string; url: string; files: AppPatchFile[] }
export interface AppPatchManifest { version: string; edition: 'public'; shell: { min: string }; notes?: string; parts: AppPatchPart[] }
export const MAX_PATCH_FILES: number;
export function validPatchPath(path: string): boolean;
export function validPatchName(name: string): boolean;
export function appPatchGroup(rel: string, originGroup?: string | null): string;
export function appPatchPartUrl(publicRepo: string, version: string, group: string, hash: string): string;
export function listDist(distDir: string): string[];
export function readOriginGroups(outDir: string): Record<string, string>;
export function assertPatchable(input: { edition: string; consoleHits: string[]; assetPack: { split?: boolean } | null }): void;
export function buildAppPatch(input: {
  distDir: string; outDir: string; lockFile: string; version: string; publicRepo: string; shellMin: string;
  originGroups: Record<string, string>;
}): AppPatchManifest;
