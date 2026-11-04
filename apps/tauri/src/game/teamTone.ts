// Owner 11-03 (spec-client-restyle-and-team-port, lane 3): the colour each side of a Modern result card fades in.
//
// Every card side's tint goes through this ONE function. Owner pick (11-03): the RACE colour, from the League
// Manager's race table (game/raceTone.ts, vendored verbatim), fed by the race (roster) name the card already shows.
// A team with no race, or one the table does not know, gets the table's dark fallback. The card keeps the League
// Manager's diagonal gradient (styles/lm-blades.css .lm-card, from its result-card.css .rc-card).
import { raceTone } from './raceTone';

export interface TeamToneSource {
  name?: string;
  race?: string;
}

/** The side's tint colour: its race's colour, or the race table's fallback. */
export function teamTone(team: TeamToneSource | null | undefined): string {
  return raceTone(team?.race);
}
