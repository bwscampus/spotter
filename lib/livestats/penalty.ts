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
