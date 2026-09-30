export interface PartFile { name: string; bytes: Uint8Array }
export interface ArtPackLockEntry { url: string; size?: number; sha256?: string }
export function partHash(files: PartFile[]): string;
export const ART_PACK_ZIP_MTIME: Date;
export function zipPart(files: PartFile[]): Uint8Array;
export function readArtPackLock(file: string): Record<string, ArtPackLockEntry>;
