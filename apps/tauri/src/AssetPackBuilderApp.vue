<script setup lang="ts">
import AssetPackSettings from './components/AssetPackSettings.vue';

declare const __APP_VERSION__: string;
declare const __GIT_SHA__: string;
const version = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
const source = typeof __GIT_SHA__ !== 'undefined' ? __GIT_SHA__ : 'nogit';
</script>

<template>
  <div class="asset-builder-app">
    <header class="builder-header">
      <div>
        <p class="eyebrow">Super FUMBBL tooling</p>
        <h1>F40KMod Builder</h1>
        <p>Create portable presentation packs without opening the game client.</p>
      </div>
      <div class="format-badge">F40KMOD1</div>
    </header>

    <main>
      <section class="builder-guide" aria-label="Builder workflow">
        <article><strong>1 · Create a draft</strong><span>Name the pack or reopen a saved local draft.</span></article>
        <article><strong>2 · Add media</strong><span>Assign sprites, skill icons, sounds, and pitches to exact targets.</span></article>
        <article><strong>3 · Export</strong><span>Build one category or a combined .f40kmod and validate it before sharing.</span></article>
      </section>
      <AssetPackSettings builder-mode />
    </main>

    <footer>
      <span>Builder {{ version }} · {{ source }}</span>
      <span>Files stay local. No FUMBBL CDN access is used.</span>
    </footer>
  </div>
</template>

<style>
:root{
  color-scheme:dark;--ui-bg:#090b0b;--ui-panel:#151818;--ui-panel-2:#202323;--ui-border:#762025;
  --ui-border-strong:#bf252d;--ui-text:#f3eee2;--ui-muted:#aaa59b;--ui-accent:#f0383f;--ui-gold:#d9a441;
  font-family:Arial,Helvetica,sans-serif;background:var(--ui-bg);color:var(--ui-text)
}
*{box-sizing:border-box}html,body,#app{min-width:760px;min-height:100%;margin:0;background:var(--ui-bg)}
body{min-height:100vh;background:
  linear-gradient(135deg,rgba(190,28,37,.08),transparent 42%),
  repeating-linear-gradient(0deg,transparent 0 31px,rgba(255,255,255,.018) 32px),var(--ui-bg)}
button,input,select{font:inherit}button{border:1px solid #9f2a31;border-radius:4px;background:#6f1016;color:#fff;padding:.48rem .78rem;cursor:pointer}
button:hover:not(:disabled){background:#99151e}button:disabled{cursor:not-allowed;opacity:.46}
input,select{border:1px solid #4c5050;border-radius:4px;background:#0d1010;color:var(--ui-text);padding:.46rem .55rem}
input:focus,select:focus,button:focus-visible{outline:2px solid var(--ui-gold);outline-offset:2px}
.asset-builder-app{width:min(1240px,calc(100% - 32px));margin:0 auto;padding:24px 0 18px}
.builder-header{display:flex;justify-content:space-between;gap:24px;align-items:center;padding:24px 28px;border:1px solid var(--ui-border-strong);border-radius:8px;background:linear-gradient(110deg,#151919,#240d0f);box-shadow:0 12px 38px #0009}
.builder-header h1{margin:.15rem 0;font:normal clamp(2.1rem,5vw,4.2rem)/.95 Nuffle,Impact,sans-serif;color:#ff3a42;letter-spacing:.04em;text-transform:uppercase}
.builder-header p{margin:.3rem 0;color:var(--ui-muted)}.builder-header .eyebrow{color:var(--ui-gold);font-weight:700;letter-spacing:.12em;text-transform:uppercase}
.format-badge{border:2px solid var(--ui-gold);border-radius:50%;width:118px;height:118px;display:grid;place-items:center;flex:0 0 auto;color:var(--ui-gold);font:700 1rem/1 monospace;transform:rotate(-6deg)}
main{display:grid;gap:16px;margin-top:16px}.builder-guide{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.builder-guide article{display:grid;gap:5px;padding:14px 16px;border:1px solid #393d3d;border-radius:6px;background:#121515}.builder-guide strong{color:var(--ui-gold);font-family:Nuffle,Impact,sans-serif;letter-spacing:.04em}.builder-guide span{color:var(--ui-muted);font-size:.9rem;line-height:1.35}
.settings-group{min-width:0;margin:0;padding:16px 18px 18px;border:1px solid var(--ui-border);border-radius:7px;background:rgba(22,24,24,.96)}.settings-group>legend{padding:0 8px;color:#ff474e;font:normal 1.45rem/1 Nuffle,Impact,sans-serif;letter-spacing:.04em;text-transform:uppercase}.settings-group details{margin:10px 0;border:1px solid #373b3b;border-radius:6px;background:#101212;padding:10px}.settings-group summary{cursor:pointer;color:var(--ui-gold);font:normal 1.1rem Nuffle,Impact,sans-serif}.settings-group .hint{color:var(--ui-muted);line-height:1.4}.settings-group .row{display:flex;gap:8px}.settings-group .actions{display:flex;gap:8px}.asset-creator{display:grid;gap:5px}
footer{display:flex;justify-content:space-between;gap:16px;padding:14px 4px 0;color:#777;font-size:.78rem}
@media(max-width:850px){.builder-guide{grid-template-columns:1fr}.format-badge{width:82px;height:82px}.asset-builder-app{width:min(100% - 18px,1240px)}footer{flex-direction:column}}
</style>
