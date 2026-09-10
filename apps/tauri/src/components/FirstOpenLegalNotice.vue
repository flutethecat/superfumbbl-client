<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue';
import { CHRISTER_MIT_LICENSE, FUMBBL_CONTRIBUTION_CODE_NOTICE } from '../game/legalNotice';

defineProps<{
  clientLicense: string;
  busy?: boolean;
  error?: string;
}>();

const emit = defineEmits<{ acknowledge: [] }>();
const dialog = ref<HTMLElement | null>(null);
const legalText = ref<HTMLElement | null>(null);
const acknowledged = ref(false);

function focusableElements(): HTMLElement[] {
  if (!dialog.value) return [];
  return Array.from(dialog.value.querySelectorAll<HTMLElement>(
    'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])',
  )).filter((element) => !element.hasAttribute('hidden'));
}

function trapFocus(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  if (event.key !== 'Tab') return;
  const focusable = focusableElements();
  if (!focusable.length) return;
  const first = focusable[0]!;
  const last = focusable[focusable.length - 1]!;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

onMounted(() => {
  void nextTick(() => legalText.value?.focus());
});
</script>

<template>
  <div class="legal-backdrop">
    <section
      ref="dialog"
      class="legal-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="first-open-legal-title"
      aria-describedby="first-open-legal-intro"
      @keydown="trapFocus"
    >
      <header class="legal-header">
        <h1 id="first-open-legal-title">License acknowledgement</h1>
        <p id="first-open-legal-intro">
          Please review the licenses that apply to Super FUMBBL and the upstream FFB work it incorporates.
        </p>
      </header>

      <div ref="legalText" class="legal-scroll" tabindex="0" aria-label="Software license text">
        <article>
          <h2>Super FUMBBL client</h2>
          <pre>{{ clientLicense }}</pre>
        </article>
        <article>
          <h2>FUMBBL contribution — Christer Kaivo-oja</h2>
          <pre>{{ CHRISTER_MIT_LICENSE }}</pre>
        </article>
        <article class="legal-attribution">
          <h2>Contributions and asset attribution</h2>
          <p>{{ FUMBBL_CONTRIBUTION_CODE_NOTICE }}</p>
          <p>
            FUMBBL media assets have separate contribution and redistribution terms. The full
            mirrored contributor credits and asset-license policy ship in Settings → About and
            the repository's ATTRIBUTION.md file.
          </p>
        </article>
      </div>

      <footer class="legal-footer">
        <label class="legal-check">
          <input v-model="acknowledged" type="checkbox" :disabled="busy" />
          <span>I have read and acknowledge these license notices.</span>
        </label>
        <p v-if="error" class="legal-error" role="alert">{{ error }}</p>
        <button
          type="button"
          class="legal-continue"
          :disabled="!acknowledged || busy"
          :aria-busy="busy || undefined"
          @click="emit('acknowledge')"
        >{{ busy ? 'Saving…' : 'Acknowledge and continue' }}</button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.legal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: grid;
  place-items: center;
  box-sizing: border-box;
  padding: clamp(12px, 3vw, 32px);
  background: #050706f2;
  color: var(--ui-text, #f2f2ec);
  font-family: Arial, Helvetica, sans-serif;
  font-size: max(var(--ui-min-text-size, 12px), 12px);
}

.legal-dialog {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  width: min(880px, 100%);
  height: min(760px, 100%);
  min-height: 0;
  overflow: hidden;
  background: var(--ui-surface, #101411);
  border: 2px solid var(--ui-primary, #a10005);
  border-radius: 10px;
  box-shadow: 0 18px 70px #000e, inset 0 0 0 1px #ffffff12;
}

.legal-header,
.legal-footer {
  padding: 16px 20px;
  background: var(--ui-surface-2, #171c18);
}

.legal-header {
  border-bottom: 1px solid var(--ui-border, #4a514a);
}

.legal-header h1,
.legal-scroll h2 {
  margin: 0;
  font-family: 'Nuffle', Arial, Helvetica, sans-serif;
  line-height: 1.2;
}

.legal-header h1 {
  color: var(--ui-primary, #e35151);
  font-size: max(var(--ui-min-primary-text-size, 16px), 22px);
}

.legal-header p {
  margin: 7px 0 0;
  color: var(--ui-muted, #c4cbc4);
  line-height: 1.45;
}

.legal-scroll {
  min-height: 0;
  overflow: auto;
  padding: 18px 20px 28px;
  scrollbar-color: var(--ui-primary, #a10005) var(--ui-surface-2, #171c18);
}

.legal-scroll:focus-visible {
  outline: 2px solid var(--ui-accent, #f0be42);
  outline-offset: -3px;
}

.legal-scroll article + article {
  margin-top: 24px;
  padding-top: 22px;
  border-top: 1px solid var(--ui-border, #4a514a);
}

.legal-scroll h2 {
  margin-bottom: 10px;
  color: var(--ui-accent, #f0be42);
  font-size: max(var(--ui-min-primary-text-size, 16px), 16px);
}

.legal-scroll pre {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--ui-text, #f2f2ec);
  font: inherit;
  font-size: max(var(--ui-min-text-size, 12px), 12px);
  line-height: 1.5;
}

.legal-attribution p {
  margin: 8px 0 0;
  color: var(--ui-muted, #c4cbc4);
  font-size: max(var(--ui-min-text-size, 12px), 12px);
  line-height: 1.5;
}

.legal-footer {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px 18px;
  align-items: center;
  border-top: 1px solid var(--ui-border, #4a514a);
}

.legal-check {
  display: flex;
  gap: 9px;
  align-items: flex-start;
  line-height: 1.4;
  cursor: pointer;
}

.legal-check input {
  flex: 0 0 auto;
  width: 17px;
  height: 17px;
  margin: 1px 0 0;
  accent-color: var(--ui-primary, #a10005);
}

.legal-continue {
  min-height: 38px;
  padding: 8px 16px;
  border: 1px solid var(--ui-accent, #d86767);
  border-radius: 6px;
  color: var(--ui-text-on-primary, #fff);
  background: var(--ui-primary, #a10005);
  font: inherit;
  font-weight: 700;
}

.legal-continue:disabled {
  cursor: not-allowed;
  opacity: 0.48;
}

.legal-continue:focus-visible,
.legal-check input:focus-visible {
  outline: 2px solid var(--ui-accent, #f0be42);
  outline-offset: 2px;
}

.legal-error {
  grid-column: 1 / -1;
  margin: 0;
  color: #ff8a8a;
  line-height: 1.4;
}

@media (max-width: 640px) {
  .legal-footer { grid-template-columns: 1fr; }
  .legal-continue { width: 100%; }
}
</style>
