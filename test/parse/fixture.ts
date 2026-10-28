// A made-up broadcast, 2,000 lines long, for the hot-path benchmark and the
// segmenter (v7, Parts 2 and 3). Seeded, so every run is the same text.
// Synthetic names only (the roster in ./roster.ts).

export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const HOME_PLAYERS = ["castellane", "fennimore", "tafita", "brown", "vantree", "pellegrosso", "okonkwo reyes"];
const AWAY_PLAYERS = ["langan", "amesbury", "ndiaye hall", "quillon", "brown", "grenville"];

const TEMPLATES: Array<(pick: (list: string[]) => string, n: (max: number) => number) => string> = [
  (p, n) => `${p(["first", "1st", "second", "2nd", "third", "3rd", "fourth", "4th"])} and ${n(10) + 1} from the ${n(45) + 5}`,
  (p, n) => `${p(HOME_PLAYERS)} hands it off to ${p(HOME_PLAYERS)} up the middle picks up ${n(9) + 1}`,
  (p, n) => `${p(HOME_PLAYERS)} drops back fires one to ${p(HOME_PLAYERS)} hauls it in at the ${n(45) + 5}`,
  (p) => `brought down by ${p(AWAY_PLAYERS)} and ${p(AWAY_PLAYERS)}`,
  (p) => `incomplete broken up by ${p(AWAY_PLAYERS)}`,
  (p, n) => `${p(AWAY_PLAYERS)} keeps it himself out to the ${n(45) + 5} and out of bounds`,
  (p, n) => `sacked by ${p(AWAY_PLAYERS)} for a loss of ${n(8) + 1}`,
  (p) => `flag on the play holding on ${p(["the offense", "the defense", "number 72", "number 55"])}`,
  () => `let's look at that again on the replay you can see him slip`,
  (p, n) => `the ${p(["sharks", "bulldogs"])} lead ${n(35)} to ${n(35)} with ${n(14)} 0${n(5)} left in the ${p(["first", "second", "third", "fourth"])}`,
  () => `brought to you by the valley credit union open a checking account today`,
  (p) => `punt is away and it's fair caught by ${p(AWAY_PLAYERS)}`,
  (p, n) => `touchdown ${p(["sharks", "bulldogs"])} ${p(HOME_PLAYERS)} walks in from ${n(20) + 1} out`,
  (p, n) => `number ${n(99) + 1} ${p(["the tailback", "the receiver", "the corner"])} on the stop at the ${n(45) + 5}`,
  (p, n) => `${p(HOME_PLAYERS)} has ${n(120) + 20} yards on ${n(15) + 3} carries tonight`,
];

export function syntheticBroadcast(lines: number, seed = 7): string[] {
  const random = seeded(seed);
  const pick = (list: string[]) => list[Math.floor(random() * list.length)];
  const n = (max: number) => Math.floor(random() * max);
  const out: string[] = [];
  for (let i = 0; i < lines; i++) out.push(TEMPLATES[Math.floor(random() * TEMPLATES.length)](pick, n));
  return out;
}
