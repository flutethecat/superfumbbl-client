// Touch mode: what Confirm sends for each preview kind (round-3 finding 1; round-4 findings 1 and 2). Each kind has its
// own commit that submits exactly the plan on the pitch - never the old Space / Confirm-bar priority cascade.
//
// Two rules hold for every kind:
//  - A commit never substitutes a movement route. It sends the route that is drawn (with its rolls shown) or no walk
//    at all; it never computes a different contact path at Confirm. A walk-then-act target whose drawn route does not
//    serve it (does not end next to the victim / target, or puts the receiver out of range) is either retired when
//    the route is re-plotted (game/touchPreview.ts routeServes) or refused here with a reason.
//  - Every path either sends or returns a localised reason the view shows; nothing returns silently.
//
// The pure decision is here (table-tested); the view supplies the snapshot and the existing senders.

import type { TouchPreviewKind } from './touchPreview';

export type Square = [number, number];

export interface TouchCommitSnapshot {
  /** The client state of the acting player (deriveClientState). */
  state: string;
  /** The plotted route on the pitch (o66PendingMove), or null. */
  route: Square[] | null;
  /** Block / Blitz stage target and its name (for the reason). */
  aggroTarget: string | null;
  aggroTargetName?: string;
  /** The route's last square is next to the staged attack target. */
  routeEndsAdjacentToAggroTarget: boolean;
  /** The attacker already stands next to the staged target. */
  attackerAdjacentToAggroTarget?: boolean;
  /** Throw target square and kind (pass / bomb / throwTeamMate / fireball). */
  throwSquare: Square | null;
  throwKind: string | null;
  /** The pass target is in range from the route's end. */
  throwInRangeFromRouteEnd: boolean;
  /** The route's end as a square label (for the reason). */
  routeEndLabel?: string;
  /** The throw target is in the template from where the thrower stands. */
  throwInRangeFromHere?: boolean;
  puntSquare: Square | null;
  foulVictim: string | null;
  foulVictimName?: string;
  /** The route's last square is next to the foul victim. */
  routeEndsAdjacentToFoulVictim: boolean;
  /** The fouler already stands next to the victim. */
  foulerAdjacentToVictim?: boolean;
  /** The armed gaze victim can be gazed from the gazer's square now. */
  gazeConfirmable: boolean;
  /** Why the armed gaze cannot be sent now (the existing refusal text), if known. */
  gazeRefusal?: string | null;
  /** The route's last square is next to the armed gaze victim. */
  routeEndsAdjacentToGazeVictim?: boolean;
  gazeVictimName?: string;
  /** A Pass / Hand-off card armed over the plotted route (renderer armed action). */
  armedCardOverRoute: 'pass' | 'handoff' | null;
}

/** A sender returns false when it refused to send (nothing went out). */
export interface TouchCommitSenders {
  walk(route: Square[]): boolean | void;
  confirmArmedCard(): boolean | void;
  stagedAttack(): boolean | void;
  blitzWalkThenBlock(route: Square[], targetId: string): boolean | void;
  passFromRouteEnd(route: Square[], square: Square): boolean | void;
  throwFromHere(kind: string, square: Square): boolean | void;
  punt(square: Square): boolean | void;
  foulFromRoute(victimId: string, route: Square[]): boolean | void;
  foulInPlace(victimId: string): boolean | void;
  gaze(): boolean | void;
  /** The stage holder's result: a reason key when it sent nothing, else null. */
  stage(): TouchCommitReason | null;
}

export interface TouchCommitReason { key: string; params?: Record<string, string> }
export type TouchCommitResult = { sent: string } | { reason: TouchCommitReason };

/** Reasons used when a commit refuses (all localised keys). */
export const TOUCH_COMMIT_REASONS = {
  notAvailable: 'hud.touch.notAvailable',
  moveNextTo: 'hud.touch.moveNextToFirst',
  outOfRangeFrom: 'hud.text.outOfRangeFrom',
  gaze: 'hud.text.canTGazeP0',
  notSent: 'hud.touch.notSent',
  planChanged: 'hud.touch.planChanged',
  routeNotUsed: 'hud.touch.routeNotUsed',
} as const;

const refuse = (key: string, params?: Record<string, string>): TouchCommitResult => ({ reason: { key, params } });
const sent = (name: string, ok: boolean | void): TouchCommitResult => (ok === false ? refuse(TOUCH_COMMIT_REASONS.notSent) : { sent: name });

/** What Confirm sends for `kind`, or why it sends nothing. */
export function touchCommitPlan(kind: TouchPreviewKind, s: TouchCommitSnapshot, send: TouchCommitSenders): TouchCommitResult {
  const route = s.route && s.route.length > 0 ? s.route : null;
  switch (kind) {
    case 'stage': {
      const why = send.stage();
      return why ? { reason: why } : { sent: 'stage' };
    }
    case 'foul':
      if (!s.foulVictim) return refuse(TOUCH_COMMIT_REASONS.notAvailable);
      if (route && s.routeEndsAdjacentToFoulVictim) return sent('foul-from-route', send.foulFromRoute(s.foulVictim, route));
      if (!route && s.foulerAdjacentToVictim) return sent('foul-in-place', send.foulInPlace(s.foulVictim));
      // Never a contact walk computed at Confirm: the walk to the victim must be drawn first.
      return refuse(TOUCH_COMMIT_REASONS.moveNextTo, { p0: s.foulVictimName ?? '' });
    case 'aggro':
      if (s.state === 'BLITZ' && route && s.aggroTarget && s.routeEndsAdjacentToAggroTarget) {
        return sent('blitz-walk-then-block', send.blitzWalkThenBlock(route, s.aggroTarget));
      }
      if (route || (s.state === 'BLITZ' && s.attackerAdjacentToAggroTarget === false)) {
        // A drawn route that does not end at the target, or a Blitz target out of reach with no route drawn.
        return refuse(TOUCH_COMMIT_REASONS.moveNextTo, { p0: s.aggroTargetName ?? '' });
      }
      return sent('staged-attack', send.stagedAttack());
    case 'throw':
      if (!s.throwSquare || !s.throwKind) return refuse(TOUCH_COMMIT_REASONS.notAvailable);
      if (s.throwKind === 'pass' && route) {
        if (!s.throwInRangeFromRouteEnd) return refuse(TOUCH_COMMIT_REASONS.outOfRangeFrom, { p0: s.routeEndLabel ?? '' });
        return sent('pass-from-route-end', send.passFromRouteEnd(route, s.throwSquare));
      }
      if (route) return refuse(TOUCH_COMMIT_REASONS.routeNotUsed); // a bomb / team-mate landing is thrown from where he stands
      if (s.throwInRangeFromHere === false) return refuse(TOUCH_COMMIT_REASONS.notAvailable);
      return sent(`${s.throwKind}-from-here`, send.throwFromHere(s.throwKind, s.throwSquare));
    case 'gaze':
      // Round-6 finding 2: a drawn route is walked first (the victim stays armed; the gaze is its own Confirm on arrival),
      // never dropped for a gaze from here. A route that does not end next to the victim is refused.
      if (route) {
        if (!s.routeEndsAdjacentToGazeVictim) return refuse(TOUCH_COMMIT_REASONS.moveNextTo, { p0: s.gazeVictimName ?? '' });
        return sent('gaze-approach-walk', send.walk(route));
      }
      if (s.gazeConfirmable) return sent('gaze', send.gaze());
      return refuse(TOUCH_COMMIT_REASONS.gaze, { p0: s.gazeRefusal ?? '' });
    case 'punt':
      if (!s.puntSquare) return refuse(TOUCH_COMMIT_REASONS.notAvailable);
      if (route) return refuse(TOUCH_COMMIT_REASONS.routeNotUsed); // round-6 finding 2: a punt is kicked from where he stands
      return sent('punt', send.punt(s.puntSquare));
    case 'move':
      if (route && s.armedCardOverRoute) return sent(`${s.armedCardOverRoute}-card-walk-then-act`, send.confirmArmedCard());
      if (!route) return refuse(TOUCH_COMMIT_REASONS.notAvailable);
      return sent('walk', send.walk(route));
  }
}
