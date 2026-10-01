/** The button label for a `useInducement` type id (camelCase on the wire: `wizard`, `throwARock`, `riotousRookies`).
 *  Owner 10-01: `throwARock` read "Throw ARock" — a single-letter word inside the id had no boundary. Words split at
 *  lower→upper AND at an upper followed by an upper+lower pair, so it reads "Throw A Rock". */
export function inducementChoiceLabel(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .replace(/^./, (character) => character.toUpperCase())
    .replace(/\s+/g, ' ')
    .trim();
}
