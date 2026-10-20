import { advance, NEAR_MIDFIELD, START_STATE, type GameState } from "./gameState";
import type { ParsedLine } from "./parse";
import { spotProgress, type SpotMention } from "./parse/spots";
import type { ReaderGameState, Score, Side, StatsPlay, TeamWords } from "./types";

// =============================================================================
// The game-state tracker (v7, Part 4): where the game stands, as a finite
// state machine with explicit transitions, fed two things: the parsed lines
// as they land (a down-and-distance call, a snap, a result, a flag, a score,
// a kick or a turnover) and the plays as they are applied (which move the
// ball). PRE_SNAP -> LIVE -> DEAD -> (PENALTY_PENDING | SCORE_PENDING |
// CHANGE_OF_POSSESSION) -> PRE_SNAP.
//
// The ball itself is still lib/livestats/gameState.ts's business (advance,
// the one-play-at-a-time state), so v6 and v7 agree about where it is; this
// adds the phase, what the booth has said since the last play (the next down
// and distance, the spot, the score, who has the ball), and expectedNext(),
// what the yards solver (lib/livestats/yards.ts) compares a play against.
// snapshot() is the GAME STATE block the extractor is told. Pure apart from
// its own state; synchronous; the hot path's budget.
// =============================================================================

export type Phase = "PRE_SNAP" | "LIVE" | "DEAD" | "PENALTY_PENDING" | "SCORE_PENDING" | "CHANGE_OF_POSSESSION";

export interface Transition {
  from: Phase;
  to: Phase;
  /** What moved it: "dd", "snap", "result", "penalty", "score", "kick", "turnover", "play". */
  by: string;
  seq: number | null;
}

/** The next snap as the words and the plays say it. */
export interface ExpectedNext {
  down: number | null;
  distance: number | null;
  /** Yards from the offense's own goal line, 0 to 100, or null. */
  spot: number | null;
  /** The spot was said as a yard line rather than worked out. */
  spotSaid: boolean;
  isGoal: boolean;
}

export interface TrackerSnapshot {
  phase: Phase;
  possession: Side | null;
  quarter: number | null;
  score: Score | null;
  next: ExpectedNext;
  /** The last line that said the down and distance, so a play can be matched to it. */
  ddSeq: number | null;
}

export class GameTracker {
  private phase: Phase = "PRE_SNAP";
  private ball: GameState = START_STATE;
  private possession: Side | null = null;
  private quarter: number | null = null;
  private score: Score | null = null;
  private said: { down: number | null; distance: number | null; spot: number | null; isGoal: boolean; seq: number | null } = { down: null, distance: null, spot: null, isGoal: false, seq: null };
  readonly transitions: Transition[] = [];

  // A field, not a parameter property: Node's type stripping (replay:stats) refuses those.
  private readonly teams: TeamWords | null;

  constructor(teams: TeamWords | null = null) {
    this.teams = teams;
  }

  private go(to: Phase, by: string, seq: number | null) {
    if (to === this.phase) return;
    this.transitions.push({ from: this.phase, to, by, seq });
    if (this.transitions.length > 200) this.transitions.shift();
    this.phase = to;
  }

  /** One parsed line, as it lands. */
  onLine(line: ParsedLine) {
    const cues = line.cues;
    // Who has the ball, when a team word is said with "ball" ("bulldogs ball", "sharks will take over").
    const owner = this.possessionWord(line);
    if (owner) this.possession = owner;
    if (line.dd) {
      const spot = line.spots.find((entry) => entry.kind === "at" || entry.kind === "start") ?? null;
      this.said = {
        down: line.dd.down,
        distance: line.dd.distance,
        spot: spot ? this.place(spot) : null,
        isGoal: line.dd.isGoal,
        seq: line.seq,
      };
      this.go("PRE_SNAP", "dd", line.seq);
      return;
    }
    if (cues.replay) return;
    switch (this.phase) {
      case "PRE_SNAP":
        if (cues.snap || cues.rush || cues.pass || cues.kick) this.go("LIVE", cues.kick ? "kick" : "snap", line.seq);
        if (cues.result) this.go("DEAD", "result", line.seq);
        break;
      case "LIVE":
        if (cues.result) this.go("DEAD", "result", line.seq);
        break;
      default:
        break;
    }
    if (this.phase === "DEAD" || this.phase === "LIVE") {
      if (cues.penalty) this.go("PENALTY_PENDING", "penalty", line.seq);
      else if (cues.touchdown) this.go("SCORE_PENDING", "score", line.seq);
      else if (cues.turnover) this.go("CHANGE_OF_POSSESSION", "turnover", line.seq);
      else if (cues.kick && this.phase === "DEAD") this.go("CHANGE_OF_POSSESSION", "kick", line.seq);
    }
  }

  /**
   * A play as applied (checked, with its yards): the ball moves by it, and the
   * next snap is what the play implies until the booth says otherwise.
   */
  onPlay(play: StatsPlay) {
    this.ball = advance(this.ball, play);
    if (play.offense) this.possession = play.offense;
    if (play.quarter !== null) this.quarter = play.quarter;
    if (play.score) this.score = play.score;
    // What was said before this play is spent; the next call will say the next down.
    if (this.said.seq !== null && this.said.seq <= play.seqEnd) this.said = { down: null, distance: null, spot: null, isGoal: false, seq: null };
    this.go("PRE_SNAP", "play", play.seqEnd);
  }

  /**
   * A yard line as yards from the offense's goal line: by its half when the
   * words say it, else in the same half as the ball when the ball is well
   * inside one half (gameState.ts's NEAR_MIDFIELD rule), else unknown.
   */
  private place(spot: SpotMention): number | null {
    const known = spotProgress(spot, this.possession ?? this.ball.possession);
    if (known !== null) return known;
    const ball = this.ball.possession === (this.possession ?? this.ball.possession) ? this.ball.spot : null;
    if (ball === null) return null;
    const ballLine = ball <= 50 ? ball : 100 - ball;
    if (ballLine >= NEAR_MIDFIELD) return null;
    return ball < 50 ? spot.yardLine : 100 - spot.yardLine;
  }

  /** The next snap: the booth's call when one has been said since the last play, else what the last play implies. */
  expectedNext(): ExpectedNext {
    if (this.said.seq !== null) {
      return { down: this.said.down, distance: this.said.distance, spot: this.said.spot ?? this.ball.spot, spotSaid: this.said.spot !== null, isGoal: this.said.isGoal };
    }
    return { down: this.ball.down, distance: this.ball.distance, spot: this.ball.spot, spotSaid: false, isGoal: false };
  }

  snapshot(): TrackerSnapshot {
    return { phase: this.phase, possession: this.possession ?? this.ball.possession, quarter: this.quarter, score: this.score, next: this.expectedNext(), ddSeq: this.said.seq };
  }

  /** The ball as gameState.ts holds it, for the yards solver's spots method. */
  ballState(): GameState {
    return this.ball;
  }

  /** The GAME STATE block's fields, from what this tracker knows (the rest, the quarterbacks and kickers, come from the session). */
  readerState(): Pick<ReaderGameState, "teams" | "quarter" | "score" | "possession" | "down" | "distance" | "spot" | "spotSaid"> {
    const state: ReturnType<GameTracker["readerState"]> = {};
    if (this.teams) state.teams = { home: this.teams.home.name, away: this.teams.away.name };
    if (this.quarter !== null) state.quarter = this.quarter;
    if (this.score) state.score = this.score;
    const possession = this.possession ?? this.ball.possession;
    if (possession) {
      state.possession = possession;
      const next = this.expectedNext();
      if (next.down !== null) state.down = next.down;
      if (next.distance !== null) state.distance = next.distance;
      if (next.spot !== null) {
        const spot = Math.min(100, Math.max(0, next.spot));
        const defense: Side = possession === "home" ? "away" : "home";
        state.spot = spot === 50 ? { yardLine: 50, territory: "midfield" } : spot < 50 ? { yardLine: spot, territory: possession } : { yardLine: 100 - spot, territory: defense };
        state.spotSaid = next.spotSaid;
      }
    }
    return state;
  }

  /** "bulldogs ball", "sharks take over", "harborview will start at their own 25": the side named with a possession word. */
  private possessionWord(line: ParsedLine): Side | null {
    if (!this.teams) return null;
    const text = ` ${line.words.join(" ")} `;
    if (!/\b(?:ball|take over|takes over|will start|start at|possession|offense comes out|drive)\b/.test(text)) return null;
    for (const side of ["home", "away"] as const) {
      for (const phrase of this.teams[side].phrases) {
        if (text.includes(` ${phrase} ball `) || text.includes(` ${phrase} take over `) || text.includes(` ${phrase} takes over `) || text.includes(` ${phrase} will start `) || text.includes(` ${phrase} offense `) || text.includes(` ${phrase} possession `)) return side;
      }
    }
    return null;
  }
}
