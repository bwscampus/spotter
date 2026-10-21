# Live stats v7: the staged pipeline

Written Oct 20, 2026, when v7 was built. v6 (the window reader described in `CLAUDE.md`, "Live stats engine") is unchanged and stays the default. This document says what v7 is, how it is switched on, what each stage does and where its knobs are, how a run is scored, what the acceptance run found, and what v7 cannot do yet. It names no real player, team, school or transcript line: the test set lives in `~/SpotterTestSet` and never enters the repository.

## 1. Why a second pipeline

v6 reads a window of up to 40 transcript lines every 30 seconds and asks one model for every play in it, then checks, merges and re-reads. Its errors come from three places the window design cannot fix: the model decides where one play ends and the next begins, the model picks the player from the whole roster, and the yards are whatever it says. v7 moves each of those out of the model:

1. **Code cuts the transcript into plays** (the parser and the segmenter), so the model is shown one play at a time with two lines before and five after.
2. **Code lists who the play can be about** (the candidates), so the model answers with an index into a short list, never a name it half-heard.
3. **Code works out the yards** (the yards solver), so a stated number beats arithmetic and arithmetic beats a guess, and the model's number is only one input.

Two models read every play and a third breaks ties (Part 8), because one model's confident wrong answer is the error the v6 audits found most often, and two models rarely agree on the same wrong answer.

## 2. Switching it on

`LIVE_STATS_PIPELINE` in the server's environment: unset or `v6` is the window reader; `v7` is this pipeline. `liveStatsPipeline()` in `lib/livestats/settings.ts` reads it; `next.config.ts` copies it to `NEXT_PUBLIC_LIVE_STATS_PIPELINE` so `components/livestats/useLiveStats.ts` builds the controller with the same choice. The choice is made when the controller is built and never changes mid-game; a game started under v6 on a reload stays v6.

The browser calls `POST /api/livestats/segment` (`app/api/livestats/segment/route.ts`: `requireVerifiedUser()`, `beginUsage("livestats")`, `readSegmentRequest`, `maxDuration` 45 s; the client gives up at 42 s). The route runs `extractSegmentOpenRouter` (`lib/livestats/openrouter.ts`), which is the reconcile step over the OpenRouter wire. The usage row records the sum of every call a segment made (reader A, reader B, the tie-break).

Everything else in `lib/livestats/` that v6 uses (session, check, merge, apply, ledger, gameState, scoreboard, describe, the log records) v7 uses too: a v7 play is an ordinary `StatsPlay` by the time `readPlays` sees it, so the cards, the strip, the report, the CSV, undo and the typed corrections work unchanged. `ReadContext.trustNamed` (set by v7 only) tells `readPlays` and `settleLedger` that the name check was done against the candidate list, so R18's late-name re-check is skipped and the solver's sources (`SOLVER_SOURCES` in `ledger.ts`) count as the reader's.

## 3. The stages

Each stage is pure and its own file, with a TUNING block at the top where it has knobs. The order is the order of a line's life.

### 3.1 Parser (`lib/livestats/parse/`, Part 2)

`parseLine(text, context, seq)` in `index.ts` turns one Deepgram final into a `ParsedLine`: `words`, `numbers` (digits and number words, "number 22"), `dd` (down and distance, "third and 1", "and goal", fuzzy forms), `spots` (yard lines with the half when the words give it: a team word within 3 words, "own", "opponent's", "plus", midfield), `cues` (snap, rush, pass, complete, incomplete, sack, tackle, result, penalty, score, kick, punt, replay, dead), and `nameHits` (every roster player the line names, with a score and how: exact 1.0, first and last 1.0, jersey cue 0.95, jersey by position 0.9, close spelling 0.85, double metaphone exact 0.8, one edit 0.7, two edits 0.6, first name alone 0.5). The name index (`buildNameIndex`) is built once per roster; `NOT_NAMES` stops everyday words that sound like surnames; a shared surname is exclusive to a first-and-last hit. `test/parse/benchmark.test.ts` parses and segments 2,000 lines and fails over 10 s in all or 5 ms for any line (best of three passes, because the GC can land on one).

### 3.2 Segmenter (`lib/livestats/segment.ts`, Part 3)

A `Segmenter` takes parsed lines in order and emits `PlaySegment`s: the play's lines, `PRE_LINES` (2) before, `POST_LINES` (5) after, the down and distance and spot before it, the merged cues and when it closed. A segment closes by one of five rules: a result cue followed by `RESULT_SILENCE_MS` (3 s) of nothing; the next snap (a down call, or a snap cue after a result); `PLAY_TIMEOUT_MS` (12 s) since it opened; a penalty cue holds the segment `PENALTY_HOLD_MS` (8 s) for the ruling; a replay cue spans `REPLAY_SPAN_MS` (12 s) so the replay talk joins the play it repeats. Every `SWEEP_MS` (15 s) orphan lines that name a player at `SWEEP_NAME_SCORE` (0.8) or better are swept into a segment of their own, and a down call sweeps them at once, so a play nobody said a play word for still gets read. The segmenter never calls anything: the loop reads `segmenter.closed()` after each line and queues the segments.

**Since fix 1, Part 2 (TV broadcasts):**

| Rule | What changed |
|---|---|
| Close rules | A play closes on a line that says the ball is dead (`isTerminal` in `parse/playWords.ts`: tackled, out of bounds, incomplete, touchdown, a spike) plus `RESULT_SILENCE_MS`; on the next snap or down-and-distance call; `PLAY_IDLE_MS` (8 s) after its last line with a play word or a yard line; or `PLAY_MAX_MS` (25 s) after it opened. `PLAY_TIMEOUT_MS` (12 s from the first play word) is gone. "Breaks a tackle" and "needs a first down" no longer close a play. |
| The next play | After the ball is dead, a new-play phrase opens the next play at once: "hands it to", "drops back", "takes the snap", "fires", "keeps it" (`startsNewPlay`). So does a snap, or a carry or throw a second later. Recap wording does not: the replay cue, "there he goes again", "he was", "it was" (`soundsLikeRecap`). |
| A call and a play on one line | "3rd and 10 from the 36 the throw from young" is the call and the new play's first line. Before, the play on such a line was never read. |
| The sweep | A line attached as a POST line is never swept. Other lines are swept only when together they name a player at 0.8 or better and say the play is over or what it gained, including "for about 2 yards", "gains a yard" and "with the stop" (`BARE_GAIN`). They are swept `SWEEP_MS` after the first, at a call, or when the next play opens (before, the next play threw them away). A name alone is colour. |
| Recaps | A would-be segment with no snap and no new-play phrase becomes POST lines of the play before (`counts.joined`) when all of these hold: it starts within `RECAP_JOIN_MS` (20 s) of that play's close; no call or snap came between; every offensive player it names (QB, RB, FB, WR, TE, through the `offensive` lookup `V7Reader` passes) was named there; and any gain it states is within a yard of that play's. The play before has usually been sent by then, so the lines are dropped (`counts.joinedAfterSend`). On dev, 3 of 243 joins swallowed a play no other segment touched. |
| POST window | Also closes `POST_WAIT_MS` after the segment closed, inside the segmenter. |
| Decimal downs | "0.333 and 1" is third and 1, and "0.25 down" is fourth down (`parse/downDistance.ts`): Deepgram's numerals turn a spoken fraction into a decimal (18 calls on the dev games). |
| Replay words | "That was" is no longer one: a live call says it ("throw incomplete, that was the idea"). |

The dry plays file carries the counts as `segmenter`.

Measured on the dev games, dry, against `segscore.py`:

| | one segment | split | missed | empty | segments a game |
|---|---|---|---|---|---|
| before | 53% | 40% | 7% | 58% | 593 |
| after | 67% | 25% | 8% | 43% | 312 |

The bars were 85%, 10%, 5% and 35%, and 350 segments a game. Two limits of the metric:
- **Long truth ranges.** 29 of the 30 dev anchors whose v6 truth range is 13 lines or longer count as split whatever the cut, because those ranges cover several plays and their talk. On anchors of 12 lines or fewer: 75% one segment, 16% split, 9% missed.
- **Empty segments** are mostly talk that names a player clearly beside a play word ("8 catches for 63 yards"). An attempt to send only segments that read like a play (a clear name, a dead ball, a gain, or a call just before) changed the empty share by one point and was taken out.

### 3.3 Game tracker and candidates (`stateMachine.ts`, `candidates.ts`, Part 4)

`GameTracker` is a small state machine (PRE_SNAP, LIVE, DEAD, PENALTY_PENDING, SCORE_PENDING, CHANGE_OF_POSSESSION) fed every line and every counted play. It holds who has the ball, the down and distance, the ball spot (a bare spot is placed near the ball), the quarter and score, and says what the next play should look like (`expectedNext`). Its snapshot is what `readerGameState` prints in the request.

**The list's order and size (fix 1, Part 4).**
- **Order:** the offense's quarterback, backs and receivers come first: those the PLAY or POST lines name, then those named only before the snap. Then everyone else in the same two steps, then the priors nobody named.
- **Size:** `MAX_CANDIDATES` is 10 (it was 8). At 8, players the lines named were cut by the cap. At 10 with before-snap names ranked after the defenders, 10 of the 11 still missing on dev were before-snap names cut that way.
- **Result:** dev recall on name-said anchors is 97.3% (94.7% with that first order), holdout 97.3%.
- **Rule 1** now says: if the PLAY or POST lines name a candidate as the one who ran, caught or threw, credit him, even when the name comes after the result ("that's [name] for 4"); NOT_NAMED only when no candidate is named doing it. The prompt is 586 words.
- **Worked examples:** "A scramble" and "A first-down call with picks up 12" are replaced by a run and a completion whose player (and gain) is named only in the POST lines.

**Who has the ball (fix 1, Part 3).** Possession is a timeline of facts in `GameTracker`, read with `possessionAt(seq)`, and never a play's own `offense`. On Oct 20 the mapping filled that offense from the tracker, so one wrong read kept itself going, and 34 passes went to the other side's quarterback.

The facts are:
- a possession phrase on a line ("bulldogs ball");
- the vote of a counted segment (`voteOf` in `possession.ts`): the offensive players its PLAY lines name at 0.8 or better. A quarterback counts 2, a back or receiver 1, a defender nothing, and a tie is no vote;
- the flips the counted plays imply (`flipsOf`), rebuilt from the session on every read:
  - a punt goes to the side opposite the punter;
  - a kickoff goes to its returner's side;
  - an interception or a lost fumble goes to the side that came up with the ball;
  - a field goal, made or missed, and fourth down short of the line, go to the other side;
  - a touchdown flips only once its try is in, so the try's kicker is the scoring side's.

`V7Reader.offenseFor` decides a segment's offense in this order:
1. a phrase in its PRE lines, or in its PLAY lines when the play is not a turnover or a kick;
2. its own vote, when the margin is `DECISIVE_VOTE` (2) or more, or nothing else is known;
3. the timeline at its first line, but only within the current drive (`currentAt`: a fact older than a line the tracker heard end the drive, a score, a turnover or a kick, is stale);
4. otherwise unknown.

That offense goes to the candidates (`prior:qb` only when it is known), to the GAME STATE block (with no down and distance from a call said after the segment began), and to `answerToPlay`. When a phrase or a vote decided it (`offenseSaid`), a play from scrimmage takes it whoever was credited. Otherwise a named credited player's side beats the tracker's. With `v7OffenseSaid`, `readPlays` passes `v7Offense` to the check, and a trusted pass or sack credit on the side without the ball goes to the quarterback on the field (R14), as a carry or catch there is dropped (R12). v6 never sets it.

On the dev games, dry: the offense sent agrees with ESPN on 67% of anchors, is wrong on 6% and unknown on 27% (before: 33%, 28% and 39%). When it is sent it is right 92% of the time. A dry run counts no plays, so it has no votes noted and no flips; the live figure comes from a paid run's `segmentDetail` (`offenseFrom` says which step decided).

`buildCandidates(segment, { offense, qbs }, roster, tonight)` lists the players the model may credit: every name hit at `CANDIDATE_MIN_SCORE` (0.55) or better across the play and post lines, with its heard-as spellings and tags (`by jersey`, `same surname`); the offense's quarterback as `prior:qb` (score 0 when not named) so a pass with no passer still has one; on a run nobody on the offense is named for, the back with most of tonight's carries as `prior:rb`, which only Part 7 may credit; at most `MAX_CANDIDATES` (8), best score first, then in the order the booth said them; index `NOT_NAMED` (0) last. The model answers with indexes, and `candidateAt` turns an index back into a player.

### 3.4 Extractor (`lib/livestats/extract/`, Part 5)

- `schema.ts`: a strict JSON schema of nine fields, all required, none nested (`playType` from `EXTRACT_PLAY_TYPES`, `carrierIdx`, `passerIdx`, `receiverIdx`, `tacklerIdx`, `yardsSaid`, `touchdown`, `penalty`, `confidence`); five are nullable (`NULLABLE_FIELDS`). `validateAnswer` turns an index off the list into NOT_NAMED and a number off the field into null, and refuses anything else so the call is tried once more.
- `prompt.ts`: `EXTRACT_SYSTEM_PROMPT`, under 600 words, what each field means and six rules (credit only a named candidate, a completion needs a catch word or a gain with a named receiver, the incompletion words, a sack is a sack whether or not the word is said, a scramble is a rush, when unsure choose NOT_NAMED or low). `test/extract/prompt.test.ts` holds the length and the rules, and that no prompt, example or fixture names a real school or player.
- `examples.ts`: fourteen synthetic worked examples (made-up names on made-up teams; two of them, since fix 1 Part 4, name the player only after the result) that go in the cached prefix with the system prompt (`cache_control: ephemeral` on the first system part in `run.ts`), so a call pays for them once an hour, not once a play.
- `request.ts`: the wire shape (`SegmentRequest`: the look, the segment's lines with roles, the candidates, the game state, the budget, the current answer on a re-read, a note on a gap read) and `readSegmentRequest`, which checks every field and cap (`MAX_SEGMENT_LINES` 40, `MAX_SEGMENT_CANDIDATES` 9, `MAX_HEARD_AS` 4, `MAX_NOTE_LENGTH` 300) before the route spends anything.
- `run.ts`: one call: `EXTRACT_MAX_TOKENS` (1,500), `EXTRACT_TIMEOUT_MS` (12 s), `EXTRACT_RETRIES` (1) on a reply the schema refuses, reasoning per the setting, never a temperature. Its result is the answer plus `SegmentCallUsage` (prompt, cached, cache-write, completion and reasoning tokens, dollars, seconds).
- `mapping.ts`: `answerToPlay` turns an answer into a `StatsPlay` with the events the play type allows (a run is a run, never a run and a sack), the end spot from the lines, a NOT_NAMED tackle dropped, a player marked out tonight dropped with R35, and the summary and evidence the strip and the log show. The name check trusts the candidate list and still blocks a player who is out tonight or on the wrong side.
- `confidence.ts`: the model's `high`, `medium`, `low` as the play's number, so `~` marks under `UNSURE_BELOW` as before.

### 3.5 Reconcile and the zero-retention check (`reconcile.ts`, `zdr.ts`, Part 8)

`reconcileSegment` sends the request to reader A (`LIVE_STATS_MODEL`/`LIVE_STATS_EFFORT`; Claude Haiku 5.5 at low when unset) and reader B (`LIVE_STATS_MODEL_B`/`LIVE_STATS_EFFORT_B`; GPT-6 Luna at low; `off` for A alone) in parallel. The agreement key is play type, carrier, passer and receiver. Agreed: `mergeAgreed` (the yards when both say the same or one says a number that is in the lines; the tackler either named; confidence high). Disagreed: the tie-break (Haiku at medium, `LIVE_STATS_TIE_BREAK_EFFORT`) sees the same request with both answers; its answer stands when it matches either reader, else `partialCredit` keeps only what both readers agreed on, NOT_NAMED where they named different players, confidence low. `LIVE_STATS_RECONCILE` chooses the mode (`RECONCILE_MODES`: `ab`, `aa` the same model twice, `ab-no-tiebreak`, `a`). The cost guard: past `GUARD_SKIP_B_USD` ($0.40) in a game B is skipped when A is sure and the list is short; past `GUARD_A_ONLY_USD` ($0.60) only A is called; at `LIVE_STATS_MAX_COST_USD` (1) the optional re-reads stop, then B. Every call goes through `segmentWire` in `lib/livestats/openrouter.ts`, which is `chat()` in `lib/ai/openrouter.ts` with `provider: { zdr: true, data_collection: "deny", require_parameters: true }`.

`zdr.ts` fetches OpenRouter's zero-retention endpoint list (`ZDR_ENDPOINTS_URL`), keeps it `ZDR_TTL_MS` (an hour) and refuses a reader whose model has no such endpoint; a fetch that fails or times out (`ZDR_TIMEOUT_MS` 8 s) refuses too, so a reader is never called on a guess. Reader A refused fails the segment with `zdr_refused` (`ZDR_REFUSED`) and nothing is sent; reader B refused leaves A alone (`b-unavailable`). The wire's own `zdr: true` still stands under both, so a call that slips past the list is refused by OpenRouter itself. The route builds the check once per process (`zdrCheckFor`).

### 3.6 Yards solver (`yards.ts`, Part 6; rule R47)

`solveYards(facts)` works each method out on its own and takes the first in `METHOD_ORDER`: an incompletion is 0 and exact; `stated` is the extractor's `yardsSaid` or a gain phrase in the play's lines; `dd` is the next down and distance with no flag between (same series: the gain is the old distance less the new; a first down: the old distance, exact only with a spot or a number beside it; "and goal": the goal line less the new distance); `spots` is the end spot less the start, both as yards from the offense's goal line; `ledger` is the drive ledger's figure. Two methods more than a yard apart keep the first and set `agree` false, which the play carries as an estimate. v7 calls it when a play is read (`solveFor`) and again for the play before when the next segment's down call arrives (`nextFacts`), writing the figure with `setPlayGain` (`session.ts`) under R47 and a reason naming the method.

**Since fix 1, Part 5:** the solver also reads the POST lines (`postLines`, `statedPost`), up to the first one that starts the next play (a snap, or a new-play phrase; a down-and-distance line stays, because its gain belongs to the play just over).
- A number said there ranks after the next down and distance, which is exact when it speaks, and before the spots. The play's source is `stated`.
- A running total or a box-score line is never this play's: "for the game", "this quarter", "12 carries for 87 yards".
- "Brought down after 7" is a gain.
- Because a segment is now read once its POST lines are in, a down and distance said after the play reaches the `dd` method at the first read.
- The session's own late-number rule (R23, `lateStatedYards`) also takes a number from just after the play, and takes it back once the next play counts.

**Since fix 1, item 2 (yards from spots and downs):**
- When nobody said a play's down or start, they come from the play before (`ballBefore`): `stateAfter` over the plays counted before it, when the last of them is this offense's and ended within `BALL_CARRY_MS` (50 s) of this play's first line.
- The next call is also searched in the `NEXT_CALL_LINES` (10) lines after the play, up to the next snap.
- On Checkpoint A's answers this changed nothing on the dev games. Of the 70 plays right but with no yards, 52 have no yards the words give at all (no gain said, no two spots, no next call on the same series; `ceiling.py`). Of the rest, most have no call before and none after, or a snap missed between.

### 3.7 Priors (`priors.ts`, Part 7; rule R48)

`applyPriors(play, roster, { allowInferredRb, out, tonight, qbs })`: a pass, sack or interception with no passer goes to the quarterback on the field (the tracker's, else the roster's starter), estimated; a run or catch with no named player is never guessed: it is credited to nobody and counted on the team's unattributed line (`unattributedOf`), which the report shows. `allowInferredRb` (`LIVE_STATS_INFER_RB`, off) would credit the `prior:rb` candidate when that back has `RB_SHARE` (80%) of tonight's carries after `RB_MIN_CARRIES` (3); it stays off until its precision on the dev games is 90% or better, which has not been measured (section 6). Every fill is a note under R48.

### 3.8 The loop and the re-reads (`v7.ts`, Part 9; rule R49)

`V7Reader` is a plain class with a `V7Host` (the controller's session, log, clock, roster, the route) handed in. `heard(seq, text, at)` parses and segments synchronously; segments go on a queue (`V7_QUEUE_MAX` 20; past it the oldest is dropped and logged as `segment_dropped`); one request is in flight at a time; `tick(now)` and `finish()` drain it.

**Since fix 1, Part 1:**
- **A segment that closes is held.** It goes on `held` until its POST lines are in, then to the queue in line order. It is released when any of these happens:
  - it has `POST_LINES` (5) POST lines;
  - its POST window closes (`postClosedAt`): the next down-and-distance call (kept as its last POST line), a snap cue, or a later segment closing;
  - `POST_WAIT_MS` (6 s, in `segment.ts`) has passed since it closed;
  - End game.

  Once released it is never added to. So the request carries what the booth said after the result, and the next play's pre-snap talk is never this play's.
- **The queue serves fresh reads first.** A first read or a second look goes before a drive re-read or a gap read, so the re-reads (about 200 a game on Oct 20) never hold up the next play. Past `V7_QUEUE_MAX` the oldest re-read is dropped first.
- **Re-reads and second looks send the original candidate list.** Their `current` indexes therefore mean the same players.
- **A gap read sends** the gap's own lines as PLAY, the two lines before them as PRE, and nothing after (those lines are the next play's).
- **Names said before the snap.** A player named only in a segment's PRE lines goes on the candidate list tagged `named before snap` (`NAMED_BEFORE_SNAP`). He ranks after everyone the PLAY and POST lines name and before the priors, and the cap stays at 8.
  - Why: a TV booth names the back in the backfield, then says only "hands it off". On the dev games, 33 of 34 names said but missing from the list were in the PRE lines, 27 of them on lines v6 counted as part of the play. Dev recall on name-said anchors went from 85% to 91%.
  - Rule 1 of the prompt lets such a player be credited only when the PLAY lines send the play to his role ("the single back gets the handoff", "the tight end is open"), never just because he was mentioned before the snap.
  - A second look is never asked on the strength of such a name.
  - A drive re-read never adds a credit to one: it may only keep a credit the first read gave him (R49). Every reply is logged as a `stats_reply` with `segmentId`, `agreement`, the raw `answer` and `v7Look`, so `restoreFromLog` rebuilds the loop after a reload and the recorded replay can re-run it.

- **Second look (R38):** when a segment comes back credited to nobody and one of its candidates was named at `V7_SECOND_LOOK_MIN_SCORE` (0.8) or better, the same segment is asked once more with `look: "second"`, at most `V7_SECOND_LOOKS_PER_GAME` (40) a game. The booth re-read's 12 and the gap re-read's 15 are caps as in v6.
- **Drive re-read (R39, R49):** when a drive ends (`newlyEnded` in `drives.ts`), each of its plays is sent again with its current answer (`look: "reread"`). An answer that changes nothing is dropped. A correction passes only when every player it credits was named in the segment (the passer may be the `prior:qb`), its yards are null, unchanged, a number in the lines or one a solver method gives, and nobody typed on the play; it is then merged as an update under R39, and a shared credit the correction no longer names (a tackle) is taken off (`dropSharedCredits`). A correction that fails is refused and noted on the play under R49 with the reason; a re-read that says the play was not a play discards it under R49 unless the announcer corrected it.
- **Gap re-read (R44):** the ledger's gaps (the downs skipped a snap) are read from the lines between the two plays, two lines each side, at most `V7_MAX_GAP_LINES` (40), capped at `V7_GAP_REREADS_PER_GAME` (15); a play it returns is noted R44 as in v6.
- **Booth lines:** the extractor returns no stat lines, so R41/R42 never fire under v7 (section 6).
- **Halftime:** unchanged (`halftime.ts`), and off in replays and the scorer under v7, because it is the v6 window reader at work.

Counts: `StatsCounts` gains `costUsd` and `pipeline`; `game.ended` carries the same counts as v6. Latency (seconds from a segment's last line to its stats applied) is kept per play and summarised in the manifest.

## 4. The harness

- `npm run replay:stats -- <log.json> --pipeline v7 [--model-b <id>|off] [--effort-b <level>] [--run-id <id>] [--max-cost <usd>] [--plays-json <path>]` (`lib/livestats/replayArgs.ts`; `test/replayFlags.test.ts`). `--dry` under v7 stubs the segment route (every read answered not a play) and prints the segments. `--plays-json` writes the plays file (`lib/livestats/playsJson.ts`, with the segments and every line's time under v7) and a manifest beside it (`lib/livestats/manifest.ts`: the run id, the git sha, the flags, every call's tokens, cost and seconds, p50/p95/max latency, the play counts). Both refuse a path inside the repository.
- **Since fix 1 (Part 0):**
  - Under v7 the plays file also has `segmentDetail`, one entry per request. Each entry gives:
    - the segment, look and close rule, and when it was sent;
    - the lines, candidates and game state, exactly as sent;
    - each reader's own answer (`answers`: `a`, `b`, `tieBreak`) and the reconciled one;
    - the failure code, if any, and the play it became.

    `V7Reader` keeps these only when built with `recordDetail`, which only the harness sets. The segment route takes `answers` off its reply, so what the browser receives is unchanged.
  - `--plays-json` works with `--dry` under v7. That file has `segments`, `lineTimes` and `segmentDetail`, with `plays` empty.
  - Ctrl-C or a kill writes the plays file and manifest as they stand, marked `"partial": true` with `stoppedBy`, and exits 130.
  - Under v7, `--max-cost` is also a hard cap on a live replay. At the cap nothing more is sent and End game's read is skipped; the files are marked partial (`stoppedBy: "max_cost"`) and the run exits 3, so `v7_one.sh` never keeps it as a finished game.
- **Recorded answers (fix 1):** `npm run replay:stats -- <log.json> --pipeline v7 --recorded --answers <a v7 run's plays file> [--plays-json <path>]` re-runs a run's recorded answers through today's code, with no network and no key.
  - Answers come from the run's `segmentDetail`, by segment id, look and occurrence (`recordedSegmentExtract` in `recorded.ts`).
  - A recorded index is mapped through its playerId to today's candidate list; a player not on it is NOT_NAMED.
  - Each call's recorded cost and seconds come from the manifest beside the file, so replies land when they did live.
  - A request the run never made is counted as a miss and printed: a re-read keeps its current answer, anything else is not a play.
  - The new manifest says `recordedFrom`.
  - This is how a change to segmentation, candidates, possession, yards or the merge is checked for free on a paid run's answers. It can't judge a change that needs a new answer, such as a new segment.
- **The replay clock (fix 1, Part 0).** Before fix 1, `runLiveReplay` waited for every call after every line, and a call's real duration moved the clock on. So the segmenter was told it was later than the next line's own time: on the Oct 20 dev runs, 204, 243 and 210 segments closed after the next line had already been said, and the live runs cut 7–9% more segments than a dry run of the same log. Under v7 the replay now runs on the transcript's own clock:
  - lines and the 2 s ticks are said at their log times while a read is in flight;
  - each reply lands at the moment it would have live (when it was asked plus how long it took), and the reader gets it then.

  A slow reader and an instant one now cut identical segments (`test/replayPlaysJson.test.ts`), so a `--dry` run's segments are the live run's. v6 keeps its old clock.
- `npm run score:stats -- <folder> --pipeline v7 [...]` scores a folder of games against the box score as before (`lib/livestats/score.ts`), driving the real controller under v7.
- Prices: `lib/livestats/prices.ts` (`PRICES`, the per-million rates for Haiku 5.5, GPT-6 Luna, Gemini 3.8 Flash and Sonnet 5.5 with the date each was checked; `test/prices.test.ts`). `CallUsage` carries reasoning tokens separately; `costFromUsage` prices a call when the reply carries no cost.
- The scoring tools live in `~/SpotterTestSet/tools` and are not in the repository. (The Oct 20 build named `common.py`, `ceiling.py` and `perplay_v7.py`, none of which exist.) The ones that do:

  | Tool | What it does |
  |---|---|
  | `perplay.py` | Aligns ESPN's plays to a log or a plays file and scores P+S, exact, within 3, missed and phantoms |
  | `perplay_run.py runs/<id> [label]` | Scores a run's v7 games beside the v6 Haiku replay in `haiku/`, with $/game and p95 from the manifests; writes `results/perplay-*.csv` |
  | `segscore.py runs/<id> [game ...]` | Segmentation against the anchors: the ESPN plays v6 Haiku got right. Reports one segment, split, missed, segments per play, segments touching no play |
  | `candscore.py runs/<id> [game ...]` (fix 1) | From `segmentDetail`: name said, candidate recall (all anchors and name-said anchors), and the offense sent against ESPN's `start.team.$ref` |
  | `ceiling.py [runs/<id>]` (fix 1) | What the broadcast makes knowable, from the lines 20 s before to 50 s after each play (see below), beside a run's P+S and exact |
  | `passers.py runs/<id>` (fix 1) | Wrong-team passers, and passes credited to nobody because no offense was sent |
  | `missedwhere.py runs/<id>` (fix 1) | Where the line naming each missed play's player went: PLAY or POST of another read, PRE only, no request, or never named |
  | `bucketex.py runs/<id> "<bucket>"` (fix 1) | Five examples of a `diagnose.py` bucket from `segmentDetail`. Dev games only: it prints transcript lines |
  | `diagnose.py <nick> <reader>` | Error buckets per game |
  | `v7_analysis.py runs/<id>` | Close-rule shares and the v7 failure patterns |
  | `audible.py` | Whether a missed player's name was said near the play at all |

  - `ceiling.py` measures two things:
    - **`C_player`:** the rusher, or on a completion the receiver, is named; on an incompletion, the passer is named or is his team's main quarterback that game.
    - **`C_exact`:** the yards can be worked out at all: an incompletion; the gain said; both yard lines said; or the next down and distance said on the same series with no flag.

    On the three dev games (Oct 20, fix 1): `C_player` is 71%, `C_exact` 47%, and both together 39%, against Checkpoint A's P+S of 49% and exact of 27%. `C_exact` is approximate: it cannot see yards the ledger works out across plays.
  - Dev and holdout are `perplay_run.py`'s `split`: eagles, packers and bama are dev; chargers, bills and steelers are holdout.
  - `diagnose.py all` and `v7_analysis.py` print transcript text, so run them on dev games only.
  - `~/SpotterTestSet/ABLATION.md` has one row per fix-1 part.

## 5. Acceptance (Part 10)

**Not run.** The session that built v7 (a cloud container, Oct 20) had neither `~/SpotterTestSet` nor an OpenRouter key, so no replay was made, no row was written to `ABLATION.md`, and none of the numbers below exist. The default stays v6 until Jed runs the dev games under both pipelines and the holdout games once, and v7's P+S is at least v6's at no more than its cost.

| run | pipeline | reader A | reader B | split | games | P+S | exact | missed | phantom | $/game | p95 s |
|-----|----------|----------|----------|-------|-------|-----|-------|--------|---------|--------|-------|
| v6 baseline | v6 | Gemini 3.8 Flash minimal | | dev | not run | | | | | | |
| v7 A alone | v7 | Haiku 5.5 low | off | dev | not run | | | | | | |
| v7 A+B | v7 | Haiku 5.5 low | GPT-6 Luna low | dev | not run | | | | | | |
| v7 A+B, no second looks | v7 | | | dev | not run | | | | | | |
| v7 A+B, infer RB | v7 | | | dev | not run | | | | | | |
| best of the above | | | | holdout | not run | | | | | | |

How to run it is in the README that travels with the tools: one replay per game per setting with `--plays-json` into `~/SpotterTestSet/runs/<runId>/<game>.json`, then `perplay_v7.py --split dev --ablation` for the row.

What was verified instead: `npm run check` and `npm run build` are green; the v7 loop runs end to end on a made-up game through the real controller with a faked route (`test/v7Pipeline.test.ts`, `test/reread.test.ts`, `test/v7Harness.ts`); every stage has its own table tests (`test/parse/`, `test/segment.test.ts`, `test/stateMachine.test.ts`, `test/candidates.test.ts`, `test/extract/`, `test/yards.test.ts`, `test/priors.test.ts`, `test/reconcile.test.ts`); the v6 tests all still pass. The Python tools were run on a made-up log, truth and plays file with synthetic names, not on a real game.

## 6. Known limits

- **No real-game number.** Everything above the unit tests is unmeasured: the segmenter's recall on a real broadcast, the candidates' coverage, the readers' agreement rate, the cost per game and the latency. The 79% figure in `yards.ts`'s header is the brief's, not a measurement from this build.
- **Booth stat lines are not read under v7.** The one-play schema has no `statLines`, so a running total the booth states (R41) never sets a player's total and the booth re-read (R42) never fires. v6 does both. A v7 game whose feed states totals loses that correction.
- **The ledger runs on v7 plays as it does on v6 plays**, but the solver's `dd` and `spots` figures are written as the reader's own (`SOLVER_SOURCES`), so the ledger will not overwrite them with its own; a wrong down call therefore sticks until a re-read or a typed correction.
- **One request in flight.** A burst of segments (a hurry-up drive) queues; past 20 the oldest is dropped and logged. Latency on a fast drive is bounded by the readers, not the loop.
- **The zero-retention list is a dependency.** If OpenRouter's endpoint list is unreachable, every segment fails with `zdr_refused` (the check asks again on the next segment, and after an hour once it has an answer), and after `MAX_FAILURES` the loop pauses until the switch goes off and on; the game goes on without stats, as G4 requires. The wire's own `zdr: true` would refuse the same calls, so this costs availability, never privacy.
- **`allowInferredRb` is off and unmeasured**, so a run nobody is named for is credited to nobody. The team's unattributed line shows it on the report, not on a card.
- **The halftime checkup is v6's.** It re-reads the first half with the window prompt; under v7 it still runs live (not in replays) and its corrections go through the same re-read path, but it has not been run on a v7 game.
- **A reload mid-game rebuilds the loop from the log**, not the segmenter's open segment: lines said while the page was down are read when the next segment closes, as in v6's watermark, but a play that straddled the reload can be read twice (the merge dedupes by lines).

## 7. The non-negotiables and the tests that hold them

1. The card path imports nothing from `lib/livestats/`, `components/livestats/` or `lib/livestats/parse/`, type imports included, and no file in a client bundle names OPENROUTER or reads a server-only variable: `test/isolation.test.ts` walks the imports from `components/NameDisplay.tsx`, `components/PlayerCard.tsx`, `components/live/LiveScreen.tsx` and from every `"use client"` root.
2. The parser and segmenter are synchronous and under 5 ms a line: `test/parse/benchmark.test.ts`. Model calls are async and off the hot path: `V7Reader.heard` queues and returns; `test/cardPathIsolation.test.ts` still reads `LiveScreen.tsx`'s source.
3. Every model call goes through `lib/livestats/openrouter.ts` with the zero-retention provider block and never a temperature: `test/openrouterClient.test.ts` holds the provider block on every `chat()` body and fails if any app, lib, component or script reads an Anthropic key or imports the SDK; `test/reconcile.test.ts` holds that a reader the zero-retention check refuses is never called.
4. No real names in a prompt, example or fixture: the prompt and the examples never say "high school" (`test/extract/prompt.test.ts`), the fourteen examples are written on made-up names, and every v7 test roster is `test/parse/roster.ts` (synthetic).
5. The test set never reaches git: `.gitignore` (`*SpotterTestSet*`, `spotter-v3-log*`, `*.manifest.json`), `test/testSetNotTracked.test.ts`, and `.githooks/pre-commit`, installed by `npm install` (`scripts/install-hooks.mjs` sets `core.hooksPath`), which runs `scripts/check-staged-paths.mjs` and refuses any staged path naming `SpotterTestSet` or `spotter-v3-log` (`test/preCommitHook.test.ts`).
6. No temperature on a Claude call with reasoning: `chatBody` never sets one (`test/openrouterStats.test.ts`).
