/**
 * PASS TARGETING SWITCH (owner 2026-11-13, parity of play: "Match upstream for the pass actions. While it is legal
 * under the rules, we should ensure a parity of play doctrine."). Upstream's behaviour ships: in PASS_MOVE a click
 * throws only at a team-mate who can catch (bb2025 / mixed PassLogicModule.playerInteraction:40-61, canPlayerGetPass
 * :127-138) and a square click walks (fieldInteraction:63-69 delegates to Move); a throw at any other square needs the
 * PASS action, reached through the "Pass Ball (any square)" row (LogicModule.isPassAnySquareAvailable:613-616).
 *
 * The previous behaviour (owner ruling A.5, "the pass target is a SQUARE": in passMove a click on ANY player or open
 * square in range throws there, plus the #252 free-select "Throw Pass") is KEPT behind this switch, OFF, because the
 * owner is proposing it to the FFB developers (owner 11-13: "Leave it in the code base however. I'll surface this to
 * the ffb dev team for inclusion."); it can be turned on if upstream adopts it.
 *
 * Not a setting, no runtime toggle of any kind, never persisted: one compile-time constant. availableActions'
 * passTargetAllowed / passAnySquareAvailable read it, and through them the router (order66Interaction), the target marks
 * and hover readout (SpectateView), the free-select arm and the send backstop (store), so the two behaviours cannot
 * drift apart. Its own module so a test can flip it (vi.mock) to keep the kept code exercised.
 */
export const PASS_CLICK_THROWS_AT_ANY_PLAYER_SQUARE = false;
