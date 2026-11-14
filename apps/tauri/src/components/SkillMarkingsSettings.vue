<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref } from 'vue';
import { settings } from '../game/settings';
import { FONT_DISPLAY_FAMILY } from '../game/fontStacks';
import { importFumbblMarkingsDetailed } from '../game/fumbblMarkingsImport';
import {
  addMarkingRule, clearAllMarkings, commitMarkingStores, currentMarkingStores, findMarkingConflicts, importedMarkingCount,
  invalidateMarkingsImports, listMarkingRules, markingRuleSubject, removeImportedMarkings, removeMarkingRule,
  splitMarkingSubject, splitTypedSkills, updateMarkingRule, type MarkingApplyTo, type MarkingRuleRow,
} from '../game/markingRules';
import { $t, useLiveSet } from '../i18n';
/** i18n live-switch registrations owned by this component (released on unmount; src/i18n LIVE-SWITCH POLICY). */
const liveSetHere = useLiveSet();
import { t } from '../i18n';

/**
 * Owner 10-09: Settings → Skill display → "Skill markings". One flow, top to bottom:
 *   SOURCE   where the markings came from + Import / Refresh, with its status
 *   TABLE    every marking the pitch draws: marking (in the pitch style), skills, applies to, gained only; edit / remove
 *   ADD      a new rule
 *   FOOTER   count + Clear all (asks first)
 * (Blocks are <div role="group">, not <section>: App.vue's `.settings-content section` makes every section a column flex.)
 * The blocks are separate on purpose (mk-source / mk-table / mk-add / mk-footer) so the layout can follow the
 * fumbbl.com markings page once the owner supplies a copy of it; the data and actions do not depend on the layout.
 * Every change goes through game/markingRules.ts (both stores, see there); nothing here fetches except the
 * coach-pressed Import.
 *
 * Astra review 10-09: every row is its own stored rule (edit / remove never touches another); Add never replaces a
 * rule unless the coach says so; while an import is in flight nothing here can change the markings, and a reply that
 * arrives after the markings changed (or Settings closed) is dropped.
 */
const props = defineProps<{
  /** Every skill name a rule may match (the per-skill config's list), for the Add row's check and suggestions. */
  skills: readonly string[];
}>();

const importedJson = computed(() => !!settings.markingsImportCoach);
const rows = computed<MarkingRuleRow[]>(() => listMarkingRules(currentMarkingStores(), importedJson.value));

// ── source: import / refresh ────────────────────────────────────────────────────────────────────────────────────────
/** #16 (owner 08-11): the coach is autofilled with the user's own and stays editable (import any coach's markings). */
const coachOverride = ref<string | null>(null);
const coach = computed<string>({
  get: () => coachOverride.value ?? (settings.markingsImportCoach || settings.coach),
  set: (value) => { coachOverride.value = value; },
});
const status = reactive({ kind: 'idle' as 'idle' | 'busy' | 'ok' | 'error', text: '' });
/** An import is in flight: nothing below may change the markings until it has answered (Astra F5). */
const busy = computed(() => status.kind === 'busy');
/** The last reply was ambiguous (no markings came back): offer the explicit "remove my imported markings" step. */
const ambiguousReply = ref(false);
const importedCount = computed(() => importedMarkingCount(currentMarkingStores(), importedJson.value));
const isRefresh = computed(() => !!settings.markingsImportCoach
  && coach.value.trim().toLowerCase() === settings.markingsImportCoach.toLowerCase());
const importedWhen = computed(() => {
  if (!settings.markingsImportAt) return '';
  try {
    return new Date(settings.markingsImportAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return '';
  }
});
function say(kind: 'ok' | 'error' | 'idle', text: string): void {
  if (busy.value) return; // the busy line stays truthful until the import answers
  status.kind = kind;
  status.text = text;
}
/** Every change made here: closes the side prompts, then writes through the model (which drops a pending import). */
function change(next: ReturnType<typeof currentMarkingStores>): void {
  ambiguousReply.value = false;
  clearArmed.value = false;
  addConflict.value = null;
  commitMarkingStores(next);
}
async function importMarkings(): Promise<void> {
  if (busy.value) return;
  cancelEdit();
  clearArmed.value = false;
  addConflict.value = null;
  ambiguousReply.value = false;
  status.kind = 'busy';
  status.text = '';
  const result = await importFumbblMarkingsDetailed(coach.value, (text) => { status.text = text; });
  status.kind = result.ok ? 'ok' : result.kind === 'stale' ? 'idle' : 'error';
  status.text = result.status;
  ambiguousReply.value = result.kind === 'ambiguous' || result.kind === 'unreadable';
}
function removeImported(): void {
  if (busy.value) return;
  const count = importedCount.value;
  cancelEdit();
  change(removeImportedMarkings(currentMarkingStores(), importedJson.value));
  settings.markingsImportCoach = '';
  settings.markingsImportAt = 0;
  say('ok', `Removed ${count} imported marking${count === 1 ? '' : 's'}.`);
}
// Leaving this pane (another tab, another display mode, Settings closed): a reply still on its way is not applied.
onBeforeUnmount(() => invalidateMarkingsImports());

// ── table: edit / remove one rule ───────────────────────────────────────────────────────────────────────────────────
const APPLY_TO: { value: MarkingApplyTo; label: string; side: string }[] = [
  { value: 'BOTH', get label() { return t('settings.skillMarkingsSettings.applyTo.bothTeams'); }, side: 'both teams' },
  { value: 'OWN', get label() { return t('settings.skillMarkingsSettings.applyTo.myTeam'); }, side: 'my team' },
  { value: 'OPPONENT', get label() { return t('settings.skillMarkingsSettings.applyTo.opposition'); }, side: 'the opposition' },
];
const applyTo = (value: MarkingApplyTo) => APPLY_TO.find((option) => option.value === value)!;
/** An injury-only rule has no "gained" form: an injury is never part of the position. */
const gainedApplies = (row: MarkingRuleRow): boolean => row.skills.length > 0;
/** "Guard is already marked "G" for my team" - names the colliding rule(s). */
function describeConflicts(conflicts: readonly MarkingRuleRow[]): string {
  return conflicts.map((row) => t('ui.skillMarkingsSettings.text.p0ForSide', { p0: quoted(row.marking), side: applyTo(row.applyTo).side })).join(' and ');
}
/** The site allows a rule with a BLANK marking: it draws nothing itself and hides the markings of the rules it
 *  contains (a blank Block + Guard rule hides the Block and the Guard marking on a player with both). */
const isBlank = (row: MarkingRuleRow): boolean => !drawn(row.marking);
const quoted = (marking: string): string => (drawn(marking) ? `"${shown(marking)}"` : 'a blank marking');

const editingId = ref<string | null>(null);
const editError = ref('');
const draft = reactive({ marking: '', applyTo: 'BOTH' as MarkingApplyTo, gainedOnly: false, applyRepeatedly: false });
function startEdit(row: MarkingRuleRow): void {
  if (busy.value) return;
  clearArmed.value = false;
  editError.value = '';
  editingId.value = row.id;
  Object.assign(draft, { marking: row.marking, applyTo: row.applyTo, gainedOnly: row.gainedOnly, applyRepeatedly: row.applyRepeatedly });
}
function cancelEdit(): void { editingId.value = null; editError.value = ''; }
function saveEdit(row: MarkingRuleRow): void {
  if (busy.value || (!draft.marking.trim() && !isBlank(row))) return; // Save is disabled; Enter in the field must not blank a rule either
  const conflicts = findMarkingConflicts(rows.value, { skills: row.skills, injuries: row.injuries, applyTo: draft.applyTo }, row.id);
  if (conflicts.length) {
    liveSetHere(editError, 'value', () => t('ui.skillMarkingsSettings.text.p0IsAlreadyMarked', { p0: markingRuleSubject(row), p1: describeConflicts(conflicts) }));
    return;
  }
  change(updateMarkingRule(currentMarkingStores(), row, { ...draft }));
  cancelEdit();
}
function removeRule(row: MarkingRuleRow): void {
  if (busy.value) return;
  cancelEdit();
  change(removeMarkingRule(currentMarkingStores(), row));
  say('ok', `Removed ${quoted(row.marking)} (${markingRuleSubject(row)}).`);
}

// ── add ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const newRule = reactive({ skills: '', marking: '', applyTo: 'BOTH' as MarkingApplyTo, gainedOnly: true });
const addError = ref('');
/** The rule(s) the typed rule collides with: Add stops and asks (Astra F3). */
const addConflict = ref<{ text: string; ids: string[] } | null>(null);
/** Skills, the stat increases a rule may match (the generator's own tokens) and the injury keys. */
const STAT_TOKENS = ['+MA', '+ST', '+AG', '+PA', '+AV', 'NI', '-MA', '-ST', '-AG', '-PA', '-AV'];
const known = computed(() => new Map([...props.skills, ...STAT_TOKENS].map((name) => [name.toLowerCase(), name])));
function addRule(replaceExisting = false): void {
  if (busy.value) return;
  addError.value = '';
  const typed = splitTypedSkills(newRule.skills, known.value);
  const marking = newRule.marking.trim();
  if (!typed.length) { addConflict.value = null; liveSetHere(addError, 'value', () => t('ui.skillMarkingsSettings.text.enterTheSkillThis')); return; }
  if (!marking) { addConflict.value = null; liveSetHere(addError, 'value', () => t('ui.skillMarkingsSettings.text.enterTheMarkingText')); return; }
  const unknown = typed.filter((name) => !known.value.has(name.toLowerCase()));
  if (unknown.length) { addConflict.value = null; liveSetHere(addError, 'value', () => t('ui.skillMarkingsSettings.text.notASkillP0', { p0: unknown.join(', ') })); return; }
  // A repeated name is meaningful ("+ST, +ST" = two strength gains): the typed subject is kept as typed, never de-duplicated.
  const skills = typed.map((name) => known.value.get(name.toLowerCase())!);
  const subject = splitMarkingSubject(skills);
  const conflicts = findMarkingConflicts(rows.value, { ...subject, applyTo: newRule.applyTo });
  if (conflicts.length && !(replaceExisting && addConflict.value && conflicts.every((row) => addConflict.value!.ids.includes(row.id)))) {
    addConflict.value = {
      ids: conflicts.map((row) => row.id),
      get text() { return t('settings.skillMarkingsSettings.text.p0IsAlreadyMarked', { p0: markingRuleSubject(subject), p1: describeConflicts(conflicts) }); },
    };
    return;
  }
  change(addMarkingRule(currentMarkingStores(), { skills, marking, applyTo: newRule.applyTo, gainedOnly: newRule.gainedOnly }, conflicts));
  say('ok', `${conflicts.length ? 'Replaced with' : 'Added'} "${shown(marking)}" (${markingRuleSubject(subject)}, ${applyTo(newRule.applyTo).side}).`);
  newRule.skills = '';
  newRule.marking = '';
}

// ── clear all ───────────────────────────────────────────────────────────────────────────────────────────────────────
const clearArmed = ref(false);
function clearAll(): void {
  if (busy.value) return;
  const count = rows.value.length;
  cancelEdit();
  change(clearAllMarkings(currentMarkingStores()));
  settings.markingsImportCoach = '';
  settings.markingsImportAt = 0;
  say('ok', `Cleared ${count} skill marking${count === 1 ? '' : 's'}.`);
}

// ── preview: the pitch's own marking style ──────────────────────────────────────────────────────────────────────────
const MARKING_FONTS: Record<typeof settings.skillMarkingFont, string> = {
  arial: 'Arial, Helvetica, sans-serif',
  helvetica: 'Helvetica, Arial, sans-serif',
  system: 'system-ui, "Segoe UI", sans-serif',
  nuffle: FONT_DISPLAY_FAMILY,
};
const chipStyle = computed(() => ({
  fontFamily: MARKING_FONTS[settings.skillMarkingFont] ?? MARKING_FONTS.arial,
  fontSize: `${settings.skillMarkingSize}px`,
  color: settings.skillMarkingColor,
}));
/** The pitch strips whitespace from a marking (a compact glyph rail); the chip shows what is drawn. */
const drawn = (marking: string): string => marking.replace(/\s+/g, '');
/** An imported marking can be any length (only our own inputs stop at 6): Settings shows the first 8 characters and
 *  keeps the whole text in the tooltip, so one long rule cannot push the table or a status line apart. */
const SHOWN_MAX = 8;
function shown(marking: string): string {
  const chars = [...drawn(marking)];
  return chars.length > SHOWN_MAX ? `${chars.slice(0, SHOWN_MAX).join('')}…` : chars.join('');
}

// The slider track fill (same as App.vue's v-fill-range): paints the track up to the thumb.
function fillRange(el: HTMLInputElement): void {
  const min = Number(el.min || 0), max = Number(el.max || 100), v = Number(el.value);
  el.style.setProperty('--fill', `${max > min ? Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100)) : 0}%`);
}
const vFillRange = {
  mounted(el: HTMLInputElement) { fillRange(el); el.addEventListener('input', () => fillRange(el)); },
  updated(el: HTMLInputElement) { fillRange(el); },
};
</script>

<template>
  <fieldset class="settings-group skill-markings" data-testid="skill-markings" data-setting-id="skills.skillMarkings" :aria-busy="busy">
    <legend>{{ $t('settings.skillMarkings.skillMarkings.skillMarkings') }}</legend>

    <!-- APPEARANCE (owner 10-13: was its own "Skill marking appearance" box) -->
    <div class="mk-appearance" role="group" :aria-label="$t('settings.skillMarkings.skillMarkings.howMarkingsLookOn')">
      <label class="mk-field">
        <span>{{ $t('settings.skillMarkings.skillMarkings.color') }}</span>
        <input v-model="settings.skillMarkingColor" type="color" />
      </label>
      <label class="mk-field">
        <span>{{ $t('settings.skillMarkings.skillMarkings.font') }}</span>
        <select v-model="settings.skillMarkingFont" class="mk-input">
          <option value="arial">{{ $t('settings.skillMarkings.skillMarkings.arialHelvetica') }}</option>
          <option value="helvetica">{{ $t('settings.skillMarkings.skillMarkings.helveticaArial') }}</option>
          <option value="system">{{ $t('settings.skillMarkings.skillMarkings.systemSans') }}</option>
          <option value="nuffle">{{ $t('settings.skillMarkings.skillMarkings.nuffle') }}</option>
        </select>
      </label>
      <label class="mk-field mk-field-size">
        <span>{{ $t('settings.skillMarkings.skillMarkings.sizeSkillmarkingsizePx', { skillMarkingSize: settings.skillMarkingSize }) }}</span>
        <input v-model.number="settings.skillMarkingSize" v-fill-range type="range" min="6" max="24" step="1" />
      </label>
    </div>
    <p class="hint">{{ $t('settings.skillMarkings.skillMarkings.allGlyphsForA') }}</p>
    <!-- Owner 11-11 (opt-in): stat changes + niggling injuries on a line of their own above the skill marks -->
    <label class="mk-status-line" data-testid="markings-status-line">
      <input v-model="settings.markingStatusLine" type="checkbox" />
      <span>{{ $t('settings.skillMarkings.skillMarkings.statusLine') }}</span>
    </label>
    <p class="hint">{{ $t('settings.skillMarkings.skillMarkings.statusLineHint') }}</p>

    <!-- SOURCE: the fumbbl.com import, a compact sub-row of this same box -->
    <div class="mk-source" role="group" :aria-label="$t('settings.skillMarkings.skillMarkings.whereTheMarkingsCome')">
      <p class="mk-origin" data-testid="markings-origin">
        <template v-if="settings.markingsImportCoach">
          {{ $t('settings.skillMarkings.skillMarkings.importedFrom') }} <b>{{ settings.markingsImportCoach }}</b>{{ $t('settings.skillMarkings.skillMarkings.onFumbblCom') }}<template v-if="importedWhen"> · {{ importedWhen }}</template>
        </template>
        <template v-else-if="rows.length">{{ $t('settings.skillMarkings.skillMarkings.setUpHereNothing') }}</template>
        <template v-else>{{ $t('settings.skillMarkings.skillMarkings.noSkillMarkingsYet') }}</template>
      </p>
      <div class="mk-toolbar">
        <label class="mk-coach">
          <span>{{ $t('settings.skillMarkings.skillMarkings.coach') }}</span>
          <input v-model="coach" type="text" spellcheck="false" autocomplete="off" :placeholder="$t('settings.skillMarkings.skillMarkings.fumbblCoach')" :disabled="busy"
            data-testid="markings-coach" @keydown.enter.prevent="importMarkings" />
        </label>
        <button type="button" class="mk-btn mk-primary" data-testid="markings-import" :disabled="busy" @click="importMarkings">
          {{ busy ? $t('settings.skillMarkings.skillMarkings.importing') : isRefresh ? $t('settings.skillMarkings.skillMarkings.refreshFromFumbblCom') : $t('settings.skillMarkings.skillMarkings.importFromFumbblCom') }}
        </button>
      </div>
      <p class="mk-status" :class="`mk-status-${status.kind}`" data-testid="markings-status"
        :role="status.kind === 'error' ? 'alert' : 'status'" aria-live="polite">{{ status.text }}</p>
      <div v-if="ambiguousReply && importedCount && !busy" class="mk-confirm" data-testid="markings-ambiguous">
        <span>{{ $t('settings.skillMarkings.skillMarkings.nothingWasChangedIf', { importedCount }) }}</span>
        <button type="button" class="mk-btn mk-danger" data-testid="markings-remove-imported" @click="removeImported">{{ $t('settings.skillMarkings.skillMarkings.removeMyImportedMarkings') }}</button>
      </div>
      <p class="hint">{{ $t('settings.skillMarkings.skillMarkings.importReplacesWhatThe') }}</p>
    </div>

    <!-- TABLE -->
    <div v-if="rows.length" class="mk-table" role="table" :aria-label="$t('settings.skillMarkings.skillMarkings.skillMarkings')" data-testid="markings-table">
      <div class="mk-thead" role="row">
        <span role="columnheader">{{ $t('settings.skillMarkings.skillMarkings.marking') }}</span>
        <span role="columnheader">{{ $t('settings.skillMarkings.skillMarkings.skill') }}</span>
        <span role="columnheader">{{ $t('settings.skillMarkings.skillMarkings.appliesTo') }}</span>
        <span role="columnheader" :title="$t('settings.skillMarkings.skillMarkings.onlyWhenTheSkill')">{{ $t('settings.skillMarkings.skillMarkings.gained') }}</span>
        <span role="columnheader" class="mk-actions-head">{{ $t('settings.skillMarkings.skillMarkings.actions') }}</span>
      </div>
      <div v-for="row in rows" :key="row.id" class="mk-row" role="row" :data-rule="row.id" :data-editing="editingId === row.id">
        <template v-if="editingId !== row.id">
          <span class="mk-cell mk-marking" role="cell" data-label="Marking">
            <span v-if="!isBlank(row)" class="mk-chip" :style="chipStyle" :title="drawn(row.marking)">{{ shown(row.marking) }}</span>
            <span v-else class="mk-blank" data-testid="markings-blank">{{ $t('settings.skillMarkings.mkRow.skillMarkings.blank') }}</span>
          </span>
          <span class="mk-cell mk-skill" role="cell" data-label="Skill" :title="markingRuleSubject(row)">
            {{ markingRuleSubject(row) }}
            <small v-if="isBlank(row)" class="mk-tag" :title="$t('settings.skillMarkings.mkRow.skillMarkings.aBlankRuleDraws')">{{ $t('settings.skillMarkings.mkRow.skillMarkings.hidesP0', { p0: markingRuleSubject(row) }) }}</small>
            <small v-if="row.applyRepeatedly" class="mk-tag">{{ $t('settings.skillMarkings.mkRow.skillMarkings.repeats') }}</small>
            <small v-if="row.imported" class="mk-tag mk-tag-imported">{{ $t('settings.skillMarkings.mkRow.skillMarkings.imported') }}</small>
          </span>
          <span class="mk-cell" role="cell" data-label="Applies to">{{ applyTo(row.applyTo).label }}</span>
          <span class="mk-cell" role="cell" data-label="Gained">{{ gainedApplies(row) ? (row.gainedOnly ? $t('settings.skillMarkings.mkRow.skillMarkings.yes') : $t('settings.skillMarkings.mkRow.skillMarkings.no')) : '—' }}</span>
          <span class="mk-cell mk-actions" role="cell">
            <button type="button" class="mk-btn" data-action="edit" :disabled="busy" :aria-label="$t('settings.skillMarkings.mkRow.skillMarkings.editTheMarkingFor', { p0: markingRuleSubject(row), side: applyTo(row.applyTo).side })" @click="startEdit(row)">{{ $t('settings.skillMarkings.mkRow.skillMarkings.edit') }}</button>
            <button type="button" class="mk-btn mk-danger" data-action="remove" :disabled="busy" :aria-label="$t('settings.skillMarkings.mkRow.skillMarkings.removeTheMarkingFor', { p0: markingRuleSubject(row), side: applyTo(row.applyTo).side })" @click="removeRule(row)">{{ $t('settings.skillMarkings.mkRow.skillMarkings.remove') }}</button>
          </span>
        </template>
        <template v-else>
          <span class="mk-cell mk-marking" role="cell" data-label="Marking">
            <input v-model="draft.marking" class="mk-input mk-input-marking" type="text" maxlength="6" spellcheck="false" :aria-label="$t('settings.skillMarkings.mkRow.skillMarkings.markingText')"
              data-field="marking" :disabled="busy" @keydown.enter.prevent="saveEdit(row)" @keydown.esc.stop.prevent="cancelEdit" />
          </span>
          <span class="mk-cell mk-skill" role="cell" data-label="Skill" :title="markingRuleSubject(row)">
            {{ markingRuleSubject(row) }}
            <label v-if="row.source === 'json'" class="mk-check mk-repeat"><input v-model="draft.applyRepeatedly" type="checkbox" data-field="repeat" :disabled="busy" />{{ $t('settings.skillMarkings.mkRow.skillMarkings.repeatForEachTime') }}</label>
          </span>
          <span class="mk-cell" role="cell" data-label="Applies to">
            <select v-model="draft.applyTo" class="mk-input" :aria-label="$t('settings.skillMarkings.mkRow.skillMarkings.appliesTo')" data-field="applyTo" :disabled="busy">
              <option v-for="option in APPLY_TO" :key="option.value" :value="option.value">{{ option.label }}</option>
            </select>
          </span>
          <span class="mk-cell" role="cell" data-label="Gained">
            <input v-if="gainedApplies(row)" v-model="draft.gainedOnly" type="checkbox" :aria-label="$t('settings.skillMarkings.mkRow.skillMarkings.gainedOnly')" data-field="gainedOnly" :disabled="busy" />
            <template v-else>—</template>
          </span>
          <span class="mk-cell mk-actions" role="cell">
            <button type="button" class="mk-btn mk-primary" data-action="save" :disabled="busy || (!draft.marking.trim() && !isBlank(row))" @click="saveEdit(row)">{{ $t('settings.skillMarkings.mkRow.skillMarkings.save') }}</button>
            <button type="button" class="mk-btn" data-action="cancel" @click="cancelEdit">{{ $t('settings.skillMarkings.mkRow.skillMarkings.cancel') }}</button>
          </span>
          <p v-if="editError" class="mk-status mk-status-error mk-row-error" role="alert" data-testid="markings-edit-error">{{ editError }}</p>
        </template>
      </div>
    </div>

    <!-- ADD -->
    <div class="mk-add" role="group" :aria-label="$t('settings.skillMarkings.skillMarkings.addAMarking')">
      <label class="mk-field mk-field-skills">
        <span>{{ $t('settings.skillMarkings.skillMarkings.skill') }}</span>
        <input v-model="newRule.skills" class="mk-input" type="text" spellcheck="false" autocomplete="off" list="mk-skill-names" :disabled="busy"
          :placeholder="$t('settings.skillMarkings.skillMarkings.blockOrBlockTackle')" data-testid="markings-add-skills" @keydown.enter.prevent="addRule()" />
      </label>
      <label class="mk-field mk-field-marking">
        <span>{{ $t('settings.skillMarkings.skillMarkings.marking') }}</span>
        <input v-model="newRule.marking" class="mk-input mk-input-marking" type="text" maxlength="6" spellcheck="false" autocomplete="off" :disabled="busy"
          placeholder="B" data-testid="markings-add-marking" @keydown.enter.prevent="addRule()" />
      </label>
      <label class="mk-field">
        <span>{{ $t('settings.skillMarkings.skillMarkings.appliesTo') }}</span>
        <select v-model="newRule.applyTo" class="mk-input" data-testid="markings-add-applyto" :disabled="busy">
          <option v-for="option in APPLY_TO" :key="option.value" :value="option.value">{{ option.label }}</option>
        </select>
      </label>
      <label class="mk-check"><input v-model="newRule.gainedOnly" type="checkbox" data-testid="markings-add-gained" :disabled="busy" />{{ $t('settings.skillMarkings.skillMarkings.gainedOnly') }}</label>
      <button type="button" class="mk-btn" data-testid="markings-add" :disabled="busy" @click="addRule()">{{ $t('settings.skillMarkings.skillMarkings.addMarking') }}</button>
      <datalist id="mk-skill-names"><option v-for="name in skills" :key="name" :value="name" /></datalist>
      <p v-if="addError" class="mk-status mk-status-error" role="alert" data-testid="markings-add-error">{{ addError }}</p>
      <div v-if="addConflict" class="mk-confirm" role="alert" data-testid="markings-add-conflict">
        <span>{{ addConflict.text }}</span>
        <button type="button" class="mk-btn mk-danger" data-testid="markings-add-replace" :disabled="busy" @click="addRule(true)">{{ $t('settings.skillMarkings.skillMarkings.replaceIt') }}</button>
        <button type="button" class="mk-btn" data-testid="markings-add-keep" @click="addConflict = null">{{ $t('settings.skillMarkings.skillMarkings.keepIt') }}</button>
      </div>
    </div>

    <!-- FOOTER -->
    <footer class="mk-footer">
      <span class="mk-preview" data-testid="markings-preview">
        <span class="mk-preview-label">{{ $t('settings.skillMarkings.mkFooter.skillMarkings.onThePitch') }}</span>
        <span class="mk-chip mk-chip-sample" :style="chipStyle">{{ shown(rows.find((row) => !isBlank(row))?.marking ?? $t('settings.skillMarkings.mkFooter.skillMarkings.ab')) }}</span>
      </span>
      <span class="mk-count">{{ $t('settings.skillMarkings.mkFooter.skillMarkings.rowsMarkingP1', { rows: rows.length }) }}</span>
      <button v-if="rows.length && !clearArmed" type="button" class="mk-btn mk-danger" data-testid="markings-clear-all" :disabled="busy" @click="clearArmed = true">{{ $t('settings.skillMarkings.mkFooter.skillMarkings.clearAll') }}</button>
      <div v-if="rows.length && clearArmed" class="mk-confirm" role="alertdialog" :aria-label="$t('settings.skillMarkings.mkFooter.skillMarkings.clearAllSkillMarkings')" data-testid="markings-clear-confirm">
        <span>{{ $t('settings.skillMarkings.mkFooter.skillMarkings.removeAllRowsSkill', { rows: rows.length }) }}</span>
        <button type="button" class="mk-btn mk-danger" data-testid="markings-clear-yes" :disabled="busy" @click="clearAll">{{ $t('settings.skillMarkings.mkFooter.skillMarkings.clearAllMarkings') }}</button>
        <button type="button" class="mk-btn" data-testid="markings-clear-no" @click="clearArmed = false">{{ $t('settings.skillMarkings.mkFooter.skillMarkings.keepThem') }}</button>
      </div>
    </footer>
  </fieldset>
</template>

<style scoped>
.skill-markings { container-type: inline-size; gap: 0.6rem; min-width: 0; }
.mk-appearance { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 0.75rem; }
.mk-field-size { flex: 1 1 10em; }
/* Settings labels are primary text (white, primary floor); only annotations stay grey at the small floor (owner 07-14). */
.mk-appearance .mk-field { font-size: max(var(--ui-min-primary-text-size, 16px), 0.8rem); color: var(--ui-text); }
.mk-appearance .mk-input { font-size: max(var(--ui-min-primary-text-size, 16px), 0.8rem); }
.mk-status-line { display: flex; align-items: center; gap: 0.45rem; font-size: max(var(--ui-min-primary-text-size, 16px), 0.8rem); color: var(--ui-text); cursor: pointer; }
.mk-source { display: grid; gap: 0.35rem; padding-top: 0.5rem; border-top: 1px solid var(--ui-border); }
.mk-origin { margin: 0; color: var(--ui-text); font-size: max(var(--ui-min-text-size, 12px), 0.8rem); }
.mk-origin b { color: var(--ui-accent); }
.mk-toolbar { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 0.5rem; }
.mk-coach, .mk-field { display: grid; gap: 0.15rem; min-width: 0; font-size: max(var(--ui-min-text-size, 12px), 0.72rem); color: var(--ui-muted); }
.mk-coach input { width: 12em; max-width: 100%; box-sizing: border-box; }
.mk-status { margin: 0; min-height: 1.2em; font-size: max(var(--ui-min-text-size, 12px), 0.76rem); color: var(--ui-muted); }
.mk-status-ok { color: var(--ui-success, #6fcf7f); }
.mk-status-error { color: var(--ui-danger, #e05a5a); }

.mk-btn {
  background: var(--ui-surface-2); color: var(--ui-text); border: 1px solid var(--ui-border); border-radius: 4px;
  padding: 0.3rem 0.7rem; cursor: pointer; font: inherit; font-size: max(var(--ui-min-text-size, 12px), 0.76rem); white-space: nowrap;
}
.mk-btn:hover:not(:disabled) { border-color: var(--ui-accent); }
.mk-btn:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 1px; }
.mk-btn:disabled { opacity: 0.55; cursor: default; }
.mk-primary { background: var(--ui-primary); color: var(--ui-text-on-primary); border-color: transparent; }
.mk-danger { color: var(--ui-danger, #e05a5a); }
.mk-danger:hover:not(:disabled) { border-color: var(--ui-danger, #e05a5a); }

.mk-table { border: 1px solid var(--ui-border); border-radius: 5px; max-height: 320px; overflow-y: auto; }
.mk-thead, .mk-row {
  /* one font size for both, so the em columns of the header line up with the rows */
  font-size: max(var(--ui-min-text-size, 12px), 0.78rem);
  display: grid; grid-template-columns: 4.4em minmax(0, 1fr) 7.4em 4em 9.6em; gap: 0.45rem; align-items: center; padding: 0.25rem 0.5rem;
}
.mk-thead {
  white-space: nowrap; position: sticky; top: 0; z-index: 1; background: var(--ui-surface-2); color: var(--ui-muted);
}
.mk-thead > span { font-size: 0.88em; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }
.mk-actions-head { text-align: right; }
.mk-row { border-top: 1px solid var(--ui-border); color: var(--ui-text); }
.mk-row:nth-child(even) { background: color-mix(in srgb, var(--ui-surface-2) 55%, transparent); }
.mk-row[data-editing='true'] { background: color-mix(in srgb, var(--ui-accent) 12%, transparent); }
.mk-cell { min-width: 0; }
.mk-skill { overflow-wrap: anywhere; }
.mk-actions { display: flex; gap: 0.3rem; justify-content: flex-end; }
.mk-actions .mk-btn { padding: 0.2rem 0.5rem; }
.mk-tag {
  display: inline-block; margin-left: 0.35rem; padding: 0 0.3rem; border: 1px solid var(--ui-border); border-radius: 3px; color: var(--ui-muted);
  font-size: max(var(--ui-min-text-size, 12px), 0.66rem); white-space: nowrap;
}
/* The marking as the pitch draws it: the coach's font, size and colour, bold, on a dark outline over turf green. */
.mk-chip {
  display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box; min-width: 2.4em; min-height: 1.9em;
  padding: 0.1em 0.4em; border-radius: 4px; background: #2f5d34; border: 1px solid #1d3a20; font-weight: 700; line-height: 1;
  white-space: nowrap; -webkit-text-stroke: 2px #14161a; paint-order: stroke fill;
}
.mk-chip { max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
.mk-row-error { grid-column: 1 / -1; }
.mk-blank { color: var(--ui-muted); font-style: italic; }
.mk-source .mk-confirm, .mk-add .mk-confirm { border-color: var(--ui-border); }
.mk-input {
  background: var(--ui-surface); color: var(--ui-text); border: 1px solid var(--ui-border); border-radius: 4px;
  padding: 0.25rem 0.4rem; font: inherit; font-size: max(var(--ui-min-text-size, 12px), 0.76rem); width: 100%; min-width: 0; box-sizing: border-box;
}
.mk-input-marking { width: 4.5em; text-align: center; }
.mk-check { display: inline-flex; flex-direction: row; align-items: center; gap: 0.3rem; font-size: max(var(--ui-min-text-size, 12px), 0.74rem); color: var(--ui-text); white-space: nowrap; }
.mk-repeat { display: flex; margin-top: 0.2rem; color: var(--ui-muted); }

.mk-add { display: flex; flex-direction: row; flex-wrap: wrap; align-items: flex-end; gap: 0.5rem; padding-top: 0.5rem; border-top: 1px solid var(--ui-border); }
.mk-field-skills { flex: 1 1 12em; }
.mk-add .mk-status { flex-basis: 100%; }
.mk-add .mk-check { padding-bottom: 0.3rem; }

.mk-footer { display: flex; flex-wrap: wrap; align-items: center; gap: 0.6rem; padding-top: 0.5rem; border-top: 1px solid var(--ui-border); }
.mk-preview { display: inline-flex; align-items: center; gap: 0.4rem; }
.mk-preview-label, .mk-count { color: var(--ui-muted); font-size: max(var(--ui-min-text-size, 12px), 0.74rem); }
.mk-count { margin-left: auto; }
.mk-confirm {
  display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; flex-basis: 100%; padding: 0.4rem 0.55rem;
  border: 1px solid var(--ui-danger, #e05a5a); border-radius: 5px; font-size: max(var(--ui-min-text-size, 12px), 0.78rem); color: var(--ui-text);
}
.mk-confirm > span { flex: 1 1 14em; }

/* Narrow (a slim Settings pane, a large UI text size): the header row goes, each rule becomes a labelled card. */
@container (max-width: 520px) {
  .mk-thead { display: none; }
  .mk-row { grid-template-columns: auto minmax(0, 1fr); grid-auto-flow: row; row-gap: 0.3rem; padding: 0.45rem 0.5rem; }
  .mk-row .mk-cell:not(.mk-marking):not(.mk-skill):not(.mk-actions) { grid-column: 1 / -1; }
  .mk-row .mk-cell:not(.mk-marking):not(.mk-skill):not(.mk-actions)::before {
    content: attr(data-label) ': '; color: var(--ui-muted); font-size: max(var(--ui-min-text-size, 12px), 0.7rem);
  }
  .mk-actions { grid-column: 1 / -1; justify-content: flex-start; }
  .mk-count { margin-left: 0; }
}
</style>
