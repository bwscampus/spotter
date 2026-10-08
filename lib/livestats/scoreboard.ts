import type { StatChange } from "@/lib/cards/tonight";
import { wipedOut } from "./penalty";
import { hasGroup } from "./positions";
import type { Score, Side, StatsPlay, StatsRosterPlayer } from "./types";

// =============================================================================
// Keeping the score (Oct 4: one runner was given a touchdown from a recap, a
// receiver got one on an incompletion, and 7 of 10 extra points were never
// logged because booths rarely call them).
//
// The reader returns the score whenever the booth states it. A touchdown is
// applied as read and confirmed when that side's score goes up by 6, 7 or 8
// at the next stated score. The score is never a reason to take a touchdown
// away (Oct 6: the score is said too rarely to trust for that, and the rule
// that did it removed a real touchdown and kept an overturned one). A
// confirmed touchdown whose side went up exactly 7 gets its extra point as
// made: credited to that side's kicker when none was read, and set made when
// one was read with no result (R25). A field goal try with no result heard is
// made when the side goes up 3 and missed when the next stated score shows no
// change (R26).
//
// Pure: the plays as they stand in, decisions out. The session applies them
// as updates, so the log and undo see them like any other change.
// =============================================================================

/** What the ledger needs to know about a play already read. */
export interface ScoredPlay {
  playId: string;
  play: StatsPlay;
  status: string;
  changes: readonly StatChange[];
}

export type ScoreDecision =
  | { kind: "confirm"; playId: string }
  | { kind: "xp_result"; playId: string }
  | { kind: "fg_result"; playId: string; made: boolean }
  | { kind: "credit_xp"; afterPlayId: string; side: Side; kicker: string; seq: number; quarter: number | null };

/** Where each touchdown stands, by playId. A play not in the map has no touchdown. */
export type TouchdownCheck = "unconfirmed" | "confirmed";

const TD_KEYS = ["rush_td", "pass_td", "rec_td", "kr_td", "pr_td", "int_td", "fr_td"] as const;

interface Pending {
  play: ScoredPlay;
  kind: "td" | "fg";
  baseline: Score | null;
}

/**
 * The decisions the stated scores support, from the plays in read order.
 * Deterministic from the plays, so a reload reaches the same conclusions.
 */
export function scoreDecisions(plays: readonly ScoredPlay[], roster: readonly StatsRosterPlayer[]): ScoreDecision[] {
  const sideOf = new Map(roster.map((player) => [player.playerId, player.side]));
  const live = plays.filter((play) => play.status !== "discarded");
  const decisions: ScoreDecision[] = [];
  const pending: Record<Side, Pending[]> = { home: [], away: [] };
  let known: Score | null = null;

  for (let i = 0; i < live.length; i++) {
    const entry = live[i];
    const { play } = entry;
    const baseline = known;

    const tdSide = scoringSide(entry, sideOf);
    if (tdSide) pending[tdSide].push({ play: entry, kind: "td", baseline });
    const fgSide = play.playType === "field_goal" && !wipedOut(play) ? kickSide(entry, sideOf) : null;
    if (fgSide && play.events.some((event) => event.action === "field_goal" && event.made === null)) {
      pending[fgSide].push({ play: entry, kind: "fg", baseline });
    }

    if (!play.score) continue;
    for (const side of ["home", "away"] as const) {
      const items = pending[side].filter((item) => item.baseline !== null);
      if (items.length === 0) continue;
      const rise = play.score[side] - items[0].baseline![side];
      if (rise < 0) continue; // a misread score settles nothing
      const tds = items.filter((item) => item.kind === "td");
      const fgs = items.filter((item) => item.kind === "fg");
      // Points by this side between the baseline and now that are already known: extra points read.
      const between = live.slice(live.indexOf(items[0].play), i + 1);
      const xpRead = between.filter((p) => p.play.playType === "extra_point" && !wipedOut(p.play) && kickSide(p, sideOf) === side);
      const twoPointRead = between.filter((p) => p.play.playType === "two_point" && kickSide(p, sideOf) === side).length;
      const xpMade = xpRead.filter((p) => p.play.events.some((event) => event.action === "extra_point" && event.made === true)).length;

      const confirmed = Math.min(tds.length, Math.floor(rise / 6));
      tds.slice(0, confirmed).forEach((item) => decisions.push({ kind: "confirm", playId: item.play.playId }));
      let leftover = rise - confirmed * 6 - xpMade - twoPointRead * 2;
      // Extra points read with no result, when every confirmed touchdown went for 7: made.
      const xpOpen = xpRead.filter((p) => p.play.events.some((event) => event.action === "extra_point" && event.made === null));
      if (confirmed > 0 && xpOpen.length > 0 && twoPointRead === 0 && xpMade + xpOpen.length <= confirmed && rise === confirmed * 7) {
        for (const p of xpOpen) decisions.push({ kind: "xp_result", playId: p.playId });
        leftover -= xpOpen.length;
      } else if (confirmed > 0 && xpRead.length === 0 && twoPointRead === 0 && leftover === confirmed) {
        // Every confirmed touchdown went for 7 and no extra point was read: the kicker made them.
        const kicker = kickerFor(side, live, roster, sideOf);
        if (kicker) {
          for (const item of tds.slice(0, confirmed)) {
            decisions.push({ kind: "credit_xp", afterPlayId: item.play.playId, side, kicker, seq: play.seqEnd, quarter: item.play.play.quarter });
          }
          leftover -= confirmed;
        }
      }
      for (const item of fgs) {
        if (leftover >= 3) {
          decisions.push({ kind: "fg_result", playId: item.play.playId, made: true });
          leftover -= 3;
        } else if (leftover === 0 && confirmed === tds.length) {
          decisions.push({ kind: "fg_result", playId: item.play.playId, made: false });
        }
      }
      pending[side] = pending[side].filter((item) => item.baseline === null);
    }
    known = play.score;
  }
  return decisions;
}

/** Where each touchdown stands: confirmed by a later score, or not (yet). Never a reason to remove one. */
export function touchdownChecks(plays: readonly ScoredPlay[], roster: readonly StatsRosterPlayer[]): Map<string, TouchdownCheck> {
  const sideOf = new Map(roster.map((player) => [player.playerId, player.side]));
  const checks = new Map<string, TouchdownCheck>();
  for (const play of plays) if (play.status !== "discarded" && scoringSide(play, sideOf)) checks.set(play.playId, "unconfirmed");
  for (const decision of scoreDecisions(plays, roster)) if (decision.kind === "confirm") checks.set(decision.playId, "confirmed");
  return checks;
}

/** The side a touchdown on this play belongs to: whoever was credited with the score. */
function scoringSide(entry: ScoredPlay, sideOf: ReadonlyMap<string, Side>): Side | null {
  if (!entry.play.touchdown || wipedOut(entry.play)) return null;
  for (const change of entry.changes) {
    if ((TD_KEYS as readonly string[]).includes(change.key) && change.amount) {
      const side = sideOf.get(change.playerId);
      if (side) return side;
    }
  }
  return entry.play.offense;
}

function kickSide(entry: ScoredPlay, sideOf: ReadonlyMap<string, Side>): Side | null {
  for (const event of entry.play.events) {
    if (event.action === "field_goal" || event.action === "extra_point") {
      const side = sideOf.get(event.playerId);
      if (side) return side;
    }
  }
  return entry.play.offense;
}

/** The kicker already credited with a kick this game, else the roster's only kicker, else its only punter, else nobody. */
export function kickerFor(side: Side, plays: readonly ScoredPlay[], roster: readonly StatsRosterPlayer[], sideOf: ReadonlyMap<string, Side>): string | null {
  for (let i = plays.length - 1; i >= 0; i--) {
    for (const event of plays[i].play.events) {
      if ((event.action === "field_goal" || event.action === "extra_point") && sideOf.get(event.playerId) === side) return event.playerId;
    }
  }
  const kickers = roster.filter((player) => player.side === side && hasGroup(player.position, "k"));
  if (kickers.length === 1) return kickers[0].playerId;
  if (kickers.length > 1) return null;
  const punters = roster.filter((player) => player.side === side && hasGroup(player.position, "p"));
  return punters.length === 1 ? punters[0].playerId : null;
}
