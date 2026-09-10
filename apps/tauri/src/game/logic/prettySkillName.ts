/** #214 (owner-fg 07-29, #208 identifier-leak class) — friendly DISPLAY label for a RAW skill token.
 *  Extracted PURE (Echo item-① ruling 08-03, extract-and-SHARE) so the ffb-protocol rig can pin the invariant
 *  without reaching into the store (the #185 boundary is copy-vs-share; this is share — ONE definition, store +
 *  rig both import it).
 *
 *  Invariant the rig tooth pins: the output contains no `com.fumbbl` / no `.`; a lowercase leaf is Title-Cased;
 *  a PascalCase / already-spaced label is untouched.
 *
 *  Steps: strip a fully-qualified class (`com.fumbbl.ffb.skill.bb2025.Dauntless`) to its leaf, replace `_`/`$`
 *  with spaces + split CamelCase, then Title-Case each word's LEADING lowercase letter (`dauntless` → "Dauntless";
 *  "Foul Appearance" untouched — the regex matches `[a-z]` leaders only).
 *
 *  ⚠ DISPLAY-ONLY. Raw tokens that are ALSO match-keys or wire values (the reroll option-match `source`,
 *  `skillChoice.skill`, and the wire `reRollSource`) MUST stay raw at their sites — never route those through here. */
export function prettySkillName(raw: string): string {
  const leaf = raw.includes('.') ? raw.slice(raw.lastIndexOf('.') + 1) : raw;
  const spaced = leaf.replace(/[_$]/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim();
  const titled = spaced.replace(/(^|\s)([a-z])/g, (_m, sp: string, c: string) => sp + c.toUpperCase());
  return titled || raw;
}
