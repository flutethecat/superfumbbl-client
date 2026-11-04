<script setup lang="ts">
/**
 * Esc > Game statistics: the three-column grid (home / labels / away) the Game Menu shows in place of its buttons
 * (owner 09-22, the end-of-game Statistics tab's rules). Shared by the Retro and Modern menus (owner 11-03 restyle), so
 * both styles render the same rows; the .pg-stats styles live in App.vue's global style block.
 */
import type { PgStatRow } from '../game/gameStatRows';

export interface GameMenuStatsData { home: { team: string; logo: string }; away: { team: string; logo: string }; rows: readonly PgStatRow[] }
defineProps<{ stats: GameMenuStatsData }>();
</script>

<template>
  <div class="pg-stats">
    <div class="pg-stats-cols">
      <div class="pg-stat-col pg-bevel" data-side="home">
        <div class="pg-stat-col-head"><img :src="stats.home.logo" :alt="stats.home.team" /></div>
        <div v-for="row in stats.rows" :key="row.key" class="pg-stat-cell pg-h" :data-lead="row.homeLead">{{ row.home }}</div>
      </div>
      <div class="pg-stat-col pg-bevel" data-side="label">
        <div class="pg-stat-col-head"></div>
        <div v-for="row in stats.rows" :key="row.key" class="pg-stat-cell pg-stat-label">{{ row.label }}</div>
      </div>
      <div class="pg-stat-col pg-bevel" data-side="away">
        <div class="pg-stat-col-head"><img :src="stats.away.logo" :alt="stats.away.team" /></div>
        <div v-for="row in stats.rows" :key="row.key" class="pg-stat-cell pg-a" :data-lead="row.awayLead">{{ row.away }}</div>
      </div>
    </div>
  </div>
</template>
