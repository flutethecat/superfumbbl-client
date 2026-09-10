<script setup lang="ts">
defineProps<{
  playerName: string;
  portrait: string | null;
  skills: string[];
  interactive?: boolean;
}>();

defineEmits<{ choose: [skill: string] }>();
</script>

<template>
  <div class="intensive-training-choice" data-testid="intensive-training-choice">
    <div class="intensive-player">
      <img v-if="portrait" class="intensive-portrait" :src="portrait" :alt="`${playerName} sprite`" />
      <span v-else class="intensive-portrait intensive-portrait-fallback" aria-hidden="true">🏋️</span>
      <span class="intensive-player-copy">
        <strong>{{ playerName }}</strong>
        <span>Choose a Primary skill</span>
      </span>
    </div>
    <div v-if="interactive" class="intensive-skill-list" aria-label="Primary skill selection">
      <button v-for="skill in skills" :key="skill" type="button" @click="$emit('choose', skill)">
        {{ skill }}
      </button>
      <span v-if="skills.length === 0" class="intensive-empty">No Primary skills offered</span>
    </div>
  </div>
</template>

<style scoped>
.intensive-training-choice { display: grid; gap: 0.7rem; min-width: 16rem; }
.intensive-player { display: flex; align-items: center; gap: 0.75rem; }
.intensive-portrait {
  width: 4.5rem;
  height: 4.5rem;
  flex: 0 0 4.5rem;
  object-fit: contain;
  image-rendering: pixelated;
  border: 1px solid #d9ae43;
  border-radius: 0.45rem;
  background: #101217;
  box-shadow: 0 0 0.8rem #d9ae4344;
}
.intensive-portrait-fallback { display: grid; place-items: center; font-size: max(var(--ui-min-primary-text-size, 16px), 2rem); }
.intensive-player-copy { display: grid; gap: 0.2rem; text-align: left; }
.intensive-player-copy strong { color: #fff1c7; font-size: max(var(--ui-min-primary-text-size, 16px), 1rem); }
.intensive-player-copy span { color: #f0c85c; font-size: max(var(--ui-min-text-size, 12px), 0.78rem); letter-spacing: 0.08em; text-transform: uppercase; }
.intensive-skill-list { display: flex; flex-wrap: wrap; justify-content: center; gap: 0.45rem; }
.intensive-skill-list button {
  padding: 0.45rem 0.7rem;
  color: #fff4d2;
  background: #324056;
  border: 1px solid #d9ae43;
  border-radius: 0.4rem;
  cursor: pointer;
}
.intensive-empty { color: #b8af9a; }
</style>
