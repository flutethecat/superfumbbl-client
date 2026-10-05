<script setup lang="ts">
/** Beta launch splash (owner 10-05): shown FIRST on EVERY launch, in both editions, ahead of the
 *  first-open intro / legal / contributions gate. Informational only — no persistence, no
 *  "don't show again"; dismissing sends nothing and writes no setting. The parent owns visibility
 *  with a single ref and unmounts this on `dismiss`. Chrome mirrors FirstOpenLegalNotice. */
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';

const emit = defineEmits<{ dismiss: [] }>();
const continueButton = ref<HTMLButtonElement | null>(null);
let dismissed = false;

function dismiss(): void {
  if (dismissed) return; // Enter's keydown and a native click must not double-fire.
  dismissed = true;
  emit('dismiss');
}

function onButtonKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  dismiss();
}

// Window-level (capture) so Escape works even when focus has left the card (e.g. a backdrop click),
// and Tab can never move focus to anything behind the modal.
function onWindowKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    dismiss();
  } else if (event.key === 'Tab') {
    event.preventDefault();
    continueButton.value?.focus();
  }
}

onMounted(() => {
  window.addEventListener('keydown', onWindowKeydown, true);
  void nextTick(() => continueButton.value?.focus());
});
onBeforeUnmount(() => window.removeEventListener('keydown', onWindowKeydown, true));
</script>

<template>
  <div class="beta-backdrop" data-testid="beta-launch-splash">
    <section
      class="beta-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="beta-launch-splash-title"
      aria-describedby="beta-launch-splash-body"
    >
      <header class="beta-header">
        <h1 id="beta-launch-splash-title">THIS CLIENT IS IN BETA</h1>
      </header>
      <div id="beta-launch-splash-body" class="beta-body">
        <p>This is a third-party client and is not officially supported by the FUMBBL team. Use this at your own risk in the live FUMBBL environment. If you encounter any bugs then please click the REPORT button in the bottom right hand of the client during a game.</p>
        <p>Otherwise, please reach out to flutethecat on Discord.</p>
      </div>
      <footer class="beta-footer">
        <button
          ref="continueButton"
          type="button"
          class="beta-continue"
          data-testid="beta-launch-splash-continue"
          @keydown="onButtonKeydown"
          @click="dismiss"
        >Continue ▸</button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
/* Same chrome as FirstOpenLegalNotice: near-black backdrop, surface card with the primary
   border, surface-2 header/footer bands, Nuffle heading in primary, primary CTA. */
.beta-backdrop {
  position: fixed;
  inset: 0;
  z-index: 13000;
  display: grid;
  place-items: center;
  box-sizing: border-box;
  padding: clamp(12px, 3vw, 32px);
  background: #050706f2;
  color: var(--ui-text, #f2f2ec);
  font-family: Arial, Helvetica, sans-serif;
  font-size: max(var(--ui-min-text-size, 12px), 12px);
}

.beta-dialog {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  width: min(640px, 100%);
  max-height: 100%;
  min-height: 0;
  overflow: hidden;
  background: var(--ui-surface, #101411);
  border: 2px solid var(--ui-primary, #a10005);
  border-radius: 10px;
  box-shadow: 0 18px 70px #000e, inset 0 0 0 1px #ffffff12;
}

.beta-header,
.beta-footer {
  padding: 16px 20px;
  background: var(--ui-surface-2, #171c18);
}

.beta-header {
  border-bottom: 1px solid var(--ui-border, #4a514a);
}

.beta-header h1 {
  margin: 0;
  /* --ui-heading = the theme's section-header red, nudged to clear 4.5:1 on the surface (game/theme.ts);
     the raw primary the legal notice uses reads too dark on the surface-2 band. */
  color: var(--ui-heading, #ff3b3b);
  font-family: 'Nuffle', Arial, Helvetica, sans-serif;
  font-size: max(var(--ui-min-primary-text-size, 16px), 26px);
  line-height: 1.2;
  letter-spacing: 0.04em;
  overflow-wrap: anywhere;
}

.beta-body {
  min-height: 0;
  overflow: auto;
  padding: 18px 20px 22px;
  scrollbar-color: var(--ui-primary, #a10005) var(--ui-surface-2, #171c18);
}

.beta-body p {
  margin: 0;
  color: var(--ui-text, #f2f2ec);
  font-size: max(var(--ui-min-primary-text-size, 16px), 16px);
  line-height: 1.5;
}

.beta-body p + p {
  margin-top: 12px;
  color: var(--ui-muted, #c4cbc4);
}

.beta-footer {
  display: flex;
  justify-content: flex-end;
  border-top: 1px solid var(--ui-border, #4a514a);
}

.beta-continue {
  min-height: 38px;
  padding: 8px 22px;
  border: 1px solid var(--ui-accent, #d86767);
  border-radius: 6px;
  color: var(--ui-text-on-primary, #fff);
  background: var(--ui-primary, #a10005);
  font: inherit;
  font-size: max(var(--ui-min-primary-text-size, 16px), 16px);
  font-weight: 700;
  letter-spacing: 0.05em;
  cursor: pointer;
}

.beta-continue:hover {
  background: var(--ui-active, var(--ui-primary, #a10005));
}

.beta-continue:focus-visible {
  outline: 2px solid var(--ui-accent, #f0be42);
  outline-offset: 2px;
}

@media (max-width: 640px) {
  .beta-continue { width: 100%; }
}
</style>
