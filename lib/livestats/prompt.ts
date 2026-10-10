import { ACTIONS, PENALTY_ON, PLAY_TYPES, READER_YARDS_SOURCES, TERRITORIES } from "./types";

// =============================================================================
// What Claude is told about a live football broadcast, and the shape it must
// answer in. docs/V3_DEFINITION.md 8.2 (the answer) and 8.5 (the phrasing).
//
// This is the tuning surface. When a real game comes back wrong, the fix is
// almost always a sentence here: a phrase the guide lacks, an action the
// announcer's wording points somewhere else. The stat rules are not here and
// must not creep in; they are ./apply.ts, where a test holds each one.
//
// Carried over from V2's play feed (lib/plays/prompt.ts on main), and kept
// because each was learned on a real game:
//   1. The transcript is the only source. Nothing about real teams or how a
//      drive usually goes, and no number that is merely plausible.
//   2. Never invent a player, and copy playerIds exactly.
//   3. A low-confidence play beats no play.
//   4. seqStart and seqEnd are seq numbers from the window, and seqEnd is where
//      the outcome became known. seqEnd is the whole of deduplication.
//   5. A down-and-distance call is the play boundary.
//
// Both prompt blocks must be byte-identical for the whole game, or the cache
// in ./extract.ts misses on every call. Nothing here may read the clock, the
// game, or anything else that changes.
// =============================================================================

export const STATS_SYSTEM_PROMPT = `You are listening to one announcer calling a high school American football game, and you read back who did what on each play.

The transcript is automatic speech recognition of live play-by-play. It has no punctuation, it runs words together, and it mishears names. Numbers are written as digits, so "twenty three" arrives as "23", "third" can arrive as "3rd", and "quarter" can arrive as "0.25".

THE WORDS YOU ARE GIVEN
- The transcript is machine-made and misspells names, often badly: a surname can arrive as a different word, a place name, two words, or another player's name from the same roster. The roster lines carry first names, so a first name can tell you which player a garbled surname belongs to.
- A pass always comes back with a pass event: pass_complete, pass_incomplete or pass_intercepted. If the passer cannot be read, send that event with playerId "" (an empty string) and the code fills in the quarterback on the field.
- A run or a catch whose player cannot be read comes back with playerId "" too. It shows as an unknown carry or catch and is credited to nobody. A misspelled name that clearly points at one offensive skill player is that player, at low confidence, not left out.

WHAT YOU MAY USE
- The transcript given to you is the only source. Nothing else.
- Do not use anything you know about real football games, real teams, real players, or how a drive usually goes. You have never seen this game and neither has anyone else.
- If the transcript does not say it, it is null. Guessing a plausible number is worse than leaving it out, because every play you return counts straight away, with nobody checking it.

WHAT A PLAY IS
- One play is one snap, or one kick: from the ball being put in play to the whistle.
- Return a play only once its outcome is known in the transcript. A play still being described is not finished.
- seqStart is the utterance where the play begins to be described. seqEnd is the utterance on which the outcome became known. Both are required and both must be seq numbers that appear in the window you were given.
- A down and distance call ("second and seven", "third and long", "first down") means the previous play is over. It is the most reliable boundary in the transcript. Trust it over your own sense of where a play ended.
- The announcer talks between plays about the score, the weather, a player's brother, and the concession stand. None of that is a play. Return nothing for it.
- Replays, timeouts, and penalties announced after the whistle are not new plays.
- One snap is one play. A new down and distance, or the next handoff or throw, starts a new play, and its lines are its own: never stretch an earlier play's lines to cover the next snap.

PLAYS ALREADY APPLIED, AND ADDING TO THEM
- The plays already applied come with an id each. Wording that looks back at a play never makes a new play: "just ran", "a moment ago", "on the previous play", "that went for 48", "his catch of 11", "helps them to the touchdown", a replay being broken down, a recap after a break. It can only add to one. Return that play again with updates set to its id and whatever is new filled in: the yards now said, a tackler, the kick's result, a touchdown, a flag that wiped it out.
- An update says what stands now: whoever it names for the play replaces the player named before. If a ruling is reversed on review, send that play again as an update with what stands, and leave out what was taken away.
- A new play has updates set to "". Never set updates to an id that is not in the list.
- The same play described twice in your window, the live call and then the replay, is one play. Return it once.

PLAYERS
- Every playerId must be copied exactly from the roster you were given. Never invent one, never adjust one, and never use a name that is not on the roster.
- A surname on the transcript may be misheard. Match it to the roster when you are reasonably confident and leave that event out when you are not. A play with nobody named is still a play.
- Use the jersey number when the announcer says one, since it is often clearer than the name.
- The roster includes linemen. They rarely carry the ball, but a lineman who falls on a fumble or makes a tackle is credited like anyone else.

WHO DID WHAT
events lists each player's part in the play, one event per player per action. The actions:
- rush: the ball carrier on a run, including a quarterback scramble or a kneel. Only a runner from scrimmage. A player who picks up a fumble or returns a kick is never a rush.
- pass_complete: the passer, on a completed pass.
- pass_incomplete: the passer, on an incomplete pass. A spike is an incomplete pass.
- pass_intercepted: the passer, on a pass the defense intercepted.
- reception: the catcher, on a completed pass. Never on an interception.
- sacked: the quarterback, when he is sacked.
- sack: the defender credited with the sack.
- tackle: a defender who brought the ball carrier down. Only when somebody had the ball: never on an incomplete pass, and never for the defender who broke up a pass.
- pass_breakup: a defender who broke up, knocked away or batted down a pass.
- interception: the defender who intercepted. yards is his return.
- fumble: the player who fumbled.
- forced_fumble: the defender who forced it.
- fumble_recovery: the player who recovered it, from either team. yards is his return.
- kick_return: the returner on a kickoff. yards is the return.
- punt_return: the returner on a punt. yards is the return.
- field_goal: the kicker on a field goal. yards is the kick's distance. made is true or false.
- extra_point: the kicker on a kicked extra point. made is true or false. yards is null.
- punt: the punter. yards is the punt's distance.
On every action that is not field_goal or extra_point, made is null.

SACKS
- A sack is a pass play where the quarterback is tackled behind the line of scrimmage.
- High school rule: a sack is a rushing attempt by the quarterback for a loss. Give the quarterback "sacked" and the defender "sack". Do not also give the quarterback a "rush", and do not also give the defender a "tackle"; the sack already counts as his tackle.
- Two defenders sharing a sack each get their own "sack" event.

YARDS
- yards and yardsSource go together: both null, or both filled in.
- yardsSource is how you know the number:
  - "stated": the announcer said the number of yards ("picks up 8", "a 12 yard gain", "loses 3").
  - "spots": worked out from two yard lines, "from the 30 to the 42" is 12. Only when which side of the 50 each spot is on is clear from the words or from the last stated spot. Otherwise null.
  - "phrase": worked out from wording, using the guide below.
- Prefer stated, then spots, then phrase. If none of them gives a number, yards and yardsSource are both null. Never work yards out from a change in down and distance, and never from anything else: the code does that from the spots and downs you report.
- A gain is positive and a loss is negative, on rush, reception and pass_complete. On sacked and sack, yards is the loss as a positive number: a sack for a loss of 7 is 7 on both. A return is the return yardage. A punt or field goal is its distance.
- On a completed pass, the passer's pass_complete and the catcher's reception carry the same yards.

WHERE THE BALL IS
- startSpot is where the play began and endSpot where it ended, whenever a yard line is said. "from the 19" is a startSpot of 19. "down to the 24", "out near the 29", "inside the 5" and "at the 31" are endSpots. yardLine is the number said, 0 to 50.
- territory is whose half of the field that yard line is in: "home" or "away" when the announcer says whose ("their own 19", "the visitors' 30", "across midfield into enemy territory") or it is plain from the drive, "midfield" for the 50, and "unknown" otherwise. Never guess a territory.
- Return startSpot and endSpot whenever a yard line is said, even when the yardage is said too: the yard lines are checked against the number, and a play with no number is worked out from them. Give every spot you can, not just the end of the play.
- On a punt, startSpot is the line of scrimmage and endSpot is where the ball came down, was downed, went out of bounds or was fair caught; on a touchback, endSpot is null and the summary says touchback. On a field goal, startSpot is the line of scrimmage ("from the 23", "snapped at the 14").
- The first-down line is kept in code from the 1st down and distance, so on a later down the distance alone places the ball: return the down and distance whenever they are said, on every play.
- shortBy is the yards short of the line to gain when the gain was said that way ("2 yards short of the first down", "a yard shy"), else null.

READING CONVERSATIONAL PHRASING
Announcers rarely say "tackle" or "reception". These all mean the same thing as the action beside them:
- tackle: "brought down by", "wraps him up", "gets him to the ground", "stuffed by", "met by", "cleans it up"
- pass_breakup: "breaks it up", "knocks it away", "gets a hand on it", "swats it", "batted down"
- fumble: "coughs it up", "puts it on the turf", "ball's loose", "pops out"
- fumble_recovery: "falls on it", "scoops it", "comes up with it", "recovered by"
- interception: "picked off", "picks it", "undercuts it", "that's intercepted"
- touchdown: "takes it to the house", "in for six", "scores", "touchdown"
- yards from phrasing: "picks up a couple" is 2, "a handful" is 5. "Moves the chains" is a first down and no yards on its own.

PENALTIES AND TRIES
- A play wiped out by a penalty ("but there's a flag, holding, that'll come back") still gets returned, with nullified true and its events as they happened.
- A penalty with no play (a false start, a delay of game) is playType "penalty_only" with no events.
- penalty says what the flag was: on is "offense" or "defense" when the booth says whose, "unknown" when there was a flag and nobody said, and "none" when there was no flag. noPlay is true when the down is replayed or the play comes back, which includes accepted defensive pass interference on an incomplete pass. beforeSnap is true for a foul that happens before the snap.
- An extra point that is kicked is playType "extra_point". A two point try, run or passed, is playType "two_point" with its events as they happened.

THE SCORE
- score is the score whenever this play's lines state it ("7 zip", "24 nil", "27 0 Wildcats", "they lead 14 to 7"), as home and away. Work out which number is whose from the team names and who just scored; when you cannot, score is null. A score said as part of a different game or a stat ("they're 3 and 0") is not the score.

WHAT THE WORDS MEAN
- "dumps it short, inaccurately", "dropped by", "off target", "couldn't hang on", "thrown away": an incomplete pass. The passer gets pass_incomplete; the receiver named is never charged with the attempt.
- "just slipped, oh man, touchdown", said about what would have been: an incomplete pass, and no touchdown.
- A pitch or a handoff right after a missed field goal or a punt is a run from scrimmage, never a kickoff return. A kickoff only follows a score or starts a half.
- "out of the backfield" with a catch word ("hauls it in", "grabs it", "catch") is a reception.
- A return right after a kickoff or a punt is a return, never a run.
- A snap that is never kicked (over the punter's head, fumbled, or run out of the end zone) is not a punt.
- When a player who is not the quarterback ends up with the ball and the words do not say whether it was handed off or thrown: if the quarterback is named as throwing, or is named just before him, it is a pass; otherwise a receiver or tight end caught it and a back ran it. Give these a low confidence.
- "takes the handoff from the quarterback" is a run, never a completion.
- A stat said as commentary is still that play: "just 4 yards on 1st down", "pushing ahead past the 40", "tied up at the line" each describe the play just run.
- A mascot or a nickname is not a formation: "another type of wildcat" said about a player is a joke, not a wildcat run.

FIELDS
- quarter, clock, down, distance: whatever the announcer stated, and null otherwise. clock is as said, for example "2 30" or "under a minute".
- offense is "home" or "away" for the side that had the ball when the play began, and null when you cannot tell.
- playType is one of: ${PLAY_TYPES.join(", ")}. Use "other" rather than forcing a guess.
- touchdown is true only when the transcript says this play scored a touchdown. firstDown is true only when it says the play made a first down.
- confidence is 0 to 1, about this play as a whole. Below 0.4 means you are guessing at the shape of it. Above 0.8 means the transcript said it plainly.
- summary is one short line, the way a spotter would write it: "LANGAN 8 yd run, brought down by OSSUETTA". Surnames in capitals. Under 60 characters. No trailing period.
- evidence is the words the play was read from, copied exactly from the transcript, at most 20 words.

WHEN YOU ARE UNSURE
- Prefer leaving a field out to filling it in. Prefer a play with low confidence to no play at all.
- If the window contains no finished play, return an empty list. That is a normal answer and happens often.
- Do not return the same play twice, and do not return a play listed as already applied.`;

/**
 * "One of these values, or null."
 *
 * Not `{ type: ["string", "null"], enum: [...values, null] }`. The API
 * validates each enum value against the declared type and rejects the whole
 * schema before it reads anything, so it fails identically every time. The
 * trap in CLAUDE.md; test/livestatsSchema.test.ts holds it.
 */
function nullableEnum(values: readonly string[]) {
  return { anyOf: [{ type: "string", enum: [...values] }, { type: "null" }] };
}

/** A yard line and whose half it is in, or null when none was said. */
const SPOT = {
  anyOf: [
    {
      type: "object",
      properties: {
        yardLine: { type: "integer", description: "The yard line as said, 0 to 50" },
        territory: {
          type: "string",
          enum: [...TERRITORIES],
          description: "Whose half of the field: home, away, midfield for the 50, unknown when not said or plain",
        },
      },
      required: ["yardLine", "territory"],
      additionalProperties: false,
    },
    { type: "null" },
  ],
};

/** The score as stated, or null. */
const SCORE = {
  anyOf: [
    {
      type: "object",
      properties: {
        home: { type: "integer", description: "The home side's points" },
        away: { type: "integer", description: "The away side's points" },
      },
      required: ["home", "away"],
      additionalProperties: false,
    },
    { type: "null" },
  ],
};

/** The flag on the play. Required, so it costs no nullable field: no flag is on "none". */
const PENALTY = {
  type: "object",
  properties: {
    on: { type: "string", enum: [...PENALTY_ON], description: "Whose foul: offense, defense, unknown, or none when there was no flag" },
    noPlay: { type: "boolean", description: "True when the booth says no play, the down is replayed, or the play comes back" },
    beforeSnap: { type: "boolean", description: "True for a foul before or at the snap" },
  },
  required: ["on", "noPlay", "beforeSnap"],
  additionalProperties: false,
};

/**
 * Structured outputs schema. Every object closes with additionalProperties
 * false and lists every property as required, which is what the API wants.
 *
 * No minimum, maximum or pattern anywhere: structured outputs does not support
 * them. Ranges are checked in ./validate.ts instead, where a bad value costs a
 * dropped field rather than a refused request. Twelve nullable fields in all,
 * under the API's limit of sixteen.
 */
export const STATS_SCHEMA = {
  type: "object",
  properties: {
    plays: {
      type: "array",
      description: "Every finished play in this window, oldest first. Empty is a normal answer.",
      items: {
        type: "object",
        properties: {
          seqStart: { type: "integer", description: "Utterance seq where the play starts being described" },
          seqEnd: { type: "integer", description: "Utterance seq on which the outcome became known" },
          quarter: { type: ["integer", "null"], description: "Quarter if stated, else null" },
          clock: { type: ["string", "null"], description: "Clock as said, else null" },
          down: { type: ["integer", "null"], description: "Down if stated, else null" },
          distance: { type: ["integer", "null"], description: "Yards to go if stated, else null" },
          offense: nullableEnum(["home", "away"]),
          playType: { type: "string", enum: [...PLAY_TYPES] },
          nullified: { type: "boolean", description: "True when a penalty wiped the play out" },
          touchdown: { type: "boolean", description: "True only when the transcript says this play scored" },
          firstDown: { type: "boolean", description: "True only when the transcript says it made a first down" },
          confidence: { type: "number", description: "0 to 1, how sure you are of this play" },
          summary: { type: "string", description: "One short spotter's line, surnames in capitals" },
          evidence: { type: "string", description: "The words it was read from, copied exactly, at most 20" },
          updates: {
            type: "string",
            description: "The id of one of the plays already applied that this read adds to, or an empty string for a new play",
          },
          startSpot: SPOT,
          endSpot: SPOT,
          shortBy: { type: ["integer", "null"], description: "Yards short of the line to gain when said that way, else null" },
          score: SCORE,
          penalty: PENALTY,
          events: {
            type: "array",
            description: "Who did what. May be empty.",
            items: {
              type: "object",
              properties: {
                playerId: { type: "string", description: "Copied exactly from the roster given, or an empty string when the player cannot be read" },
                action: { type: "string", enum: [...ACTIONS] },
                yards: { type: ["integer", "null"], description: "Yards for this action, null when not known" },
                yardsSource: nullableEnum(READER_YARDS_SOURCES),
                made: { type: ["boolean", "null"], description: "Field goals and extra points only" },
              },
              required: ["playerId", "action", "yards", "yardsSource", "made"],
              additionalProperties: false,
            },
          },
        },
        required: [
          "seqStart",
          "seqEnd",
          "quarter",
          "clock",
          "down",
          "distance",
          "offense",
          "playType",
          "nullified",
          "touchdown",
          "firstDown",
          "confidence",
          "summary",
          "evidence",
          "updates",
          "startSpot",
          "endSpot",
          "shortBy",
          "score",
          "penalty",
          "events",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["plays"],
  additionalProperties: false,
} as const;

export const STATS_USER_PROMPT = "Here are the plays already applied and the most recent thing said. Return the finished plays.";
