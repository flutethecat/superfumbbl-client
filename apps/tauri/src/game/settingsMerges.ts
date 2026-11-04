/**
 * Owner 11-03 settings reflow: four pairs of rows became one select each. The stored keys stay exactly as they were
 * (other code reads them); each select is a view over its pair, so every existing combination keeps its effective
 * behaviour and nothing is migrated. `...From` reads the select's value, `...Writes` is the patch a pick applies.
 */
import type { AppSettings } from './settings';

/** "On launch show": hideWelcomeSplash + hideTutorialSplash. 'tutorial' (welcome hidden, tutorial shown) has no
 *  option of its own in the owner's list, so the select offers it only while a coach is on it. */
export type LaunchScreens = 'both' | 'welcome' | 'tutorial' | 'neither';
type LaunchKeys = Pick<AppSettings, 'hideWelcomeSplash' | 'hideTutorialSplash'>;
export function launchScreensFrom(s: LaunchKeys): LaunchScreens {
  if (s.hideWelcomeSplash) return s.hideTutorialSplash ? 'neither' : 'tutorial';
  return s.hideTutorialSplash ? 'welcome' : 'both';
}
export function launchScreensWrites(value: LaunchScreens): LaunchKeys {
  return {
    hideWelcomeSplash: value === 'tutorial' || value === 'neither',
    hideTutorialSplash: value === 'welcome' || value === 'neither',
  };
}

/** "Players stay one size across the pitch": uniformFigures (North-South) + uniformFiguresEw (East-West). */
export type UniformFiguresChoice = 'off' | 'ns' | 'ew' | 'both';
type UniformKeys = Pick<AppSettings, 'uniformFigures' | 'uniformFiguresEw'>;
export function uniformFiguresFrom(s: UniformKeys): UniformFiguresChoice {
  if (s.uniformFigures) return s.uniformFiguresEw ? 'both' : 'ns';
  return s.uniformFiguresEw ? 'ew' : 'off';
}
export function uniformFiguresWrites(value: UniformFiguresChoice): UniformKeys {
  return { uniformFigures: value === 'ns' || value === 'both', uniformFiguresEw: value === 'ew' || value === 'both' };
}

/** "Stadium": showStadium + stadiumStands. Off keeps the stored stand style, so turning the stadium back on returns
 *  the coach's stands. */
export type StadiumChoice = 'off' | AppSettings['stadiumStands'];
type StadiumKeys = Pick<AppSettings, 'showStadium' | 'stadiumStands'>;
export function stadiumFrom(s: StadiumKeys): StadiumChoice {
  return s.showStadium ? s.stadiumStands : 'off';
}
export function stadiumWrites(value: StadiumChoice): Partial<StadiumKeys> {
  return value === 'off' ? { showStadium: false } : { showStadium: true, stadiumStands: value };
}

/** "Dice in the log": logDiceAsNumbers (rolls) + logNeededAsNumbers (the roll needed). */
export type LogDiceChoice = 'dice' | 'rolls' | 'needed' | 'numbers';
type LogDiceKeys = Pick<AppSettings, 'logDiceAsNumbers' | 'logNeededAsNumbers'>;
export function logDiceFrom(s: LogDiceKeys): LogDiceChoice {
  if (s.logDiceAsNumbers) return s.logNeededAsNumbers ? 'numbers' : 'rolls';
  return s.logNeededAsNumbers ? 'needed' : 'dice';
}
export function logDiceWrites(value: LogDiceChoice): LogDiceKeys {
  return { logDiceAsNumbers: value === 'rolls' || value === 'numbers', logNeededAsNumbers: value === 'needed' || value === 'numbers' };
}
