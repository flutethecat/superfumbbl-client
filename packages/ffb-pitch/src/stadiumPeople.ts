/**
 * Owner 11-21: the stadium's people - fans in the stands, and the referees, cheerleaders and assistant coaches beside
 * the pitch. One PNG per figure under `assets/stadium/people/<facing>/<role>-<id>.png`, cut from two generated sheets:
 * `front` faces the viewer, `back` faces away, `side` is in profile FACING RIGHT (mirror it for a figure facing left).
 */
export type PersonFacing = 'front' | 'side' | 'back';
export type PersonRole = 'fan' | 'cheer' | 'coach' | 'ref';

export interface PersonSprite { url: string; facing: PersonFacing; role: PersonRole; id: string }

const URLS = import.meta.glob<string>('../assets/stadium/people/*/*.png', { eager: true, query: '?url', import: 'default' });

const FACINGS: readonly PersonFacing[] = ['front', 'side', 'back'];
const ROLES: readonly PersonRole[] = ['fan', 'cheer', 'coach', 'ref'];

/** Every figure, in a stable order (facing, then file name): indices into this list are stable across builds. */
export const STADIUM_PEOPLE: readonly PersonSprite[] = Object.freeze(Object.entries(URLS)
  .map(([path, url]) => {
    const match = /\/people\/(front|side|back)\/(fan|cheer|coach|ref)-([^/]+)\.png$/.exec(path);
    return match ? { url, facing: match[1] as PersonFacing, role: match[2] as PersonRole, id: match[3]! } : null;
  })
  .filter((p): p is PersonSprite => !!p)
  .sort((a, b) => FACINGS.indexOf(a.facing) - FACINGS.indexOf(b.facing) || ROLES.indexOf(a.role) - ROLES.indexOf(b.role) || a.id.localeCompare(b.id)));

/** The figures of one role, in STADIUM_PEOPLE order. */
export function peopleWithRole(role: PersonRole): PersonSprite[] {
  return STADIUM_PEOPLE.filter((p) => p.role === role);
}

/**
 * Which sprite set shows a figure facing ground direction `toward` (x, z / game x, y), given where that direction lands
 * on the screen (`screen`: its screen-space x and y, y growing DOWN). Mostly up the screen = facing away (back), mostly
 * down = facing the viewer (front), sideways = profile; `flip` mirrors the right-facing profile art for a figure facing
 * left.
 */
export function facingOnScreen(screen: { x: number; y: number }): { facing: PersonFacing; flip: boolean } {
  if (Math.abs(screen.x) >= Math.abs(screen.y)) return { facing: 'side', flip: screen.x < 0 };
  return { facing: screen.y < 0 ? 'back' : 'front', flip: false };
}

/** Index lists into `pool` per facing (a facing with no figure borrows `front`). */
export function indicesByFacing(pool: readonly Pick<PersonSprite, 'facing'>[]): Record<PersonFacing, number[]> {
  const out: Record<PersonFacing, number[]> = { front: [], side: [], back: [] };
  pool.forEach((p, i) => out[p.facing].push(i));
  for (const f of FACINGS) if (out[f].length === 0) out[f] = out.front.length ? out.front : pool.map((_, i) => i);
  return out;
}
