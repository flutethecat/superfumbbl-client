import { watch } from 'vue';
import { notifyPitchLabelsChanged, setPitchLabelProvider } from '@fumbbl40k/ffb-pitch';
import { currentLocale, t } from '../i18n';

/**
 * i18n 10-23 (Astra r1 #6): the words the pitch canvas draws, localised. The pitch package asks for an English label at
 * draw time (packages/ffb-pitch/src/pitchLabels.ts); this maps it to a catalogue key. Labels not listed stay English
 * (abbreviations such as MA / ST / GFI and the single-letter roll tags are deliberately not translated).
 */
const PITCH_LABEL_KEYS: Readonly<Record<string, string>> = {
  'TOUCHDOWN': 'pitch.touchdown',
  'RESERVES': 'pitch.reserves',
  'INJURED': 'pitch.injured',
  'APOTHECARY': 'pitch.apothecary',
  'BALL': 'pitch.ball',
  'ACTIVE': 'pitch.active',
  'K.O.': 'pitch.ko',
  'STUNNED': 'pitch.stunned',
  'MISS': 'pitch.miss',
  'Pick-me-up?': 'pitch.pickMeUp',
  'OUT OF BOUNDS': 'pitch.outOfBounds',
  'TOUCHBACK': 'pitch.touchback',
  'ARMOR BREAKS!': 'pitch.armorBreaks',
  'FAILED': 'pitch.failed',
  'USED!': 'pitch.used',
  'REROLLING?': 'pitch.rerolling',
  'QUICK': 'pitch.passQuick',
  'SHORT': 'pitch.passShort',
  'LONG': 'pitch.passLong',
  'LONG BOMB': 'pitch.passLongBomb',
  'BEYOND LB': 'pitch.passBeyond',
  'Player Down!': 'pitch.blockPlayerDown',
  'Both Down': 'pitch.blockBothDown',
  'Push Back': 'pitch.blockPushBack',
  'Stumble!': 'pitch.blockStumble',
  'POW!': 'pitch.blockPow',
  'RUSH': 'pitch.tagRush',
  'DODGE': 'pitch.tagDodge',
  'JUMP': 'pitch.tagJump',
  'LEAP': 'pitch.tagLeap',
  'POGO': 'pitch.tagPogo',
  'PICKUP': 'pitch.tagPickup',
  'TRAPDOOR': 'pitch.tagTrapdoor', // move batching decision 13: the trapdoor path chip
};

let installed = false;
/** Installs the provider once and redraws the pitch's words on every language change. */
export function installPitchLabels(): void {
  if (installed) return;
  installed = true;
  setPitchLabelProvider((english) => {
    const key = PITCH_LABEL_KEYS[english];
    return key ? t(key) : english;
  });
  watch(currentLocale, () => notifyPitchLabelsChanged());
}
