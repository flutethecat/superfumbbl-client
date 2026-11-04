import type { Locale } from './state';

/**
 * English (US) + English (UK) (owner 11-03). `en` (en.json) is English (US), American spelling throughout, and the base
 * every other locale falls back to. `en-GB` (en-GB.json) is an OVERLAY holding only the strings whose British spelling
 * differs; every other key falls back to the US text.
 *
 * Which English a system language tag means:
 *  - an English tag whose region is in UK_ENGLISH_REGIONS -> `en-GB`;
 *  - any other English tag (`en`, `en-US`, `en-CA`, `en-PH`, `en-PR` ...) -> `en` (US);
 *  - a non-English tag -> null (not an English preference).
 *
 * UK_ENGLISH_REGIONS is derived from Unicode CLDR 48 (cldr-json 48.0.0, supplemental/parentLocales.json): every
 * `en-<region>` locale whose parent chain reaches `en-001` (directly, or through `en-150`, English for Europe) - the
 * British-style "international English" group en-GB belongs to - plus `001` and `150` themselves. English locales
 * with no parent entry inherit `en` (US English): en-US and its US-inheriting regions (AS, GU, MP, PR, UM, VI), and
 * Canada (CLDR 48 gives en-CA no parent locale, so it stays US). Regenerate the list from a newer CLDR release by the
 * same rule; do not hand-edit it.
 */
// CLDR 48 parentLocales: en-<region> -> ... -> en-001 (110 regions incl. 150), plus 001.
export const UK_ENGLISH_REGIONS: ReadonlySet<string> = new Set([
  '001', '150',
  'AG', 'AI', 'AT', 'AU', 'BB', 'BE', 'BM', 'BS', 'BW', 'BZ', 'CC', 'CH', 'CK', 'CM', 'CX', 'CY', 'CZ', 'DE', 'DG',
  'DK', 'DM', 'EE', 'ER', 'ES', 'FI', 'FJ', 'FK', 'FM', 'FR', 'GB', 'GD', 'GE', 'GG', 'GH', 'GI', 'GM', 'GS', 'GY',
  'HK', 'HU', 'ID', 'IE', 'IL', 'IM', 'IN', 'IO', 'IT', 'JE', 'JM', 'KE', 'KI', 'KN', 'KY', 'LC', 'LR', 'LS', 'LT',
  'LV', 'MG', 'MO', 'MS', 'MT', 'MU', 'MV', 'MW', 'MY', 'NA', 'NF', 'NG', 'NL', 'NO', 'NR', 'NU', 'NZ', 'PG', 'PK',
  'PL', 'PN', 'PT', 'PW', 'RO', 'RW', 'SB', 'SC', 'SD', 'SE', 'SG', 'SH', 'SI', 'SK', 'SL', 'SS', 'SX', 'SZ', 'TC',
  'TK', 'TO', 'TT', 'TV', 'TZ', 'UA', 'UG', 'VC', 'VG', 'VU', 'WS', 'ZA', 'ZM', 'ZW',
  'UK', // not an ISO region, but a common mistyped tag for Britain (en-UK)
]);

/** The English variant a single language tag asks for, or null when the tag is not English. */
export function englishVariantOf(tag: string | null | undefined): Extract<Locale, 'en' | 'en-GB'> | null {
  if (typeof tag !== 'string') return null;
  const parts = tag.trim().replace(/_/g, '-').split('-').filter(Boolean);
  if (parts[0]?.toLowerCase() !== 'en') return null;
  // The region is the first 2-letter or 3-digit subtag after the language (a 4-letter script subtag may come between).
  const region = parts.slice(1).find((p) => /^[A-Za-z]{2}$|^\d{3}$/.test(p));
  return region && UK_ENGLISH_REGIONS.has(region.toUpperCase()) ? 'en-GB' : 'en';
}

/** The English variant a list of preferred tags asks for: the FIRST English tag decides; none -> US (`en`). */
export function englishVariantFor(tags: readonly (string | null | undefined)[]): Extract<Locale, 'en' | 'en-GB'> {
  for (const tag of tags) {
    const variant = englishVariantOf(tag);
    if (variant) return variant;
  }
  return 'en';
}

/** The browser's preferred language tags (navigator.languages, then navigator.language); [] without a navigator. */
export function systemLanguageTags(): string[] {
  try {
    const nav = (globalThis as { navigator?: { languages?: readonly string[]; language?: string } }).navigator;
    if (!nav) return [];
    return [...(nav.languages ?? []), ...(nav.language ? [nav.language] : [])];
  } catch {
    return [];
  }
}

/**
 * Existing-user mapping (owner 11-03). A settings blob saved before English split into US / UK stored `en` for
 * "English". On the first load after the split that stored `en` becomes `en-GB` when the system's first English
 * preference is a UK-family one (englishVariantFor), and stays `en` (US) otherwise. It runs ONCE per install
 * (settings.englishVariantSettled), so a later explicit pick of English (US) is never re-mapped. Any other stored
 * language is untouched.
 */
export function mapLegacyEnglish(stored: Locale, tags: readonly (string | null | undefined)[]): Locale {
  return stored === 'en' ? englishVariantFor(tags) : stored;
}
