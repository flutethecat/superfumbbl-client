// The build EDITION, read from apps/tauri/edition.json — the one reader for vite.config.ts and the build guards.
// Fail closed (owner 09-29 review): the RAW TEXT must match one grammar, identical to src-tauri/edition_grammar.rs
// (the Rust build script), checked against the same vectors (test/edition-vectors.txt):
//   `{` `"edition"` `:` `"public"` or `"fork"` `}`, with optional ASCII whitespace (space, tab, CR, LF) around and
//   between the tokens. No BOM, other keys, escapes, comments, trailing comma, nesting, duplicate keys or trailing
//   text. Anything else throws; there is no default, so a damaged file can never silently build the private edition
//   (which carries private dev tooling) into a public installer. JSON.parse is deliberately not used for acceptance.
import { readFileSync } from 'node:fs';

const W = '[ \\t\\r\\n]*';
const EDITION_FILE = new RegExp(`^${W}\\{${W}"edition"${W}:${W}"(public|fork)"${W}\\}${W}$`);

/** Validate the raw text of edition.json. `file` is only for the error message. */
export function parseEdition(text, file = 'edition.json') {
  const m = typeof text === 'string' ? EDITION_FILE.exec(text) : null;
  if (!m) {
    throw new Error(`${file}: must be exactly { "edition": "public" } or { "edition": "fork" } (ASCII whitespace allowed) — got ${JSON.stringify(typeof text === 'string' ? text.slice(0, 80) : text)}`);
  }
  return m[1];
}

/** Read and validate the edition file (a path or file URL). */
export function readEdition(file) {
  let text;
  try { text = readFileSync(file, 'utf8'); } catch (e) { throw new Error(`${String(file)}: cannot read the edition file (${e instanceof Error ? e.message : e})`); }
  return parseEdition(text, String(file));
}
