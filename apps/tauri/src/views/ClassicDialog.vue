<script lang="ts">
/**
 * FC3 — the FUMBBL Classic dialog framework (docs/fumbbl-classic-mode-plan.md §2).
 *
 * ONE reusable grey Swing-style panel (title bar + body slot + a button row with
 * underlined MNEMONICS and keyboard bindings), fed by thin per-rail adapters in
 * ClassicView off the SAME store states the default UI answers. Per §A5b every
 * dialog is MOVABLE (drag the title bar) + RESIZABLE (CSS resize on the panel).
 * The overlay does NOT capture pointer events (only the panel does) so the pitch
 * stays live — classic dialogs float near the action, they don't black out the
 * game. Positioned centre by default; anchor-to-square positioning is FC4.
 *
 * READ-ONLY mode (spectator / opposition coach) renders the buttons inert — the
 * same surface reads identically from every seat (§A0).
 */
export interface ClassicDialogButton {
  id: string;
  label: string;
  /** single char — underlined in the label + bound to that key */
  mnemonic?: string;
  kind?: 'default' | 'confirm' | 'decline';
  disabled?: boolean;
  /** the made selection GLOWS activation-gold (§A0) — e.g. a spectator watching
   *  the coach's pick land before downstream events render. */
  chosen?: boolean;
}
</script>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

const props = withDefaults(
  defineProps<{ title: string; buttons: ClassicDialogButton[]; readonly?: boolean; width?: number; anchor?: { x: number; y: number } | null }>(),
  { readonly: false, width: 320, anchor: null },
);
const emit = defineEmits<{ (e: 'pick', id: string): void }>();

// --- movable (drag the title bar). pos=null → centred via CSS transform. ---
const pos = ref<{ x: number; y: number } | null>(null);
const dragging = ref(false);
let start = { mx: 0, my: 0, px: 0, py: 0 };
function onDragStart(e: PointerEvent) {
  const host = (e.currentTarget as HTMLElement).closest('.cd-panel') as HTMLElement | null;
  if (!host) return;
  const r = host.getBoundingClientRect();
  pos.value = pos.value ?? { x: r.left, y: r.top };
  dragging.value = true;
  start = { mx: e.clientX, my: e.clientY, px: pos.value.x, py: pos.value.y };
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
}
function onDragMove(e: PointerEvent) {
  if (!dragging.value || !pos.value) return;
  pos.value = { x: start.px + (e.clientX - start.mx), y: start.py + (e.clientY - start.my) };
}
function onDragEnd(e: PointerEvent) {
  dragging.value = false;
  try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* not captured */ }
}
const panelStyle = computed(() => {
  // dragged position wins; else anchor NEAR the action square (offset to the right
  // + up so it doesn't cover it, clamped on-screen); else centred via CSS.
  if (pos.value) return { left: `${pos.value.x}px`, top: `${pos.value.y}px`, width: `${props.width}px`, transform: 'none' };
  if (props.anchor) {
    const x = Math.min(Math.max(props.anchor.x + 30, 8), Math.max(8, window.innerWidth - props.width - 10));
    const y = Math.min(Math.max(props.anchor.y - 34, 46), Math.max(46, window.innerHeight - 150));
    return { left: `${x}px`, top: `${y}px`, width: `${props.width}px`, transform: 'none' };
  }
  return { width: `${props.width}px` };
});

function pick(b: ClassicDialogButton) {
  if (props.readonly || b.disabled) return;
  emit('pick', b.id);
}

// --- mnemonic keyboard (T = Team Re-Roll, P = Pro …). ---
function onKey(e: KeyboardEvent) {
  if (props.readonly || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  const b = props.buttons.find((x) => x.mnemonic?.toLowerCase() === k && !x.disabled);
  if (b) { e.preventDefault(); emit('pick', b.id); }
}
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));

/** Split a label around the FIRST occurrence of its mnemonic char (for underline). */
function labelParts(b: ClassicDialogButton): { t: string; u: boolean }[] {
  if (!b.mnemonic) return [{ t: b.label, u: false }];
  const idx = b.label.toLowerCase().indexOf(b.mnemonic.toLowerCase());
  if (idx < 0) return [{ t: b.label, u: false }];
  return [
    { t: b.label.slice(0, idx), u: false },
    { t: b.label.slice(idx, idx + 1), u: true },
    { t: b.label.slice(idx + 1), u: false },
  ].filter((p) => p.t.length > 0);
}
</script>

<template>
  <div class="cd-overlay">
    <div class="cd-panel" :class="{ 'cd-readonly': readonly }" :style="panelStyle">
      <div class="cd-title" @pointerdown="onDragStart" @pointermove="onDragMove" @pointerup="onDragEnd" @pointercancel="onDragEnd">
        <span class="cd-title-txt">{{ title }}</span>
      </div>
      <div class="cd-body"><slot /></div>
      <div class="cd-buttons">
        <button v-for="b in buttons" :key="b.id" class="cd-btn" type="button"
          :data-kind="b.kind || 'default'" :data-chosen="b.chosen ? 'true' : 'false'"
          :disabled="readonly || b.disabled" @click="pick(b)">
          <template v-for="(p, i) in labelParts(b)" :key="i"><u v-if="p.u">{{ p.t }}</u><template v-else>{{ p.t }}</template></template>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Non-blocking overlay: only the panel takes pointer events, so the pitch stays
   interactive behind a floating classic dialog. */
.cd-overlay { position: fixed; inset: 0; z-index: 120; pointer-events: none; }
.cd-panel {
  position: fixed; left: 50%; top: 42%; transform: translate(-50%, -50%);
  pointer-events: auto;
  min-width: 200px; min-height: 90px; max-width: 90vw; max-height: 80vh;
  display: flex; flex-direction: column;
  background: #d8d4cc; color: #000; /* owner 2026-07-08: all dialog text BLACK for readability */
  border: 2px solid #3a3a36; border-radius: 3px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.55);
  font-family: Arial, Helvetica, sans-serif;
  resize: both; overflow: auto; /* §A5b: resizable */
}
.cd-title {
  flex: 0 0 auto; cursor: move; user-select: none;
  padding: 0.28rem 0.55rem; font-size: max(var(--ui-min-primary-text-size, 16px), 0.8rem); font-weight: 700; letter-spacing: 0.02em;
  color: #000; /* black title on a light Swing title bar (readable) */
  background: linear-gradient(180deg, #cfcbc0, #bcb7ac);
  border-bottom: 1px solid #9a958b;
}
.cd-body {
  flex: 1 1 auto; min-height: 0; overflow: auto;
  padding: 0.6rem 0.7rem; font-size: max(var(--ui-min-primary-text-size, 16px), 0.82rem); line-height: 1.4;
}
.cd-buttons {
  flex: 0 0 auto; display: flex; flex-wrap: wrap; gap: 0.4rem; justify-content: flex-end;
  padding: 0.5rem 0.6rem; background: #cbc6bc; border-top: 1px solid #a8a399;
}
.cd-btn {
  padding: 0.3rem 0.7rem; font-size: max(var(--ui-min-primary-text-size, 16px), 0.8rem); cursor: pointer;
  background: linear-gradient(180deg, #f4f1ea, #ddd8ce);
  color: #000; border: 1px solid #8a857b; border-radius: 3px;
}
.cd-btn:hover:not(:disabled) { background: linear-gradient(180deg, #fffdf7, #e6e1d7); }
.cd-btn:disabled { opacity: 0.5; cursor: default; }
/* owner 2026-07-08: labels stay BLACK; the coloured border carries confirm/decline. */
.cd-btn[data-kind='confirm'] { border-color: #4c7a4c; }
.cd-btn[data-kind='decline'] { border-color: #9a4141; }
/* §A0: the made selection GLOWS activation-gold. */
.cd-btn[data-chosen='true'] {
  border-color: #b8942f; background: linear-gradient(180deg, #fbeec2, #f0d98f);
  box-shadow: 0 0 0 2px rgba(245, 197, 66, 0.55); animation: cd-chosen-pulse 0.7s ease-in-out infinite alternate;
}
@keyframes cd-chosen-pulse { from { box-shadow: 0 0 0 1px rgba(245, 197, 66, 0.35); } to { box-shadow: 0 0 0 3px rgba(245, 197, 66, 0.7); } }
.cd-btn u { text-underline-offset: 2px; }
.cd-readonly .cd-btn { cursor: default; }
</style>
