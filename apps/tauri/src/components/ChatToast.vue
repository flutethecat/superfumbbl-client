<script setup lang="ts">
import { computed } from 'vue';
import type { ChatToastRole } from '../game/chatAuthor';

const props = withDefaults(defineProps<{
  sender?: string;
  text: string;
  role?: ChatToastRole;
  textSize?: number;
}>(), {
  sender: '',
  role: 'neutral',
  textSize: 17,
});

defineEmits<{ open: [] }>();

const toastTextSize = computed(() => {
  const value = Number(props.textSize);
  return Number.isFinite(value) ? Math.round(Math.min(28, Math.max(12, value)) * 10) / 10 : 17;
});
const accessibleLabel = computed(() => {
  const sender = props.sender.trim() || 'Chat';
  return `${sender}: ${props.text}`;
});
</script>

<template>
  <button type="button" class="chat-toast" :class="`chat-toast--${role}`" :data-author-role="role"
    :data-text-size="toastTextSize" :style="{ '--chat-toast-text-size': `${toastTextSize}px` }"
    :aria-label="accessibleLabel" title="Open chat" @click="$emit('open')">
    <span class="chat-toast-sender">{{ sender || 'Chat' }}</span>
    <span class="chat-toast-text">{{ text }}</span>
  </button>
</template>

<style scoped>
.chat-toast.chat-toast--blue {
  --chat-deep: var(--seat-home-deep, #080c64);
  --chat-mid: var(--seat-home-mid, #003eb3);
  --chat-sheen: var(--seat-home-bright, #0058fe);
  --chat-border: var(--seat-home-text, #4a86fe);
  --chat-inner: #d9efff;
  --chat-name: #fff0cc;
  --chat-body: #f4f1e9;
  --chat-glow: var(--seat-home-bright, #0058fe);
}
.chat-toast.chat-toast--red {
  /* Keep Away unmistakably red without filling the toast with the sprite palette's
     brightest signal red. These are chat-only shades; pitch/HUD seat colors remain
     unchanged. */
  --chat-deep: #4b070b;
  --chat-mid: #851118;
  --chat-sheen: #b62c34;
  --chat-border: #d3545c;
  --chat-inner: #f3b8b5;
  --chat-name: #fff0cc;
  --chat-body: #f4f1e9;
  --chat-glow: #a6242c;
}
.chat-toast.chat-toast--green {
  --chat-deep: #041e12;
  --chat-mid: #0c4d2b;
  --chat-sheen: #1b7545;
  --chat-border: #7be4a0;
  --chat-inner: #d8ffe5;
  --chat-name: #fff0cc;
  --chat-body: #f4f1e9;
  --chat-glow: #2ac36a;
}
.chat-toast.chat-toast--neutral {
  --chat-deep: #11161d;
  --chat-mid: #29313c;
  --chat-sheen: #46515f;
  --chat-border: #b4c0ce;
  --chat-inner: #edf3f8;
  --chat-name: #fff0cc;
  --chat-body: #f4f1e9;
  --chat-glow: #77889e;
}

/* The host view still owns a neutral `.pitch-host.hud-chrome .chat-toast` skin for
   non-chat system notices. This deliberately higher-specificity root keeps an
   authored chat toast's full Final Fantasy seat frame from being flattened by
   that later host rule. */
button.chat-toast[data-author-role][data-author-role] {
  appearance: none;
  position: relative;
  isolation: isolate;
  width: max-content;
  min-width: min(240px, calc(100vw - 32px));
  max-width: min(390px, calc(100vw - 32px));
  box-sizing: border-box;
  border: 2px solid var(--chat-border);
  border-left-width: 5px;
  border-radius: 5px;
  padding: 9px 13px 10px;
  background:
    linear-gradient(150deg, rgb(255 255 255 / 0.13), transparent 34%),
    linear-gradient(180deg, var(--chat-sheen) 0, var(--chat-mid) 18%, var(--chat-deep) 100%);
  color: var(--chat-body);
  box-shadow:
    0 4px 0 #030507,
    0 8px 20px rgb(0 0 0 / 0.72),
    0 0 12px color-mix(in srgb, var(--chat-glow) 58%, transparent),
    inset 0 1px 0 rgb(255 255 255 / 0.42),
    inset 0 -2px 0 rgb(0 0 0 / 0.48);
  font: inherit;
  font-size: max(var(--ui-min-text-size, 12px), var(--chat-toast-text-size, 12px));
  text-align: left;
}
.chat-toast::before {
  content: '';
  position: absolute;
  inset: 2px;
  z-index: -1;
  border: 1px solid color-mix(in srgb, var(--chat-inner) 62%, transparent);
  border-radius: 2px;
  pointer-events: none;
}
.chat-toast:is(.chat-toast--blue, .chat-toast--red, .chat-toast--green, .chat-toast--neutral):hover {
  border-color: var(--chat-inner);
  filter: brightness(1.1);
}
.chat-toast:focus-visible {
  outline: 3px solid var(--chat-inner);
  outline-offset: 3px;
}
.chat-toast-sender {
  display: block;
  overflow-wrap: anywhere;
  color: var(--chat-name);
  font-weight: 900;
  letter-spacing: 0.045em;
  text-shadow: 0 1px 0 #000, 0 0 6px var(--chat-glow);
}
.chat-toast-text {
  display: -webkit-box;
  overflow: hidden;
  color: var(--chat-body);
  line-height: 1.35;
  text-overflow: ellipsis;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}
</style>
