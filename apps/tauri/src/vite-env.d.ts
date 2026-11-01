/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>;
  export default component;
}

/** Owner 09-10: build edition (vite define) — true in the private fork tree, false in the public export. */
declare const __FORK_EDITION__: boolean;

interface ImportMetaEnv {
  /** Owner 10-31: FORK edition dev builds only (untracked apps/tauri/.env.local); forced empty in public builds. */
  readonly VITE_FORK_SERVER_HOST?: string;
}
