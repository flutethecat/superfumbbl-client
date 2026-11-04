import { getCurrentScope, onScopeDispose, readonly, watch, type App, type Ref } from 'vue';
import enCatalogue from './locales/en.json';
import enGbCatalogue from './locales/en-GB.json';
import bgCatalogue from './locales/bg.json';
import cyCatalogue from './locales/cy.json';
import deCatalogue from './locales/de.json';
import esCatalogue from './locales/es.json';
import frCatalogue from './locales/fr.json';
import gaCatalogue from './locales/ga.json';
import gdCatalogue from './locales/gd.json';
import itCatalogue from './locales/it.json';
import nlCatalogue from './locales/nl.json';
import plCatalogue from './locales/pl.json';
import ruCatalogue from './locales/ru.json';
import srCyrlCatalogue from './locales/sr-Cyrl.json';
import srLatnCatalogue from './locales/sr-Latn.json';
import ukCatalogue from './locales/uk.json';
import zhHansCatalogue from './locales/zh-Hans.json';
import { terms } from './terms';
import { localeRef, type Locale } from './state';
import { parseMessage, type IcuNode } from './icu';

/**
 * Client localisation layer (owner 10-23: "Ensure we have each of the elements in our client bound to strings that we can
 * translate").
 *
 * - English (owner 11-03): `en.json` is English (US) and stays the base (fallback, lt() log text, bug reports);
 *   `en-GB.json` holds only the keys whose British spelling differs (tools/i18n/english-us-uk.mjs writes both).
 * - Every string the CLIENT authors goes through `t(key, params?)`. Keys are stable dotted ids (`settings.sound.volume`),
 *   never the English text. `locales/en.json` is the source of truth and carries every key; other locales may be partial.
 * - Missing key in the active locale -> the English text. Missing key in English -> the key itself, plus ONE console
 *   warning per key.
 * - Params: `{name}` is replaced by `params.name`. Plurals use the ICU form with the full CLDR categories, picked by
 *   Intl.PluralRules(locale): `{n, plural, one {# player} few {# players} many {# players} other {# players}}` (`#` = the
 *   number, `=N` exact matches allowed). A locale supplies only the categories it uses (English: one/other; Chinese:
 *   other). A missing category falls to `other`, and a block with neither falls back to the English message.
 * - Server-authored terms (skills, positions, races, inducements...) go through `terms()` (./terms.ts), not `t()`.
 *   Server REPORT text is never translated (server-derived law).
 *
 * The active locale is a Vue ref, so any template or computed that calls `t()` re-renders when the locale changes.
 */

export type { Locale };
/** Param values render like Vue's text interpolation: null/undefined -> '', anything else -> String(value). */
export type MessageParams = Record<string, unknown>;
type Catalogue = Readonly<Record<string, string>>;

export const DEFAULT_LOCALE: Locale = 'en';

/** Each locale labelled in its OWN language (the Settings dropdown shows these names as-is, in every locale).
 *  Owner 11-03: `en` is English (US); `en-GB` is English (UK), an overlay over `en` (./englishVariant.ts). */
export const availableLocales: readonly { readonly id: Locale; readonly name: string }[] = [
  { id: 'en', name: 'English (US)' },
  { id: 'en-GB', name: 'English (UK)' },
  { id: 'bg', name: 'Български' },
  { id: 'cy', name: 'Cymraeg' },
  { id: 'de', name: 'Deutsch' },
  { id: 'es', name: 'Español' },
  { id: 'fr', name: 'Français' },
  { id: 'ga', name: 'Gaeilge' },
  { id: 'gd', name: 'Gàidhlig' },
  { id: 'it', name: 'Italiano' },
  { id: 'nl', name: 'Nederlands' },
  { id: 'pl', name: 'Polski' },
  { id: 'ru', name: 'Русский' },
  { id: 'sr-Cyrl', name: 'Српски' },
  { id: 'sr-Latn', name: 'Srpski' },
  { id: 'uk', name: 'Українська' },
  { id: 'zh-Hans', name: '简体中文' },
];

const CATALOGUES: Readonly<Record<Locale, Catalogue>> = {
  en: enCatalogue as Catalogue,
  'en-GB': enGbCatalogue as Catalogue, // overlay: only the British spellings; everything else falls back to en
  bg: bgCatalogue as Catalogue,
  cy: cyCatalogue as Catalogue,
  de: deCatalogue as Catalogue,
  es: esCatalogue as Catalogue,
  fr: frCatalogue as Catalogue,
  ga: gaCatalogue as Catalogue,
  gd: gdCatalogue as Catalogue,
  it: itCatalogue as Catalogue,
  nl: nlCatalogue as Catalogue,
  pl: plCatalogue as Catalogue,
  ru: ruCatalogue as Catalogue,
  'sr-Cyrl': srCyrlCatalogue as Catalogue,
  'sr-Latn': srLatnCatalogue as Catalogue,
  uk: ukCatalogue as Catalogue,
  'zh-Hans': zhHansCatalogue as Catalogue,
};
/** Extra catalogues registered at runtime (test seam; future locales register here before they get a JSON file). */
const EXTRA_CATALOGUES = new Map<string, Catalogue>();
export function registerCatalogue(locale: string, messages: Catalogue): void {
  EXTRA_CATALOGUES.set(locale, messages);
}
function catalogueFor(locale: string): Catalogue {
  return (CATALOGUES as Record<string, Catalogue>)[locale] ?? EXTRA_CATALOGUES.get(locale) ?? {};
}

/** The active locale (read-only; change it with setLocale). */
export const currentLocale: Readonly<Ref<Locale>> = readonly(localeRef);

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && availableLocales.some((l) => l.id === value);
}

export function normalizeLocale(value: unknown): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

export function setLocale(locale: unknown): void {
  // A runtime-registered catalogue (registerCatalogue) is selectable too.
  const next = typeof locale === 'string' && EXTRA_CATALOGUES.has(locale) ? (locale as Locale) : normalizeLocale(locale);
  localeRef.value = next;
  try {
    if (typeof document !== 'undefined' && document.documentElement) document.documentElement.lang = next;
  } catch { /* no DOM */ }
}

const warnedKeys = new Set<string>();
function warnMissing(key: string): void {
  if (warnedKeys.has(key)) return;
  warnedKeys.add(key);
  if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV) {
    try { console.warn(`[i18n] missing English message for key "${key}"`); } catch { /* ignore */ }
  }
}
/** Test seam: the keys that have warned so far (deduped). */
export function missingKeysWarned(): readonly string[] {
  return [...warnedKeys];
}

const pluralRulesCache = new Map<string, Intl.PluralRules>();
/** CLDR plural category (zero/one/two/few/many/other) of `n` in `locale`, via Intl.PluralRules. */
export function pluralCategory(locale: string, n: number): Intl.LDMLPluralRule {
  let rules = pluralRulesCache.get(locale);
  if (!rules) {
    try { rules = new Intl.PluralRules(locale); } catch { rules = new Intl.PluralRules('en'); }
    pluralRulesCache.set(locale, rules);
  }
  return rules.select(n);
}

const numberFormatCache = new Map<string, Intl.NumberFormat>();
function numberFormat(locale: string): Intl.NumberFormat {
  let f = numberFormatCache.get(locale);
  if (!f) {
    try { f = new Intl.NumberFormat(locale); } catch { f = new Intl.NumberFormat('en'); }
    numberFormatCache.set(locale, f);
  }
  return f;
}

/** Parsed messages, keyed by the raw text (the catalogue is fixed, so this stays small). A malformed message parses to
 *  null and renders raw (scripts/i18n-check.mjs rejects malformed messages before they ship). */
const parsedCache = new Map<string, IcuNode[] | null>();
function parsed(message: string): IcuNode[] | null {
  let nodes = parsedCache.get(message);
  if (nodes === undefined) {
    try { nodes = parseMessage(message); } catch { nodes = null; }
    parsedCache.set(message, nodes);
  }
  return nodes;
}

const MISSING_BRANCH = Symbol('missing plural branch');

function render(nodes: IcuNode[], params: MessageParams, locale: string, pound: number | null): string | typeof MISSING_BRANCH {
  let out = '';
  for (const n of nodes) {
    if (n.kind === 'text') out += n.value;
    else if (n.kind === 'pound') out += pound === null ? '#' : numberFormat(locale).format(pound);
    else if (n.kind === 'arg') {
      if (!(n.name in params)) { out += `{${n.name}}`; continue; }
      const v = params[n.name];
      out += v === null || v === undefined ? '' : String(v);
    } else {
      const raw = params[n.name];
      const num = typeof raw === 'number' ? raw : Number(raw);
      if (raw === undefined || !Number.isFinite(num)) {
        const other = n.branches.get('other');
        if (!other) return MISSING_BRANCH;
        const r = render(other, params, locale, null);
        if (r === MISSING_BRANCH) return r;
        out += r;
        continue;
      }
      const chosen = n.branches.get(`=${num}`) ?? n.branches.get(pluralCategory(locale, num)) ?? n.branches.get('other');
      if (!chosen) return MISSING_BRANCH;
      const r = render(chosen, params, locale, num);
      if (r === MISSING_BRANCH) return r;
      out += r;
    }
  }
  return out;
}

/**
 * Formats a raw catalogue message (src/i18n/icu.ts syntax: `{param}`, ICU plural blocks with the full CLDR categories
 * picked by Intl.PluralRules(locale), `=N` exact matches, `#` = the number, ICU apostrophe quoting). Returns null when
 * a plural block has no branch for the number's category and no `other` (t() then falls back to English).
 */
export function formatMessage(message: string, params: MessageParams | undefined, locale: string): string | null {
  if (!params && !message.includes("'")) return message;
  const nodes = parsed(message);
  if (!nodes) return message;
  const r = render(nodes, params ?? {}, locale, null);
  return r === MISSING_BRANCH ? null : r;
}

/** The message for `key` in the active locale (English fallback, then the key itself). */
export function t(key: string, params?: MessageParams): string {
  const locale = localeRef.value; // read first: templates track the locale even on a fallback
  const own = catalogueFor(locale)[key];
  if (own !== undefined) {
    const formatted = formatMessage(own, params, locale);
    if (formatted !== null) return formatted;
  }
  const english = CATALOGUES.en[key];
  if (english !== undefined) return formatMessage(english, params, 'en') ?? english;
  warnMissing(key);
  return key;
}

/**
 * A client-authored LOG line (Astra r2): the log stores English (bug reports, diagnostics, the text-matched log
 * classification and Classic all read `text`), and the view renders the message in the current language. `lt()`
 * carries the key + params to the log; `englishText` / `shownText` resolve it.
 */
export interface LocalText { readonly key: string; readonly params?: MessageParams; readonly localText: true }
export function lt(key: string, params?: MessageParams): LocalText {
  return params ? { key, params, localText: true } : { key, localText: true };
}
export function isLocalText(value: unknown): value is LocalText {
  return !!value && typeof value === 'object' && (value as { localText?: unknown }).localText === true;
}
/** The English message for `key` (the key itself when English lacks it). */
export function tEnglish(key: string, params?: MessageParams): string {
  const english = CATALOGUES.en[key];
  if (english === undefined) { warnMissing(key); return key; }
  return formatMessage(english, params, 'en') ?? english;
}
/** Params may themselves be LocalTexts (a localised seat name inside a sentence): resolved the same way. */
const resolveParams = (params: MessageParams | undefined, resolve: (v: LocalText) => string): MessageParams | undefined =>
  params && Object.fromEntries(Object.entries(params).map(([k, v]) => [k, isLocalText(v) ? resolve(v) : v]));
/** A log text in English (stored). */
export function englishText(value: string | LocalText): string {
  return isLocalText(value) ? tEnglish(value.key, resolveParams(value.params, englishText)) : value;
}
/** A log text in the current language (shown). */
export function shownText(value: string | LocalText): string {
  return isLocalText(value) ? t(value.key, resolveParams(value.params, shownText)) : value;
}

/** `key` rendered in every known locale (deduplicated). For healing DATA that an earlier build stored translated:
 *  a value equal to any of these is the generated fallback, not a genuine name. */
export function tEveryLocale(key: string, params?: MessageParams): string[] {
  const out = new Set<string>();
  for (const locale of [...Object.keys(CATALOGUES), ...EXTRA_CATALOGUES.keys()]) {
    const message = catalogueFor(locale)[key];
    if (message === undefined) continue;
    const formatted = formatMessage(message, params, locale);
    if (formatted !== null) out.add(formatted);
  }
  return [...out];
}

/** Drop-cap headings (`<span class="cap">S</span>ideline`): the WHOLE word is one message. capHead is its first letter
 *  when the message starts with a Latin / Greek / Cyrillic letter (the styled cap), else ''; capTail is the rest (or
 *  the whole message for scripts without capitals, e.g. Chinese). */
const CAPPABLE = /^[A-Za-zÀ-ɏͰ-ϿЀ-ӿ]/;
export function capHead(key: string, params?: MessageParams): string {
  const text = t(key, params);
  return CAPPABLE.test(text) ? text.charAt(0) : '';
}
export function capTail(key: string, params?: MessageParams): string {
  const text = t(key, params);
  return CAPPABLE.test(text) ? text.slice(1) : text;
}

/*
 * LIVE-SWITCH POLICY (Astra r1 #5, r2 #11 #12). A string produced by t() is a snapshot: storing it freezes the language
 * it was made in. So:
 *  - Templates and computeds call t() / terms() directly (reactive: they re-render on a locale change).
 *  - Module-level tables use lazy getters (`get label() { return t('k'); }`), never `const X = t('k')` at module scope
 *    (test/i18nCoverage.test.ts fails on that), and a prop default is a computed fallback (`props.x ?? t('k')`), never
 *    a localised default value.
 *  - Copy assigned at runtime into a ref or a reactive field (status lines, errors, notices) goes through
 *    liveSet(target, prop, () => <expression using t()>): the field gets the text now and is re-produced on every
 *    locale change for as long as nothing else has overwritten it.
 *  - Registrations are OWNED: a component registers through useLiveSet() (released when its scope is disposed), a class
 *    instance passes itself as the owner and calls disposeLive(this) when it is done, and module singletons use the
 *    module owner. There is no cap and nothing active is ever evicted; re-registering a field replaces its entry.
 *  - A producer never copies another field's STORED translated text: it reads the source's message through
 *    liveValue(source, prop), which re-runs the source's producer (order-independent refresh).
 *  - DATA never holds localised text: anything stored, compared, matched, sent or styled by keeps an invariant English /
 *    enum value (data(...)), and only the last render step localises it.
 */
interface LiveEntry { produce: () => unknown; last: unknown }
type LiveOwner = object;
/** Module singletons (the store, assetMods ...): live as long as the app. */
const MODULE_OWNER: LiveOwner = Object.freeze({ owner: 'module' });
/** owner -> target -> prop -> entry. Insertion-ordered maps: a refresh runs oldest registration first. */
const liveRegistry = new Map<LiveOwner, Map<object, Map<PropertyKey, LiveEntry>>>();
/** target -> prop -> owner, so a re-registration under another owner replaces the old entry. */
const liveOwnerOf = new WeakMap<object, Map<PropertyKey, LiveOwner>>();
/** Owners already disposed (Astra r3 #16): a late async callback may still assign through them, never register. */
const closedOwners = new WeakSet<LiveOwner>();

/** Assigns `produce()` to `target[prop]` and keeps it in the active locale (see the policy above). Returns the value. */
export function liveSet<V>(target: object, prop: string, produce: () => V, owner?: LiveOwner): V {
  // Loosely typed on purpose: it also serves class-private fields and refs; the caller's own field type governs `V`.
  const value = produce();
  (target as Record<PropertyKey, unknown>)[prop] = value;
  const o = owner ?? MODULE_OWNER;
  if (closedOwners.has(o)) return value; // a disposed owner (e.g. a request finishing after unmount): no registration
  const previous = liveOwnerOf.get(target)?.get(prop);
  if (previous) liveRegistry.get(previous)?.get(target)?.delete(prop);
  let byTarget = liveRegistry.get(o);
  if (!byTarget) { byTarget = new Map(); liveRegistry.set(o, byTarget); }
  let byProp = byTarget.get(target);
  if (!byProp) { byProp = new Map(); byTarget.set(target, byProp); }
  byProp.delete(prop); // re-registration moves to the end (newest)
  byProp.set(prop, { produce, last: value });
  let owners = liveOwnerOf.get(target);
  if (!owners) { owners = new Map(); liveOwnerOf.set(target, owners); }
  owners.set(prop, o);
  return value;
}

/** The CURRENT message of a live field in the active locale (its producer re-run), else its stored value. Producers use
 *  this to depend on another field without copying that field's stored (possibly previous-language) text. */
export function liveValue<V = unknown>(target: object, prop: string): V {
  const o = liveOwnerOf.get(target)?.get(prop);
  const entry = o ? liveRegistry.get(o)?.get(target)?.get(prop) : undefined;
  const stored = (target as Record<PropertyKey, unknown>)[prop];
  if (entry && stored === entry.last) return entry.produce() as V;
  return stored as V;
}

/** Releases every registration of `owner` (a class instance's dispose, a component scope's end). */
export function disposeLive(owner: LiveOwner): void {
  if (owner !== MODULE_OWNER) closedOwners.add(owner);
  const byTarget = liveRegistry.get(owner);
  if (!byTarget) return;
  liveRegistry.delete(owner);
  for (const [target, byProp] of byTarget) {
    const owners = liveOwnerOf.get(target);
    for (const prop of byProp.keys()) if (owners?.get(prop) === owner) owners.delete(prop);
  }
}

/** Component / effect-scope registrations: `const live = useLiveSet()` in setup, then `live(target, prop, () => ...)`
 *  from handlers. Everything it registered is released when the scope is disposed (component unmount). */
export function useLiveSet(): <V>(target: object, prop: string, produce: () => V) => V {
  const owner: LiveOwner = {};
  if (getCurrentScope()) onScopeDispose(() => disposeLive(owner));
  return (target, prop, produce) => liveSet(target, prop, produce, owner);
}

/** Test seam: how many live registrations exist (all owners). */
export function liveRegistrationCount(): number {
  let n = 0;
  for (const byTarget of liveRegistry.values()) for (const byProp of byTarget.values()) n += byProp.size;
  return n;
}

watch(localeRef, () => {
  for (const [owner, byTarget] of [...liveRegistry]) {
    for (const [target, byProp] of [...byTarget]) {
      for (const [prop, entry] of [...byProp]) {
        const record = target as Record<PropertyKey, unknown>;
        if (record[prop] !== entry.last) { byProp.delete(prop); liveOwnerOf.get(target)?.delete(prop); continue; } // overwritten since
        try {
          entry.last = entry.produce();
          record[prop] = entry.last;
        } catch {
          byProp.delete(prop);
        }
      }
      if (!byProp.size) byTarget.delete(target);
    }
    if (!byTarget.size && owner !== MODULE_OWNER) liveRegistry.delete(owner);
  }
}, { flush: 'sync' });

/**
 * DATA marker (Astra r2 #2 #4 #9): `data('Join the Draw')` is the identity function. It marks a string that is matched,
 * compared, sent, stored or styled by, so it must stay invariant English. The extraction codemods never translate inside
 * data(...) (or on a line carrying an `i18n:data` comment), and the coverage detector exempts it.
 */
export function data<T>(value: T): T {
  return value;
}

/** Template alias: components import `$t` and use `{{ $t('key') }}` (works with or without the plugin installed). */
export const $t = t;

/** Does English carry this key? (tests / tooling) */
export function hasMessage(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(CATALOGUES.en, key);
}

/** Every message key in `locale` (tests / tooling). */
export function messageKeys(locale: Locale): string[] {
  return Object.keys(CATALOGUES[locale]);
}

export interface I18n {
  t: typeof t;
  terms: typeof terms;
  locale: Readonly<Ref<Locale>>;
  setLocale: typeof setLocale;
  availableLocales: typeof availableLocales;
}

/** Composable for script code. */
export function useI18n(): I18n {
  return { t, terms, locale: currentLocale, setLocale, availableLocales };
}

/** Vue plugin: `$t` / `$term` on every component instance (main.ts installs it). */
export const i18nPlugin = {
  install(app: App): void {
    app.config.globalProperties.$t = t;
    app.config.globalProperties.$term = terms;
  },
};

declare module 'vue' {
  interface ComponentCustomProperties {
    $t: typeof t;
    $term: typeof terms;
  }
}

export { terms };
export { englishVariantFor, englishVariantOf, mapLegacyEnglish, systemLanguageTags, UK_ENGLISH_REGIONS } from './englishVariant';
