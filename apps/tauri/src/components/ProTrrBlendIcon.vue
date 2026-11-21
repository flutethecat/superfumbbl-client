<script setup lang="ts">
// Owner 11-21: "Can we do an icon for Pro + TRR that's a blend of the Pro icon and TRR icon? Just a / running through
// it. Half the helmet in the top left, TRR in the bottom right?"
// Built at render time from the two art sources the Pro and Team reroll buttons use (the caller passes exactly those
// URLs: the Pro skill icon via skillIconUrl('Pro'), the Team reroll art via resourceIcon('re_roll')), so it follows
// whatever art packs / restyles resolve them to; no image of its own. Two stacked layers clipped by a "/" diagonal
// (bottom-left to top-right): Pro above it (top-left), Team reroll below it (bottom-right), and a thin two-tone line on
// the split that reads on both halves. Decorative: the BUTTON carries the accessible name and the hover title.
defineProps<{ proSrc: string; trrSrc: string }>();
</script>

<template>
  <span class="pt-blend" aria-hidden="true" data-testid="pro-trr-blend">
    <img class="pt-pro" :src="proSrc" alt="" draggable="false" data-testid="pro-trr-blend-pro" />
    <img class="pt-trr" :src="trrSrc" alt="" draggable="false" data-testid="pro-trr-blend-trr" />
    <svg class="pt-slash" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <line x1="2" y1="98" x2="98" y2="2" class="pt-slash-under" />
      <line x1="2" y1="98" x2="98" y2="2" class="pt-slash-over" />
    </svg>
  </span>
</template>

<style scoped>
/* The caller sizes the root (width / height); the default matches a 30 px option icon. */
.pt-blend {
  position: relative; display: inline-block; flex: none; width: 30px; height: 30px;
  filter: drop-shadow(0 4px 5px #000c) drop-shadow(0 1px 2px #0009);
}
.pt-blend img {
  position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; image-rendering: pixelated;
}
/* "/" runs bottom-left (0 100%) to top-right (100% 0): Pro keeps the triangle above it, Team reroll the one below. */
.pt-pro { clip-path: polygon(0 0, 100% 0, 0 100%); }
.pt-trr { clip-path: polygon(100% 0, 100% 100%, 0 100%); }
.pt-slash { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
.pt-slash line { vector-effect: non-scaling-stroke; stroke-linecap: round; }
/* Dark under-stroke + light over-stroke: reads on the helmet, the die art and either panel face (Modern / Retro). */
.pt-slash-under { stroke: #000c; stroke-width: 3.5px; }
.pt-slash-over { stroke: #f4f1e8; stroke-width: 1.5px; }
</style>
