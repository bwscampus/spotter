import type { ExtractAnswer } from "./schema";

// =============================================================================
// Fourteen worked examples for the per-play extractor (v7, Part 5), in the
// cached prefix after the system prompt. Each is the game state, the lines
// as the transcript would write them, the candidate list and the answer.
// Every name and team here is made up (non-negotiable 4: no real roster in a
// static prompt): the Ridgeline Hawks (home) and the Castor Bay Pilots
// (away). The patterns are the ones the dev games taught: a plain run, a run
// with only a number, "hauls it in", a named target on an incompletion,
// "broken up by", a sack, a scramble, an interception, a flag that wipes the
// play, a TV play nobody is named on, the analyst naming another player in
// replay talk, a shared surname settled by position, a touchdown run, and a
// first-down call with "picks up 12". Byte-identical for the whole game.
// =============================================================================

export interface WorkedExample {
  title: string;
  state: string;
  lines: Array<{ role: "pre" | "play" | "post"; text: string }>;
  candidates: string[];
  answer: ExtractAnswer;
}

const HAWKS_QB = "1: #12 Orrin Teague QB HOME [prior:qb]";

export const WORKED_EXAMPLES: WorkedExample[] = [
  {
    title: "A plain run",
    state: "Ridgeline (home) has the ball, 1st and 10 at the Ridgeline 31.",
    lines: [
      { role: "pre", text: "first and 10 at the 31" },
      { role: "play", text: "teague hands off to marchetti up the middle picks up 6" },
      { role: "play", text: "brought down by draper" },
      { role: "post", text: "second and 4" },
    ],
    candidates: [HAWKS_QB, "2: #28 Dez Marchetti RB HOME", "3: #44 Hollis Draper LB AWAY", "0: NOT_NAMED"],
    answer: { playType: "rush", carrierIdx: 2, passerIdx: null, receiverIdx: null, tacklerIdx: 3, yardsSaid: 6, touchdown: false, penalty: "none", confidence: "high" },
  },
  {
    title: "A run with only a jersey number",
    state: "Ridgeline (home) has the ball, 2nd and 4.",
    lines: [
      { role: "play", text: "number 34 takes it off the left side out to the 40" },
      { role: "play", text: "wrapped up by roarke" },
    ],
    candidates: [HAWKS_QB, "2: #34 Rowan Pike RB HOME [by jersey]", "3: #23 Anselm Roarke S AWAY", "0: NOT_NAMED"],
    answer: { playType: "rush", carrierIdx: 2, passerIdx: null, receiverIdx: null, tacklerIdx: 3, yardsSaid: null, touchdown: false, penalty: "none", confidence: "high" },
  },
  {
    title: "A completion, hauls it in",
    state: "Ridgeline (home) has the ball, 1st and 10 at the Ridgeline 40.",
    lines: [
      { role: "play", text: "teague fires to lindqvist who hauls it in at the 45 for a gain of 14" },
      { role: "post", text: "first down hawks" },
    ],
    candidates: [HAWKS_QB, "2: #5 Kai Lindqvist WR HOME", "0: NOT_NAMED"],
    answer: { playType: "pass_complete", carrierIdx: null, passerIdx: 1, receiverIdx: 2, tacklerIdx: null, yardsSaid: 14, touchdown: false, penalty: "none", confidence: "high" },
  },
  {
    title: "An incompletion with a named target",
    state: "Ridgeline (home) has the ball, 2nd and 8.",
    lines: [{ role: "play", text: "teague looking for okafor brandt over the middle and it falls incomplete" }],
    candidates: [HAWKS_QB, "2: #80 Emeka Okafor-Brandt TE HOME", "0: NOT_NAMED"],
    answer: { playType: "pass_incomplete", carrierIdx: null, passerIdx: 1, receiverIdx: 2, tacklerIdx: null, yardsSaid: null, touchdown: false, penalty: "none", confidence: "high" },
  },
  {
    title: "An incompletion, broken up by",
    state: "Castor Bay (away) has the ball, 3rd and 6.",
    lines: [{ role: "play", text: "vasquez throws for harlan broken up by villanueva" }],
    candidates: ["1: #9 Luca Vasquez QB AWAY [prior:qb]", "2: #7 Teddy Harlan WR AWAY", "3: #2 Cato Villanueva CB HOME", "0: NOT_NAMED"],
    answer: { playType: "pass_incomplete", carrierIdx: null, passerIdx: 1, receiverIdx: 2, tacklerIdx: 3, yardsSaid: null, touchdown: false, penalty: "none", confidence: "high" },
  },
  {
    title: "A sack",
    state: "Ridgeline (home) has the ball, 3rd and 9.",
    lines: [{ role: "play", text: "teague drops back pressure from draper and he is brought down behind the line for a loss of 7" }],
    candidates: [HAWKS_QB, "2: #44 Hollis Draper LB AWAY", "0: NOT_NAMED"],
    answer: { playType: "sack", carrierIdx: 1, passerIdx: null, receiverIdx: null, tacklerIdx: 2, yardsSaid: -7, touchdown: false, penalty: "none", confidence: "high" },
  },
  {
    title: "A scramble",
    state: "Castor Bay (away) has the ball, 2nd and 7.",
    lines: [
      { role: "play", text: "vasquez can't find anyone takes off and scrambles for 9" },
      { role: "play", text: "pushed out of bounds by villanueva" },
    ],
    candidates: ["1: #9 Luca Vasquez QB AWAY [prior:qb]", "2: #2 Cato Villanueva CB HOME", "0: NOT_NAMED"],
    answer: { playType: "rush", carrierIdx: 1, passerIdx: null, receiverIdx: null, tacklerIdx: 2, yardsSaid: 9, touchdown: false, penalty: "none", confidence: "high" },
  },
  {
    title: "An interception",
    state: "Ridgeline (home) has the ball, 1st and 10.",
    lines: [{ role: "play", text: "teague throws deep and it's picked off by roarke at the 20" }],
    candidates: [HAWKS_QB, "2: #23 Anselm Roarke S AWAY", "0: NOT_NAMED"],
    answer: { playType: "interception", carrierIdx: null, passerIdx: 1, receiverIdx: 2, tacklerIdx: null, yardsSaid: null, touchdown: false, penalty: "none", confidence: "high" },
  },
  {
    title: "A flag that wipes the play out",
    state: "Ridgeline (home) has the ball, 1st and 10.",
    lines: [
      { role: "play", text: "marchetti breaks free for 20 but there's a flag" },
      { role: "play", text: "holding on the offense that'll come back" },
    ],
    candidates: [HAWKS_QB, "2: #28 Dez Marchetti RB HOME", "0: NOT_NAMED"],
    answer: { playType: "no_play", carrierIdx: 2, passerIdx: null, receiverIdx: null, tacklerIdx: null, yardsSaid: 20, touchdown: false, penalty: "offense", confidence: "high" },
  },
  {
    title: "A play nobody is named on",
    state: "Ridgeline (home) has the ball, 1st and 10.",
    lines: [
      { role: "play", text: "they hand it off and it's stuffed at the line" },
      { role: "post", text: "second down coming up" },
    ],
    candidates: [HAWKS_QB, "0: NOT_NAMED"],
    answer: { playType: "rush", carrierIdx: 0, passerIdx: null, receiverIdx: null, tacklerIdx: null, yardsSaid: null, touchdown: false, penalty: "none", confidence: "medium" },
  },
  {
    title: "The analyst names another player in replay talk",
    state: "Ridgeline (home) has the ball, 2nd and 5.",
    lines: [
      { role: "play", text: "teague throws to lindqvist caught at the 30 gain of 8" },
      { role: "post", text: "on the replay look at okafor brandt's block that sprung him" },
    ],
    candidates: [HAWKS_QB, "2: #5 Kai Lindqvist WR HOME", "3: #80 Emeka Okafor-Brandt TE HOME", "0: NOT_NAMED"],
    answer: { playType: "pass_complete", carrierIdx: null, passerIdx: 1, receiverIdx: 2, tacklerIdx: null, yardsSaid: 8, touchdown: false, penalty: "none", confidence: "high" },
  },
  {
    title: "A shared surname, settled by position",
    state: "Castor Bay (away) has the ball, 1st and 10.",
    lines: [{ role: "play", text: "vasquez throws to harlan complete to the 35" }],
    candidates: ["1: #9 Luca Vasquez QB AWAY [prior:qb]", "2: #7 Teddy Harlan WR AWAY [same surname]", "3: #56 Vic Harlan DE AWAY [same surname]", "0: NOT_NAMED"],
    answer: { playType: "pass_complete", carrierIdx: null, passerIdx: 1, receiverIdx: 2, tacklerIdx: null, yardsSaid: null, touchdown: false, penalty: "none", confidence: "medium" },
  },
  {
    title: "A touchdown run",
    state: "Castor Bay (away) has the ball, 2nd and 3 at the Ridgeline 18.",
    lines: [{ role: "play", text: "mbeki takes the handoff bounces outside and he's gone touchdown pilots" }],
    candidates: ["1: #9 Luca Vasquez QB AWAY [prior:qb]", "2: #21 Silas Mbeki RB AWAY", "0: NOT_NAMED"],
    answer: { playType: "rush", carrierIdx: 2, passerIdx: null, receiverIdx: null, tacklerIdx: null, yardsSaid: null, touchdown: true, penalty: "none", confidence: "high" },
  },
  {
    title: "A first-down call with picks up 12",
    state: "Ridgeline (home) has the ball, 2nd and 7.",
    lines: [
      { role: "pre", text: "second and 7" },
      { role: "play", text: "marchetti picks up 12 and that'll move the chains" },
      { role: "play", text: "tackled by brannigan" },
    ],
    candidates: [HAWKS_QB, "2: #28 Dez Marchetti RB HOME", "3: #52 Ike Brannigan LB AWAY", "0: NOT_NAMED"],
    answer: { playType: "rush", carrierIdx: 2, passerIdx: null, receiverIdx: null, tacklerIdx: 3, yardsSaid: 12, touchdown: false, penalty: "none", confidence: "high" },
  },
];

/** The examples as the cached prefix carries them. */
export function renderExamples(examples: readonly WorkedExample[] = WORKED_EXAMPLES): string {
  const blocks = examples.map((example, index) => {
    const lines = example.lines.map((line) => `${line.role.toUpperCase()}\t${line.text}`).join("\n");
    return `EXAMPLE ${index + 1}: ${example.title}\nGAME STATE: ${example.state}\nLINES\n${lines}\nCANDIDATES\n${example.candidates.join("\n")}\nANSWER\n${JSON.stringify(example.answer)}`;
  });
  return `WORKED EXAMPLES\nThe teams and players in these examples are made up.\n\n${blocks.join("\n\n")}`;
}
