<script setup lang="ts">
defineProps<{
  announcement: { icon: string; text: string; lines?: string[]; seq: number } | null;
  wait: { coach: string; seq: number } | null;
  portrait?: string | null;
}>();
</script>

<template>
  <div v-if="announcement" :key="'pr-' + announcement.seq" class="masterchef-splash prayer-announcement"
    role="status" aria-live="polite">
    <span class="masterchef-icon">{{ announcement.icon }}</span>
    <img v-if="portrait" class="prayer-recipient-portrait" :src="portrait" alt="Prayer recipient sprite" />
    <span class="prayer-copy">
      <span class="masterchef-head">{{ announcement.text }}</span>
      <span v-for="line in announcement.lines ?? []" :key="line" class="prayer-effect-line">{{ line }}</span>
    </span>
  </div>
  <div v-else-if="wait" :key="'prayer-wait-' + wait.seq" class="yesno-card prayer-choice-wait"
    role="status" aria-live="polite">
    <div class="yesno-text">{{ wait.coach }} is making a Prayers to Nuffle choice…</div>
    <div class="coin-wait-sub">Waiting…</div>
  </div>
</template>

<style scoped>
.prayer-announcement {
  box-sizing: border-box;
  padding-inline: clamp(1rem, 4vw, 4rem);
}
.prayer-announcement .masterchef-icon {
  flex: 0 0 auto;
  font-size: max(var(--ui-min-primary-text-size, 16px), clamp(2.75rem, 4vw, 4rem));
  line-height: 1;
  filter: drop-shadow(0 2px 4px #000c);
}
.prayer-copy {
  display: grid;
  min-width: 0;
  max-width: min(72vw, 68rem);
  gap: 0.4rem;
}
.prayer-announcement .masterchef-head {
  color: #ffe8b0;
  font-family: 'Nuffle', system-ui, sans-serif;
  font-size: max(var(--ui-min-primary-text-size, 16px), clamp(1.75rem, 2.5vw, 2.5rem));
  font-weight: 900;
  letter-spacing: 0.04em;
  line-height: 1.08;
  overflow-wrap: anywhere;
  text-shadow: 0 2px 6px #000d;
}
.prayer-effect-line {
  color: #f2e8c8;
  font-size: max(var(--ui-min-primary-text-size, 16px), clamp(1rem, 1.4vw, 1.25rem));
  line-height: 1.3;
  overflow-wrap: anywhere;
}
.prayer-recipient-portrait {
  width: 3.5rem;
  height: 3.5rem;
  object-fit: contain;
  image-rendering: pixelated;
  border: 1px solid #e2b84c;
  border-radius: 0.35rem;
  background: #101217;
}
</style>
