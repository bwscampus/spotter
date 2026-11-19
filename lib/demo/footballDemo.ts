import type { GamePlayerRow, GameRosterRow } from "@/lib/game/buildGame";

// =============================================================================
// The public demo's game (Nov 19, the UX overhaul's Phase 1): two made-up high
// school football teams with full season stats, and a scripted stretch of
// play-by-play. Every name is invented (the repo's rule: no real names in a
// fixture). Pure data; lib/demo/demoGame.ts turns it into a game the real
// engine reads, exactly as Start does for a saved one.
//
// Jerseys never repeat across the two teams, so a cued number in the script
// has one answer. Each script line says which cards it should put up, and a
// line that must stay quiet says why; test/demo.test.ts holds every line to it
// through the real engine.
// =============================================================================

export const DEMO_HOME: GameRosterRow = { id: "demo-home", school: "Harborview", mascot: "Hawks", sport: "football", primary_color: "#0b2d5b" };
export const DEMO_AWAY: GameRosterRow = { id: "demo-away", school: "Millbrook", mascot: "Miners", sport: "football", primary_color: "#b3202a" };

type Stats = Record<string, number>;

interface DemoPlayer {
  jersey: string;
  first: string;
  last: string;
  position: string;
  stats?: Stats;
  facts?: string[];
  /** How to say it, shown big on the card ("koh-WALL-chik"). */
  say?: string;
  /** Spotting off, as an offensive lineman starts. */
  off?: boolean;
}

const HOME_PLAYERS: DemoPlayer[] = [
  {
    jersey: "12",
    first: "Cole",
    last: "Brannigan",
    position: "QB",
    stats: { gp: 8, pass_cmp: 142, pass_att: 221, pass_yds: 2104, pass_td: 21, pass_int: 5, rush_att: 41, rush_yds: 188, rush_td: 3 },
    facts: ["Committed to Weber State", "4 TD passes last week"],
  },
  {
    jersey: "22",
    first: "Marcus",
    last: "Langan",
    position: "RB",
    stats: { gp: 8, rush_att: 131, rush_yds: 1012, rush_td: 13, rec: 14, rec_yds: 121, rec_td: 1 },
    facts: ["Second straight 1,000-yard season"],
  },
  { jersey: "4", first: "Jaylen", last: "Quintero", position: "WR", stats: { gp: 8, rec: 41, rec_yds: 712, rec_td: 8, kr: 9, kr_yds: 231 } },
  { jersey: "81", first: "Theo", last: "Halvorsen", position: "TE", stats: { gp: 8, rec: 22, rec_yds: 260, rec_td: 3 } },
  { jersey: "3", first: "Andre", last: "Pruitt", position: "WR", stats: { gp: 8, rec: 30, rec_yds: 455, rec_td: 4, pr: 11, pr_yds: 120 } },
  { jersey: "32", first: "Kenji", last: "Arceneaux", position: "RB", stats: { gp: 7, rush_att: 44, rush_yds: 260, rush_td: 2 } },
  {
    jersey: "55",
    first: "Ike",
    last: "Nwachukwu",
    position: "LB",
    say: "wah-CHOO-koo",
    stats: { gp: 8, tkl: 74, sacks: 6, sack_yds: 41, ff: 2 },
    facts: ["Team captain"],
  },
  { jersey: "44", first: "Sam", last: "Tillman", position: "LB", stats: { gp: 8, tkl: 58, def_int: 1, pbu: 3 } },
  { jersey: "24", first: "Dre", last: "Ashby", position: "CB", stats: { gp: 8, tkl: 31, def_int: 4, int_ret_yds: 88, int_td: 1, pbu: 9 } },
  { jersey: "90", first: "Bo", last: "Dunleavy", position: "DL", stats: { gp: 8, tkl: 39, sacks: 8, sack_yds: 52 } },
  { jersey: "17", first: "Luis", last: "Saldana", position: "K", stats: { gp: 8, fgm: 9, fga: 11, fg_long: 46, xpm: 31, xpa: 32 } },
  { jersey: "8", first: "Rafe", last: "Castellano", position: "S", stats: { gp: 8, tkl: 47, def_int: 2, pbu: 5 } },
  { jersey: "9", first: "Evan", last: "Prewitt", position: "S", stats: { gp: 8, tkl: 35, pbu: 2 } },
  { jersey: "76", first: "Garrett", last: "Holm", position: "OL", off: true },
];

const AWAY_PLAYERS: DemoPlayer[] = [
  {
    jersey: "10",
    first: "Trey",
    last: "Kowalczyk",
    position: "QB",
    say: "koh-WALL-chik",
    stats: { gp: 8, pass_cmp: 118, pass_att: 199, pass_yds: 1655, pass_td: 14, pass_int: 7, rush_att: 60, rush_yds: 310, rush_td: 4 },
    facts: ["Junior, second year starting"],
  },
  { jersey: "28", first: "Darius", last: "Kettering", position: "RB", stats: { gp: 8, rush_att: 112, rush_yds: 744, rush_td: 8 } },
  { jersey: "11", first: "Kai", last: "Thornbury", position: "WR", stats: { gp: 8, rec: 37, rec_yds: 598, rec_td: 6 } },
  { jersey: "2", first: "Nate", last: "Okonjo", position: "WR", stats: { gp: 8, rec: 25, rec_yds: 340, rec_td: 3, kr: 14, kr_yds: 298 } },
  { jersey: "21", first: "Jalen", last: "Brisco", position: "RB", stats: { gp: 6, rush_att: 30, rush_yds: 150, kr: 6, kr_yds: 131 } },
  { jersey: "50", first: "Owen", last: "Brandt", position: "LB", stats: { gp: 8, tkl: 81, sacks: 4, ff: 1 }, facts: ["Leads the league in tackles"] },
  { jersey: "47", first: "Mason", last: "Coyle", position: "LB", stats: { gp: 8, tkl: 44 } },
  { jersey: "6", first: "Malik", last: "Serrano", position: "CB", stats: { gp: 8, tkl: 29, def_int: 3, pbu: 7 } },
  { jersey: "99", first: "Cyrus", last: "Abara", position: "DL", stats: { gp: 8, tkl: 33, sacks: 7 } },
  { jersey: "33", first: "Reggie", last: "Tran", position: "S", stats: { gp: 8, tkl: 52, def_int: 2 } },
  {
    jersey: "19",
    first: "Josh",
    last: "Lindqvist",
    position: "K/P",
    stats: { gp: 8, fgm: 6, fga: 9, fg_long: 41, xpm: 22, xpa: 24, punts: 31, punt_yds: 1240 },
  },
  { jersey: "72", first: "Victor", last: "Paz", position: "OL", off: true },
];

function rows(roster: GameRosterRow, players: DemoPlayer[]): GamePlayerRow[] {
  return players.map((player, index) => ({
    id: `${roster.id}-${index}`,
    roster_id: roster.id,
    jersey: player.jersey,
    first_name: player.first,
    last_name: player.last,
    position: player.position,
    grade: null,
    height: null,
    weight: null,
    pronunciations: player.say ? [player.say] : [],
    heard_as: [],
    facts: player.facts ?? [],
    spoken_forms: [],
    spot_mode: player.off ? "off" : "normal",
    season_stats: player.stats ?? null,
    season_lines: [],
    stats_as_of: "2026-11-14",
  }));
}

export const DEMO_PLAYER_ROWS: GamePlayerRow[] = [...rows(DEMO_HOME, HOME_PLAYERS), ...rows(DEMO_AWAY, AWAY_PLAYERS)];

/** One line of the booth, as the speech engine writes it: lowercase, numbers as digits. */
export interface ScriptLine {
  said: string;
  /** Surnames whose cards this line puts up; empty for a line that must stay quiet. */
  cards: string[];
  /** For a quiet line: why nothing goes up, shown beside it ("Score"). */
  quiet?: string;
}

export const DEMO_SCRIPT: ScriptLine[] = [
  { said: "good evening and welcome to harborview for hawks and miners football", cards: [], quiet: "Team names, no player" },
  { said: "lindqvist kicks it deep", cards: ["Lindqvist"] },
  { said: "returned by quintero out to the 30", cards: ["Quintero"] },
  { said: "first and 10 hawks at their own 30", cards: [], quiet: "Down and distance" },
  { said: "brannigan hands it to langan up the middle", cards: ["Brannigan", "Langan"] },
  { said: "second and 4", cards: [], quiet: "Down and distance" },
  { said: "brannigan looks deep and finds pruitt at midfield", cards: ["Brannigan", "Pruitt"] },
  { said: "brought down by number 6 serrano", cards: ["Serrano"] },
  { said: "langan again breaks a tackle and picks up 12 more", cards: ["Langan"] },
  { said: "number 81 halvorsen in motion", cards: ["Halvorsen"] },
  { said: "brannigan to halvorsen touchdown hawks", cards: ["Brannigan", "Halvorsen"] },
  { said: "saldana adds the extra point", cards: ["Saldana"] },
  { said: "hawks lead 7 to 0", cards: [], quiet: "Score" },
  { said: "kowalczyk under center for the miners", cards: ["Kowalczyk"] },
  { said: "handoff to kettering who is stopped by nwachukwu", cards: ["Kettering", "Nwachukwu"] },
  { said: "third and 7 at the 28", cards: [], quiet: "Down and field position" },
  { said: "kowalczyk throws to thornbury for the first down", cards: ["Kowalczyk", "Thornbury"] },
  { said: "and he is sacked by number 90 dunleavy", cards: ["Dunleavy"] },
  { said: "dunleavy now has 9 sacks this season", cards: ["Dunleavy"] },
  { said: "12 minutes left in the second quarter", cards: [], quiet: "Clock" },
  { said: "lindqvist on to punt", cards: ["Lindqvist"] },
  { said: "fair catch by pruitt", cards: ["Pruitt"] },
  { said: "arceneaux comes in with fresh legs at running back", cards: ["Arceneaux"] },
  { said: "brannigan rolls out and throws for quintero caught at the 40", cards: ["Brannigan", "Quintero"] },
  { said: "a gain of 18", cards: [], quiet: "Yards" },
  { said: "intercepted by number 33 tran", cards: ["Tran"] },
  { said: "brisco on the first down carry", cards: ["Brisco"] },
  { said: "ashby breaks it up", cards: ["Ashby"] },
  { said: "number 55 nwachukwu on the blitz", cards: ["Nwachukwu"] },
  { said: "kowalczyk to okonjo along the sideline", cards: ["Kowalczyk", "Okonjo"] },
  { said: "castellano with the hit", cards: ["Castellano"] },
  { said: "fourth and 1 and the miners will go for it", cards: [], quiet: "Down and distance" },
  { said: "prewitt makes the stop short of the line", cards: ["Prewitt"] },
  { said: "hawks ball with 2 minutes to go in the half", cards: [], quiet: "Clock" },
  { said: "brandt with the tackle", cards: ["Brandt"] },
  { said: "brannigan finds langan in the flat touchdown", cards: ["Brannigan", "Langan"] },
  { said: "saldana is good again and it is 14 to 0", cards: ["Saldana"] },
  { said: "coyle and abara combine on the stop", cards: ["Coyle", "Abara"] },
  { said: "number 44 tillman in on the play as well", cards: ["Tillman"] },
];
