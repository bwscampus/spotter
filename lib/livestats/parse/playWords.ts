// =============================================================================
// The words a play is described with (v7, Part 2): one lexicon per thing the
// segmenter and the candidate builder need to know about a line. Whole words
// and short phrases, deliberately plain: "wraps him up" is a tackle, "falls
// incomplete" is an incompletion, "let's look at that again" is a replay.
// Pure, synchronous, one regex pass per lexicon.
// =============================================================================

export interface PlayCues {
  rush: boolean;
  pass: boolean;
  complete: boolean;
  incomplete: boolean;
  sack: boolean;
  turnover: boolean;
  penalty: boolean;
  /** The play is over: brought down, out of bounds, touchdown, first down, incomplete. */
  result: boolean;
  tackle: boolean;
  touchdown: boolean;
  firstDown: boolean;
  kick: boolean;
  /** A replay or a recap: "let's look at that again", "on the replay". */
  replay: boolean;
  /** The snap: "snap", "under center", "in the shotgun", "takes the snap". */
  snap: boolean;
  /** Any play word at all: the line sounds like football. */
  any: boolean;
  /** Which lexicons matched, for the log. */
  matched: string[];
}

const LEXICON: Array<{ key: keyof Omit<PlayCues, "any" | "matched" | "result">; pattern: RegExp }> = [
  {
    key: "rush",
    pattern:
      /\b(?:hand(?:s|ed)?\s?(?:it\s)?off|handoff|handoffs|keeper|keeps it|keeps|scramble[sd]?|scrambling|up the middle|off (?:the )?(?:left|right) (?:side|end|tackle|guard)|sweep|sweeps|carr(?:y|ies|ied)|runs? (?:it|the ball|up|off|around|to the)|rush(?:es|ed|ing)?|pitch(?:es|ed)?|toss(?:es|ed)?|draw play|draw|dive|counter|read option|option|qb (?:keep|sneak)|sneak|takes the handoff|ground game|run(?:s|ning)? (?:play|game)|bounces (?:it )?outside|plunge[sd]?)\b/,
  },
  {
    key: "pass",
    pattern:
      /\b(?:throw[sn]?|threw|throwing|fires?|fired|drops? back|dropping back|pass(?:es|ed|ing)?|looks? (?:deep|downfield|for)|airs? it out|lobs?|tosses it (?:up|to)|slant|screen|play action|play-action|launches|hits? (?:him|his|the)|finds? (?:him|his)|delivers|dumps? (?:it )?off|checks? (?:it )?down|zips?|rifles?|heaves?|goes deep|deep ball|over the middle|out route|flag route|post route|fade|crossing route|looking for|targets?|targeted)\b/,
  },
  {
    key: "complete",
    pattern: /\b(?:caught|catch(?:es)?|hauls? (?:it )?in|hauled (?:it )?in|reception|grabs?|grabbed|complete(?:d|s|ion)?|snags?|snagged|pulls? (?:it )?in|brings? (?:it )?in|reels? (?:it )?in|makes the catch|comes down with|gather(?:s|ed)? it in|connects|picks? it up at)\b/,
  },
  {
    key: "incomplete",
    pattern:
      /\b(?:incomplete|incompletion|falls incomplete|broken up|breaks it up|knocked (?:away|down)|knocks it (?:away|down)|dropped|drops it|drop|overthrown|overthrows?|underthrown|under thrown|off target|sails|out of (?:his )?reach|batted|bats it|swats?|swatted|throws? it away|thrown away|throwaway|intentional grounding|spike[sd]?|couldn't (?:hold|hang) on|can't hang on|off (?:his|the) (?:hands|fingertips)|too (?:high|low|far|long)|nobody there|no one there|falls to the (?:turf|ground)|hits the (?:turf|ground))\b/,
  },
  {
    key: "sack",
    pattern: /\b(?:sack(?:s|ed)?|brought down behind the line|dropped (?:him )?for a loss|tackled in the backfield|caught (?:him )?in the backfield|drops him|takes him down (?:in the backfield|behind the line)|got to (?:the quarterback|him first)|pressure gets home|strip sack)\b/,
  },
  {
    key: "turnover",
    pattern: /\b(?:intercept(?:s|ed|ion)?|pick(?:s|ed)? (?:it )?off|picked|pick six|picks it|fumble[sd]?|fumbling|coughs it up|puts it on the (?:turf|ground)|ball(?:'s| is)? loose|loose ball|recover(?:s|ed|y)?|jumps on it|falls on it|scoops|strip(?:s|ped)?|takeaway|turnover|turns it over|gives it away)\b/,
  },
  {
    key: "penalty",
    pattern: /\b(?:flag|flags|penalty|penalties|holding|false start|offside[s]?|off sides|encroachment|pass interference|interference|illegal (?:formation|motion|shift|contact|block|hands|procedure|substitution|use)|delay of game|facemask|face mask|roughing|unnecessary roughness|personal foul|foul|unsportsmanlike|targeting|block in the back|chop block|clipping|no play|replay the down|marked off|first down by penalty|automatic first down|declined?|accepted|laundry on the field|yellow (?:flag|laundry))\b/,
  },
  {
    key: "tackle",
    pattern:
      /\b(?:tackl(?:e[sd]?|ing)|brought down|brings? (?:him|them)? ?down|wraps? (?:him|them)? ?up|wrapped (?:him )?up|drags? (?:him )?down|dragged (?:him )?down|takes? (?:him|them) down|taken down|stuffed|stuffs|stops? (?:him|them) (?:at|short|cold|there|for)|stopped (?:at|short|cold|there|for)|met (?:at|by|in)|gets? (?:him|them) (?:to the ground|down|on the ground)|cleans? (?:it|him) up|pushed out|pushes? (?:him )?out|shoved out|knocked out of bounds|ran out of bounds|runs out of bounds|steps out|forced out|hit (?:at|by)|upended|flattened|hauls? him down|chased down|run down|tripped up|shoestring|gang tackle|swarmed|smothered|blown up|lowers? the boom)\b/,
  },
  {
    key: "touchdown",
    pattern: /\b(?:touchdown|touch down|td|takes it to the house|to the house|in for six|six points|scores?|scored|scoring|paydirt|pay dirt|end zone|endzone|crosses the (?:goal line|plane)|breaks the plane|walks? in|strolls? in)\b/,
  },
  {
    key: "firstDown",
    pattern: /\b(?:first down|1st down|moves? the chains|move the sticks|fresh set of downs|new set of downs|converts?|converted|conversion|picks up the first|gets the first|has the first|past the (?:marker|sticks|line to gain)|beyond the marker)\b/,
  },
  {
    key: "kick",
    pattern: /\b(?:punt(?:s|ed|er|ing)?|kick(?:s|ed|er|off|ing)?|field goal|extra point|pat|point after|two[- ]point|2 point|fair catch|touchback|returns?|returned|returner|onside|squib|boots? it|upright[s]?|good from|no good|wide (?:left|right)|blocked)\b/,
  },
  {
    key: "replay",
    pattern: /\b(?:look at (?:that|it|this) again|take another look|another look|on the replay|replay|on the review|under review|let's (?:see|watch) (?:that|it) again|watch (?:that|it|this) again|slow it down|from (?:this|another|the other) angle|here you see|as you (?:can )?see|that was|on that (?:play|run|catch|throw)|earlier (?:play|run|catch|throw)|a moment ago|previous play|last play|recap|to recap|so far tonight|so far today|on the drive|drive summary)\b/,
  },
  {
    key: "snap",
    pattern: /\b(?:snap(?:s|ped)?|under center|in the shotgun|from the shotgun|shotgun|pistol|at the line|lines? up|lined up|lining up|breaks? the huddle|out of the huddle|comes? to the line|up to the line|motion|in motion|empty backfield|trips (?:left|right)|hard count|cadence|play clock)\b/,
  },
];

/** Lines that end a play on their own: the ball is down, out, or across. */
const RESULT = /\b(?:brought down|tackled|out of bounds|incomplete|touchdown|sacked|first down|1st down|stopped|stuffed|wrapped up|wraps him up|down at the|downed|knee|kneels?|steps out|pushed out|forced out|fair catch|touchback|no gain|loss of|gain of|picks up|picked off|intercepted|fumble|recovered|good from|no good|wide (?:left|right)|hits the (?:turf|ground)|falls to the (?:turf|ground)|broken up|batted|dropped|overthrown|thrown away|swatted|knocked (?:down|away)|whistle|ruled)\b/;

/** Penalty phrases that carry a play word inside them: read as the flag, not the play. */
const PENALTY_PHRASES = /\b(?:pass interference|illegal (?:forward )?pass|intentional grounding|running into the (?:kicker|punter)|roughing the (?:passer|kicker|punter))\b/g;

export function playCues(text: string): PlayCues {
  const lower = text.toLowerCase().replace(PENALTY_PHRASES, "foul");
  const cues: PlayCues = {
    rush: false,
    pass: false,
    complete: false,
    incomplete: false,
    sack: false,
    turnover: false,
    penalty: false,
    result: false,
    tackle: false,
    touchdown: false,
    firstDown: false,
    kick: false,
    replay: false,
    snap: false,
    any: false,
    matched: [],
  };
  for (const { key, pattern } of LEXICON) {
    if (!pattern.test(lower)) continue;
    cues[key] = true;
    cues.matched.push(key);
  }
  cues.result = RESULT.test(lower) || cues.incomplete || cues.touchdown || cues.sack || cues.tackle;
  cues.any = cues.matched.length > 0 || cues.result;
  return cues;
}

/** The kind of play the cues say, best first: a sack beats a pass beats a rush. Null when the words say nothing. */
export function cuedPlayType(cues: PlayCues): "sack" | "pass" | "rush" | "kick" | "penalty" | null {
  if (cues.sack) return "sack";
  if (cues.kick) return "kick";
  if (cues.pass || cues.complete || cues.incomplete) return "pass";
  if (cues.rush) return "rush";
  if (cues.penalty) return "penalty";
  return null;
}
