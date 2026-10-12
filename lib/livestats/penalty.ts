import type { LoggedDrop } from "@/lib/log/statsLog";
import type { StatsPlay } from "./types";

// =============================================================================
// Whether a play is wiped out (rule R7), in one place (Oct 6).
//
// Only the reader wipes a play out: it marks that play itself as wiped out or
// says the down is replayed (its penalty's noPlay, which covers accepted
// defensive pass interference on an incompletion), or a later read updates
// the play and marks it so. A flag read on its
// own after a play never reaches back to wipe it (the old R27, which wiped
// three real plays in two games for false starts on the next snap).
//
// One rule of football in code: a foul before the snap does not make the
// play it is read on a "no play", because the down it replays was never run,
// so the play read beside it is the snap that followed. Its noPlay is about
// that missing down, not this play.
//
// The reader's own word wins, though (audit L6): a play it marked nullified
// is wiped out whatever it says about the snap.
// =============================================================================

export function wipedOut(play: Pick<StatsPlay, "nullified" | "penalty">): boolean {
  if (play.nullified) return true;
  return play.penalty?.noPlay === true && !play.penalty.beforeSnap;
}

// -----------------------------------------------------------------------------
// A defensive foul on a pass (Oct 11, fix 6, Part 4a, rule R46). On the audited
// broadcast three passes were counted on plays an accepted defensive holding,
// illegal contact or pass interference flag had made a no-play. A rule of
// football: those fouls, accepted, replay the down from the spot of the foul,
// so nothing on the play counts. Roughing the passer, unnecessary roughness,
// taunting, a face mask, a late hit or any foul after the play are tacked on
// to the result instead and leave the play standing; so does a foul the
// offense declined ("they'll take the play").
// -----------------------------------------------------------------------------

/** The defensive fouls on a pass that make it a no-play when accepted. */
const NO_PLAY_FOULS = /\b(?:defensive holding|holding|illegal contact|pass interference|interference)\b/i;

/** Fouls that leave the play standing whatever else is said about them. */
const TACKED_ON_FOULS = /\b(?:roughing|unnecessary roughness|taunting|face ?mask|facemask|late hit|personal foul|unsportsmanlike|horse ?collar|targeting)\b/i;

/** The booth said the offense declined the flag and took the play. */
const DECLINED = /\b(?:declined?|declines|take the (?:play|result|catch|completion|yards)|took the (?:play|result|catch|completion|yards)|wave(?:s|d)? off|pick up the flag|picked up the flag|no foul|offset)\b/i;

const PASS_ACTIONS = new Set(["pass_complete", "pass_incomplete", "pass_intercepted", "reception"]);

/**
 * Whether the play is a pass with a defensive holding, illegal contact or
 * pass interference foul the words say was accepted, so it is a no-play.
 * `lines` are the words the play was read from (its own lines, else its
 * summary and evidence).
 */
export function defensiveNoPlay(play: StatsPlay, lines: string): boolean {
  const penalty = play.penalty;
  if (!penalty || penalty.on !== "defense" || penalty.beforeSnap) return false;
  if (wipedOut(play)) return false;
  const pass = play.playType === "pass" || play.events.some((event) => PASS_ACTIONS.has(event.action));
  if (!pass) return false;
  if (!NO_PLAY_FOULS.test(lines) || TACKED_ON_FOULS.test(lines) || DECLINED.test(lines)) return false;
  return true;
}

/** The play as a no-play (R46), with the note; the play itself when the rule does not apply. */
export function withDefensiveNoPlay(play: StatsPlay, lines: string | undefined): { play: StatsPlay; notes: LoggedDrop[] } {
  const text = lines && lines.trim().length > 0 ? lines : `${play.summary} ${play.evidence}`;
  if (!defensiveNoPlay(play, text)) return { play, notes: [] };
  return {
    play: { ...play, nullified: true, penalty: { ...play.penalty!, noPlay: true } },
    notes: [{ playerId: "", action: "flag", rule: "R46", reason: "a defensive holding, illegal contact or pass interference foul accepted on a pass: no play, nothing counts", kind: "changed" }],
  };
}
