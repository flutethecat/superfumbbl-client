/**
 * Owner 11-12: "add a search function to the settings menu so folks can immediately find what they're looking for".
 * Pure matching over the Settings search index (./settingsSearchIndex.ts); the box and list are
 * components/settings/SettingsSearch.vue, and App.vue only wires them (gates, tab switch, reveal).
 *
 * Matching: every word of the query must appear somewhere in the setting's name, help text, section or tab name - in
 * the current display language, and (when that is not English) in the English text too, so a coach can type what a
 * guide calls it. Case- and accent-insensitive; a word matches inside a longer word ("zon" finds "tackle zones").
 */
import { currentLocale, t, tEnglish } from '../i18n';
import { SETTINGS_SECTIONS, type SettingsTab } from './settingsDialog';
import { SETTINGS_SEARCH_INDEX, type SettingsSearchEntry } from './settingsSearchIndex';

/** Expression (an entry's `when`) -> is it true right now. Built by App.vue from the same state its template reads. */
export type SettingsSearchGates = Readonly<Record<string, () => boolean>>;

export type SettingsSearchField = 'label' | 'group' | 'tab' | 'info';

export interface SettingsSearchExcerpt {
  readonly text: string;
  /** The matched word inside `text` ([start, end)). */
  readonly hitStart: number;
  readonly hitEnd: number;
}

export interface SettingsSearchResult {
  readonly entry: SettingsSearchEntry;
  readonly label: string;
  readonly tabLabel: string;
  readonly groupLabel: string | null;
  /** Part of the help text, only when the help text is what matched (the name alone did not). */
  readonly excerpt: SettingsSearchExcerpt | null;
}

/** Letters NFD does not take apart. */
const FOLD: Readonly<Record<string, string>> = { 'ß': 'ss', 'æ': 'ae', 'œ': 'oe', 'ø': 'o', 'ł': 'l', 'đ': 'd', 'ð': 'd', 'þ': 'th', 'ı': 'i', 'ħ': 'h' };

/** Lower-case, accents removed, punctuation dropped, whitespace kept. `map[i]` = the index in `text` that produced
 *  folded character i (for excerpts). */
export function foldText(text: string): { folded: string; map: number[] } {
  let folded = '';
  const map: number[] = [];
  let index = 0;
  for (const ch of text) {
    const lower = ch.toLowerCase();
    const base = FOLD[lower] ?? lower.normalize('NFD').replace(/\p{M}/gu, '');
    for (const c of base) {
      if (/\s/u.test(c)) { folded += ' '; map.push(index); }
      else if (/[\p{L}\p{N}]/u.test(c)) { folded += c; map.push(index); }
    }
    index += ch.length;
  }
  return { folded, map };
}

/** Scripts written without spaces between words. */
const NO_SPACE_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;
type WordSegmenter = { segment(text: string): Iterable<{ segment: string; isWordLike?: boolean }> };
type SegmenterClass = new (locale: string, options: { granularity: 'word' }) => WordSegmenter;

/** Split one space-free run of a no-space script into words (Intl.Segmenter); without a segmenter, into single
 *  characters of that script (each must then appear somewhere, which still finds "球场线条宽度"), keeping a Latin /
 *  Cyrillic / digit run inside it whole. Other words are left whole. Splitting
 *  only ever loosens a match: every part is a substring of the run. */
function segmentWord(word: string, locale: string, Segmenter: SegmenterClass | null | undefined): string[] {
  if (!NO_SPACE_SCRIPT.test(word)) return [word];
  if (Segmenter && typeof Segmenter === 'function') {
    try {
      const parts = Array.from(new Segmenter(locale, { granularity: 'word' }).segment(word))
        .filter((s) => s.isWordLike !== false).map((s) => s.segment.trim()).filter(Boolean);
      if (parts.length) return parts;
    } catch { /* fall through to characters */ }
  }
  // No segmenter: one requirement per character of the no-space script; a Latin / Cyrillic / digit run stays whole.
  const parts: string[] = [];
  let run = '';
  for (const ch of word) {
    if (NO_SPACE_SCRIPT.test(ch)) { if (run) { parts.push(run); run = ''; } parts.push(ch); } else run += ch;
  }
  if (run) parts.push(run);
  return parts;
}

/** The query's words: folded, split at spaces, and runs of Chinese / Japanese / Thai ... split into words. */
export function searchWords(query: string, locale: string = currentLocale.value, Segmenter: SegmenterClass | null | undefined = (Intl as unknown as { Segmenter?: SegmenterClass }).Segmenter): string[] {
  return foldText(query).folded.split(' ').filter(Boolean).flatMap((word) => segmentWord(word, locale, Segmenter));
}

/** Every `when` expression holds (a missing gate counts as hidden: never offer a row its tab would not show). */
export function settingsEntryShown(entry: SettingsSearchEntry, gates: SettingsSearchGates): boolean {
  return (entry.when ?? []).every((expression) => {
    try { return gates[expression]?.() === true; } catch { return false; }
  });
}

/** The i18n key of a tab's name (SETTINGS_SECTIONS labels; the search also needs it in English). */
export function settingsTabLabelKey(tab: SettingsTab): string {
  return `settings.settingsSections.${tab === 'modpacks' ? 'modPacks' : tab}`;
}

const WEIGHT: Readonly<Record<SettingsSearchField, number>> = { label: 100, group: 40, tab: 30, info: 20 };
const MAX_RESULTS = 100;
const EXCERPT_CHARS = 110;
const EXCERPT_LEAD = 36;

interface FieldText { field: SettingsSearchField; text: string; folded: string; map: number[]; local: boolean }

function fieldTexts(entry: SettingsSearchEntry, withEnglish: boolean): FieldText[] {
  const keys: [SettingsSearchField, string | undefined][] = [
    ['label', entry.label], ['group', entry.group], ['tab', settingsTabLabelKey(entry.tab)], ['info', entry.info],
  ];
  const out: FieldText[] = [];
  for (const [field, key] of keys) {
    if (!key) continue;
    const local = t(key);
    out.push({ field, text: local, ...foldText(local), local: true });
    if (withEnglish) {
      const english = tEnglish(key);
      if (english !== local) out.push({ field, text: english, ...foldText(english), local: false });
    }
  }
  return out;
}

function excerptOf(info: FieldText, word: string): SettingsSearchExcerpt {
  const at = info.folded.indexOf(word);
  const text = info.text;
  if (at < 0) {
    const cut = text.length > EXCERPT_CHARS ? `${text.slice(0, EXCERPT_CHARS).trimEnd()}…` : text;
    return { text: cut, hitStart: 0, hitEnd: 0 };
  }
  const hitStart = info.map[at]!;
  const lastFolded = at + word.length - 1;
  const hitEnd = (info.map[lastFolded] ?? hitStart) + 1;
  let start = Math.max(0, hitStart - EXCERPT_LEAD);
  if (start > 0) { const space = text.lastIndexOf(' ', start); start = space > 0 && hitStart - space < EXCERPT_LEAD * 2 ? space + 1 : start; }
  let end = Math.min(text.length, Math.max(hitEnd, start + EXCERPT_CHARS));
  if (end < text.length) { const space = text.indexOf(' ', end); end = space > 0 && space - end < 20 ? space : end; }
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return { text: `${prefix}${text.slice(start, end)}${suffix}`, hitStart: hitStart - start + prefix.length, hitEnd: hitEnd - start + prefix.length };
}

/** The settings matching `query` that Settings shows right now, best first (a name match before a help-text match). */
export function searchSettings(query: string, gates: SettingsSearchGates, index: readonly SettingsSearchEntry[] = SETTINGS_SEARCH_INDEX): SettingsSearchResult[] {
  const words = searchWords(query);
  if (!words.length) return [];
  // en-GB too: its overlay changes spellings, and the US base ("color") should still match.
  const withEnglish = currentLocale.value !== 'en';
  const scored: { result: SettingsSearchResult; score: number; order: number }[] = [];
  index.forEach((entry, order) => {
    if (!settingsEntryShown(entry, gates)) return;
    const fields = fieldTexts(entry, withEnglish);
    let score = 0;
    let infoWord: string | null = null;
    let labelHasAll = true;
    for (const word of words) {
      let best = 0;
      let bestField: SettingsSearchField | null = null;
      for (const f of fields) {
        const at = f.folded.indexOf(word);
        if (at < 0) continue;
        const wordStart = at === 0 || f.folded[at - 1] === ' ';
        const value = WEIGHT[f.field] + (wordStart ? 10 : 0) + (f.local ? 1 : 0);
        if (value > best) { best = value; bestField = f.field; }
      }
      if (!bestField) return; // this word matches nowhere: not a result
      score += best;
      if (bestField !== 'label') labelHasAll = false;
      if (bestField === 'info' && !infoWord) infoWord = word;
    }
    const localInfo = fields.find((f) => f.field === 'info' && f.local);
    const excerpt = infoWord && !labelHasAll && localInfo ? excerptOf(localInfo, infoWord) : null;
    scored.push({
      result: {
        entry,
        label: t(entry.label),
        tabLabel: SETTINGS_SECTIONS.find((s) => s.id === entry.tab)?.label ?? entry.tab,
        groupLabel: entry.group ? t(entry.group) : null,
        excerpt,
      },
      score: score + (labelHasAll ? 50 : 0),
      order,
    });
  });
  scored.sort((a, b) => b.score - a.score || a.order - b.order);
  return scored.slice(0, MAX_RESULTS).map((s) => s.result);
}

/** Ctrl+F (Cmd+F on macOS) inside Settings focuses the search box. */
export function isSettingsSearchShortcut(event: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): boolean {
  return (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && (event.code === 'KeyF' || event.key.toLowerCase() === 'f');
}

const HIT_CLASS = 'settings-search-hit';
const HIT_MS = 1800;
let hitTimer: ReturnType<typeof setTimeout> | null = null;
const FOCUSABLE = 'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]):not([data-setting-info]), a[href]';

/** A control keyboard focus can actually land on: not disabled (a disabled fieldset included), not inert, not hidden
 *  (display: none, visibility: hidden, [hidden]) and not inside a collapsed <details> below the row (its <summary>
 *  stays visible). Checked from the control up to the row. */
function focusableInRow(control: HTMLElement, row: HTMLElement): boolean {
  if (control.matches(':disabled') || control.closest('[inert]')) return false;
  if (getComputedStyle(control).visibility === 'hidden') return false;
  for (let el: HTMLElement | null = control; el; el = el === row ? null : el.parentElement) {
    if (el.hidden || getComputedStyle(el).display === 'none') return false;
    if (el !== control && el instanceof HTMLDetailsElement && !el.open) {
      const summary = el.querySelector(':scope > summary');
      if (!summary || !summary.contains(control)) return false;
    }
  }
  return true;
}

/** Scroll the setting's row into view, flash it, and focus its control (the row itself when it has none).
 *  False when the row is not in the DOM (its tab is not showing it). */
export function revealSettingRow(root: ParentNode | null | undefined, id: string): boolean {
  const row = root?.querySelector<HTMLElement>(`[data-setting-id="${id.replace(/["\\]/g, '\\$&')}"]`);
  if (!row) return false;
  // A row inside a collapsed <details> (Skills > per-skill config) would stay hidden: open every enclosing one first.
  // The row itself included: a result whose anchor IS a <details> (the per-skill table) opens too.
  for (let d = row.closest('details'); d; d = d.parentElement?.closest('details') ?? null) d.open = true;
  row.scrollIntoView?.({ block: 'center', inline: 'nearest' });
  document.querySelectorAll(`.${HIT_CLASS}`).forEach((old) => old.classList.remove(HIT_CLASS));
  if (hitTimer) clearTimeout(hitTimer);
  // Restart the flash when the same row is picked twice in a row.
  void row.offsetWidth;
  row.classList.add(HIT_CLASS);
  hitTimer = setTimeout(() => { row.classList.remove(HIT_CLASS); hitTimer = null; }, HIT_MS);
  // The first control a keyboard can reach; nested sections the result did not point at stay as they are.
  const control = Array.from(row.querySelectorAll<HTMLElement>(FOCUSABLE)).find((c) => focusableInRow(c, row));
  if (control) control.focus({ preventScroll: true });
  else {
    if (!row.hasAttribute('tabindex')) row.setAttribute('tabindex', '-1');
    row.focus({ preventScroll: true });
  }
  return true;
}
