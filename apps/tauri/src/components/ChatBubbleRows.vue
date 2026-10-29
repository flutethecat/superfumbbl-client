<script setup lang="ts">
/**
 * Owner 10-16 (Chat style "Bubbles"): the chat entries as message bubbles, rendered INSIDE SpectateView's
 * `<pre ref="chatEl" class="log chat-log chat-bubbles">` (the pre keeps the scroll, the stick-to-bottom follow and
 * onLogScroll; the pre's CSS anchors the stack to the bottom). The bubble frame takes the chat toasts' look
 * (ChatToast.vue: 5 px radius, 2 px edge with a 5 px left edge, inner highlight, cream name over warm white text) at
 * the pane's text size, shaded with a dark version of the speaker's seat colour (game/chatBubbles.ts).
 * No whitespace between tags on purpose: the parent is a <pre>.
 */
import type { ChatBubbleRow } from '../game/chatBubbles';
import ChatEmojiText from './ChatEmojiText.vue';

defineProps<{
  rows: readonly ChatBubbleRow[];
  /** settings.logTimestamps: the HH:MM stamp, muted, inside the bubble. */
  timestamps: boolean;
  /** Per-row time strings (same index as rows). */
  times: readonly (string | undefined)[];
  /** Perf (JLeav 1.0.296): per-row keys (same index as rows): the entry's identity, so a capped chat does not shift
   *  every bubble by one. Without them a row is keyed by its index, as before. */
  keys?: readonly (number | string)[];
}>();
</script>

<template><span v-for="(row, i) in rows" :key="keys?.[i] ?? i" class="chat-bubble" data-kind="talk" :data-side="row.side" :data-chained="row.chained ? 'true' : undefined" :style="row.style"><span v-if="(row.name && !row.chained) || (timestamps && times[i])" class="chat-bubble-head"><span v-if="row.name && !row.chained" class="chat-bubble-name">{{ row.name }}</span><span v-if="timestamps && times[i]" class="chat-bubble-time">{{ times[i] }}</span></span><span class="chat-bubble-text"><ChatEmojiText :text="row.rest" /></span></span></template>

<style scoped>
.chat-bubble {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.15em;
  flex: none;
  box-sizing: border-box;
  max-width: 100%;
  margin-top: 0.45em;
  border: 2px solid var(--chat-bubble-edge, #b4c0ce);
  border-left-width: 5px;
  border-radius: 5px;
  padding: 0.35em 0.65em 0.4em;
  background:
    linear-gradient(150deg, rgb(255 255 255 / 0.1), transparent 34%),
    linear-gradient(180deg, var(--chat-bubble-mid, #29313c) 0, var(--chat-bubble-deep, #11161d) 100%);
  color: #f4f1e9;
  box-shadow:
    0 2px 0 #030507,
    inset 0 1px 0 rgb(255 255 255 / 0.32),
    inset 0 -2px 0 rgb(0 0 0 / 0.42);
  white-space: normal;
  text-align: left;
}
/* a run from one speaker sits tighter and drops the name label */
.chat-bubble[data-chained='true'] { margin-top: 0.2em; }
.chat-bubble-head {
  display: flex;
  align-items: baseline;
  gap: 0.6em;
  min-width: 0;
}
.chat-bubble-name {
  overflow-wrap: anywhere;
  font-family: var(--font-display);
  font-size: 0.9em;
  font-weight: 900;
  letter-spacing: 0.045em;
  color: #fff0cc;
  text-shadow: 0 1px 0 #000, 0 0 6px var(--chat-bubble-edge, #77889e);
}
/* muted, pushed to the right of the name (alone on the head row when the name collapses) */
.chat-bubble-time {
  margin-left: auto;
  font-size: max(var(--ui-min-text-size, 12px), 0.78em);
  color: #f4f1e9;
  opacity: 0.55;
  white-space: nowrap;
}
.chat-bubble-text {
  color: #f4f1e9;
  line-height: 1.35;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
