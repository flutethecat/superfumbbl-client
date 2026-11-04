import { ref, type Ref } from 'vue';

export type Locale = 'en' | 'en-GB' | 'bg' | 'cy' | 'de' | 'es' | 'fr' | 'ga' | 'gd' | 'it' | 'nl' | 'pl' | 'ru' | 'sr-Cyrl' | 'sr-Latn' | 'uk' | 'zh-Hans';

/** The single active-locale ref, shared by t() (index.ts) and terms() (terms.ts) without an import cycle. A Vue ref:
 *  anything rendered through t()/terms() re-renders when it changes. */
export const localeRef: Ref<Locale> = ref<Locale>('en');
