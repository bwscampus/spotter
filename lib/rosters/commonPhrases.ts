// =============================================================================
// Phrases an announcer says during play that a surname must not be confused
// with. Next to commonWords.ts, but scored differently: a phrase is several
// words, and the matcher joins short adjacent words ("are gonna" can land on
// Aragon), so commonPhraseHits runs each one through the same scan a live
// utterance gets.
//
// The seed list is what Deepgram actually heard during the Sept 25 game at the
// moments it put up a wrong card or came close. The rest is ordinary
// play-by-play talk added alongside it. Add to either list when a real game
// shows a new one; lowercase, as said.
// =============================================================================

/** Heard during the Sept 25 game. docs/V3_DEFINITION.md section 14. */
const HEARD_SEPT_25: string[] = [
  "long", "are gonna", "be sick", "oregon", "right", "how", "how's", "sure yeah", "crazy", "sorry",
  "holes", "less", "there is", "he's", "still", "breaks", "write", "so are you", "are you gonna",
  "we're gonna", "you're gonna", "sure", "well i've", "loss", "press", "sir", "all of", "tackle",
  "used to", "course", "powers", "work on", "ride", "games", "names", "lane", "bars", "minutes", "just",
  "is it", "high", "hey", "is the", "is what", "from here",
];

/** Everyday play-by-play talk, added so the check covers more than one game's worth. */
const PLAY_BY_PLAY: string[] = [
  "gonna", "they're gonna", "all right", "right there", "let's go", "look at that", "what a play",
  "first down", "out of bounds", "hold on", "brought down", "picks up", "no gain", "big gain",
  "yard line", "on the", "at the", "in the", "back to", "hands off", "goes down", "gets in",
];

export const COMMON_PHRASES: string[] = [...new Set([...HEARD_SEPT_25, ...PLAY_BY_PLAY])];
