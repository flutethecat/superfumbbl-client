<script setup lang="ts">
import { computed } from 'vue';
import {
  projectBlockChooser,
  type BlockChooserGameLike,
  type BlockChooserSide,
} from '../game/blockChooser';

const props = defineProps<{
  game: BlockChooserGameLike | null | undefined;
  choosingTeamId: unknown;
  localSeat: BlockChooserSide | null;
  spectator: boolean;
}>();

const chooser = computed(() => projectBlockChooser(props.game, props.choosingTeamId, props.localSeat, props.spectator));
</script>

<template>
  <div class="block-chooser-copy" role="status" :data-mine="chooser.mine" :data-side="chooser.side ?? 'unknown'">
    <template v-if="chooser.mine">Your Choice</template>
    <template v-else>
      <span class="block-chooser-name" :class="chooser.spectator && chooser.side ? `block-chooser-name--${chooser.side}` : null">{{ chooser.coachName }}</span><span> is choosing</span>
    </template>
  </div>
</template>

<style scoped>
.block-chooser-copy { text-align: center; font-weight: 800; letter-spacing: 0.02em; }
/* Seat colours apply only for a spectator. Keep the neutral suffix outside this span. */
.block-chooser-name--home { color: var(--seat-home-text, #4a86fe); text-shadow: 0 0 6px var(--seat-home-mid, #003eb3); }
.block-chooser-name--away { color: var(--seat-away-text, #fe6666); text-shadow: 0 0 6px var(--seat-away-mid, #b30000); }
</style>
