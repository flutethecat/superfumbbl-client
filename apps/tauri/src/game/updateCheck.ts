/** Owner 09-23: "add a version check to the client — open a page with the GH release when an update is needed."
 *  Pure helpers: the App asks GitHub for the latest public release and compares it with the running version.
 *  Dev cuts (a letter after X.Y.Z) never prompt — they are ahead of the published line by construction. */
export const PUBLIC_RELEASES_REPO = 'flutethecat/superfumbbl-client';
export const LATEST_RELEASE_API = `https://api.github.com/repos/${PUBLIC_RELEASES_REPO}/releases/latest`;

export interface LatestRelease { version: string; url: string }

/** "v1.0.21" | "1.0.21" → [1, 0, 21]; anything else → null. */
export function parseVersion(text: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(text.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** The running build is a dev cut when a letter follows the bare version ("1.0.20o66kj", "0.2.8d"). */
export function isDevCut(appVersion: string): boolean {
  return /^\d+\.\d+\.\d+[A-Za-z]/.test(appVersion.trim());
}

export function updateAvailable(appVersion: string, latestTag: string): boolean {
  if (isDevCut(appVersion)) return false;
  const cur = parseVersion(appVersion), latest = parseVersion(latestTag);
  if (!cur || !latest) return false;
  for (let i = 0; i < 3; i++) { if (latest[i]! !== cur[i]!) return latest[i]! > cur[i]!; }
  return false;
}

/** Reads GitHub's "latest release" (published, non-draft, non-prerelease). Returns null on any failure. */
export async function fetchLatestRelease(fetchFn: (url: string, init?: RequestInit) => Promise<Response>): Promise<LatestRelease | null> {
  try {
    const res = await fetchFn(LATEST_RELEASE_API, { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) return null;
    const data = (await res.json()) as { tag_name?: unknown; html_url?: unknown };
    const tag = typeof data.tag_name === 'string' ? data.tag_name : '';
    const url = typeof data.html_url === 'string' ? data.html_url : '';
    return parseVersion(tag) && url ? { version: tag.replace(/^v/, ''), url } : null;
  } catch { return null; }
}
