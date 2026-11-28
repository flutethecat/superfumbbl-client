<script setup lang="ts">
// Owner 11-27: "No reroll should just be the TRR with the prohibited symbol around it like we used to use." No such icon
// exists in the repo's history or art (searched before drawing this), so it is composed at render time: the Team reroll
// art the reroll die controls use (the caller passes resourceIcon('re_roll'), so art packs / restyles follow) under a
// red prohibited sign drawn in code (a ring and a top-left to bottom-right bar, each over a dark under-stroke so it reads
// on the die art and on either panel face). No image of its own. Decorative: the BUTTON carries the accessible name
// and the hover title. The caller sizes the root (width / height); the default matches a 37 px reroll die.
defineProps<{ trrSrc: string }>();
</script>

<template>
  <span class="no-rr" aria-hidden="true" data-testid="no-reroll-icon">
    <img class="no-rr-die" :src="trrSrc" alt="" draggable="false" data-testid="no-reroll-icon-die" />
    <svg class="no-rr-sign" viewBox="0 0 100 100" aria-hidden="true" data-testid="no-reroll-icon-sign">
      <circle cx="50" cy="50" r="43" class="no-rr-under" />
      <line x1="20" y1="20" x2="80" y2="80" class="no-rr-under" />
      <circle cx="50" cy="50" r="43" class="no-rr-over" />
      <line x1="20" y1="20" x2="80" y2="80" class="no-rr-over" />
    </svg>
  </span>
</template>

<style scoped>
.no-rr { position: relative; display: inline-block; flex: none; width: 37px; height: 37px; }
/* Owner 11-28: the die sits fully inside the ring. The art reaches its image's edge (radius ~50.5 of 100), the ring's
   dark under-stroke starts at radius 36, so the die is drawn at 66% (radius ~33.3, a small gap inside the ring), centred. */
.no-rr-die {
  position: absolute; inset: 17%; width: 66%; height: 66%; object-fit: contain; image-rendering: pixelated;
  filter: drop-shadow(0 5px 6px #000d) drop-shadow(0 1px 2px #0009);
}
.no-rr-sign { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
.no-rr-sign circle, .no-rr-sign line { fill: none; stroke-linecap: round; }
.no-rr-under { stroke: #000b; stroke-width: 14; }
.no-rr-over { stroke: #e0302a; stroke-width: 8; }
</style>
