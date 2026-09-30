export const MAX_PATCH_FILES: number;
export const MAX_PART_BYTES: number;
export const MAX_MANIFEST_BYTES: number;
export function validPatchPath(path: unknown): boolean;
export function validPatchName(name: unknown): boolean;
export function validPatchGroup(group: unknown): boolean;
export function validBareVersion(v: unknown): boolean;
export function manifestProblems(m: unknown): string[];
export function assertValidManifest(m: unknown): void;
