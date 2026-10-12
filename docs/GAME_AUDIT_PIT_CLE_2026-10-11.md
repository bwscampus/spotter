# Game audit: Browns 27, Steelers 24 (TNF, Oct 1, 2026, run Oct 11)

Written Oct 11, 2026. Session `77852e49`. Spotter ran live against a replay of the Prime Video broadcast of Thursday's game, on testrun2 with fix 5 merged (PR #34): game state block, yards from field position, second look, drive re-read, halftime check on Sonnet 5.5. The reader was Gemini 3.8 Flash, the code default (assuming no Railway override on testrun2). The truth is ESPN's play-by-play and box score, game 401872964. Cleveland was home.

The recording stopped after Szmyt's 56-yard field goal, so the last two snaps (Delpit's interception and the kneel) are left out of everything below.

## 1. Where it stands

Of the 163 plays that put a stat on someone (kneels, touchbacks and two-point tries left out, flagged no-plays kept in):

| Result | Plays | Share |
|---|---|---|
| Right, yards right or not needed | 103 | 63% |
| Right, yards blank or off | 39 | 24% |
| Partly counted | 3 | 2% |
| Wrong player or wrong stat | 7 | 4% |
| Missed | 11 | 7% |

**Right player and stat: 142 of 163 (87%).** That's the first live game at the level the Georgia–Alabama replay reached on Gemini (88%), and well above the live Haiku game (34%).

Of the 156 plays where the booth actually said who had the ball, 142 are right: **91% of named plays.**

| Kind of play | Right (yards aside) | Not right |
|---|---|---|
| Runs | 37 of 44 | 2 wrong, 5 missed |
| Completions | 41 of 46 | 2 wrong, 2 partly, 1 missed |
| Incompletions | 24 of 24 | |
| Sacks | 7 of 7 | |
| Interception | 1 of 1 | |
| Field goals, extra points | 7 of 8 | 1 missed |
| Punts | 8 of 9 | 1 partly |
| Kickoff returns | 4 of 8 | 4 missed |
| Flagged no-plays | 13 of 16 | 3 counted anyway |

**Count stats against the ESPN box: 29 of 47 cells match (62%)**, total count error 27. Comparing on NFL terms means sacks are taken out of Spotter's carries (Spotter counts them as runs, the high school and college way). The cells that miss are each off by one or two plays: Judkins has 13 carries (17), Wetjen 0 kick returns (4), Watson 23 of 31 (24 of 32) with 1 of 1 given to Taylen Green, Rodgers 41 attempts (39).

**Yards:** of the 97 plays that carry yards, 58 are right, 32 blank and 7 off. Passing yards kept: Rodgers 194 of 299, Watson 142 of 268, so 59% of the real total (54% at Georgia–Alabama).

**Cost:** about $1.60 for the game. 487 calls (419 regular, 40 second looks, 27 drive re-reads, 1 halftime check), 4.1M tokens in with 2.8M cached, 94k out. The halftime check on Sonnet was about $0.07 of that. This sits inside the $1.50–2 fix 5 estimate.

## 2. Where the yards come from

This is the clearest finding of the game:

| How the yards were found | Right | Wrong |
|---|---|---|
| Said in the call, read by the reader | 46 | 1 |
| Worked out from down and distance, or yards short of the first down | 6 | 0 |
| Worked out from yard lines (fix 5 Part 4) | 4 | 4 |
| A number said one line after the play (fix 5 Part 4) | 2 | 2 |

What the booth says and down-and-distance math are nearly always right. The two new sources are a coin flip, and a wrong number is worse than a blank one because nobody can tell it apart from a right one. The six wrong:

- Washington's 6-yard catch became 47. The next line was "had a huge 47 yard gain against the Bengals on Sunday".
- Watson's fumbled run (-5) became +6, from a number on the next line.
- Wilson's 49-yard catch became -6. "Tackled to the 22" was put on Pittsburgh's side when it was Cleveland's.
- Watson's 21-yard scramble became 8. "To the 38 yard line" was put on the wrong side of midfield.
- Judkins' 10-yard catch became 0. "Just past the 30" was where he caught it, not where he was tackled. The booth also said "4 yards shy of the 1st down", which gives the right 10.
- Wilson's 13-yard catch became 20, from "caught up past the 30".

## 3. Causes of the 21 plays that aren't right

| # | Cause | Plays | What happened |
|---|---|---|---|
| 1 | **The booth never said who had the ball** | 7 | A Judkins run and a Sanders catch during a baseball story, a Judkins run, a Warren run ("3rd and 1"), Watson's 2-yard scramble and fumble ("loses the ball but recovers it himself"), Watson's 1-yard run, and Boswell's first extra point (never mentioned, only "7 nothing Steelers"). |
| 2 | **Name check dropped Wetjen's kick returns** | 4 | Deepgram heard Wetjen as "weegen", "legion" and "the region". The reader picked Wetjen every time, but the name check (R18) found no close spelling and dropped all four. |
| 3 | **A pass on a flagged no-play was counted** | 3 | Illegal contact on an incompletion ("defensive penalty, automatic 1st down"), defensive holding on an incompletion, and defensive holding accepted on Boston's catch that replay had moved short. In the NFL and NFHS these are all no-plays, but the reader marked them as counting. |
| 4 | **Reader misreads** | 6 | McLaughlin given a Judkins run, Jeudy given a Judkins run, Fannin given a Jeudy catch, two catches with no receiver read, one punt return missed. |
| 5 | **The wrong quarterback got the first pass** | 1 | The opening completion was said without Watson's name. The passer fill (R14) replaced the reader's Watson with Taylen Green, because with no season stats on the roster, the "default starter" is the first QB listed. |

Cause 1 is the booth. Causes 2, 3 and 5 are code, 8 plays. Cause 4 is the reader.

**What worked:**
- All 24 incompletions.
- All 7 sacks.
- Every touchdown.
- Both of Szmyt's made field goals and the miss.
- 13 of 16 no-plays.
- Nothing counted twice.
- No phantom touchdowns.

The second look added 6 plays that would have been missed. The halftime check made one correction (Concepcion's 27-yard catch got its receiver).

## 4. Things fix 5 got wrong

- **The halftime check ran at the two-minute warning.** "Good day Carissa and the gang coming your way at halftime" set it off at seq 708, with 2:00 left in the half. It runs once, so the last two first-half drives (Fannin's TD, Wilson's 49, Boswell's field goal) never got the halftime look. A promo for halftime is not halftime.
- **Yards from yard lines and from the next line** (section 2): 6 right, 6 wrong.
- **The scorer will mark NFL sacks wrong.** ESPN's NFL box doesn't count a sack as a carry; Spotter (and the college box) do. Run against this game, `score:stats` would report Rodgers 5 carries for -18 against 0.

## 5. Fix list, in priority order

1. **Blank beats wrong for worked-out yards.**
   - Yard-line math runs only when both spots are certain: the side is said, or there's only one reading that fits. When the side isn't said, try both readings. Keep the one that agrees with the next down and distance, or with "first down"/"big run"/"short of the sticks". If both or neither fit, leave the yards blank.
   - "Past the N" and "near the N" are where the ball was caught, not where the play ended, so they never feed yard math.
   - When yard lines and down-and-distance disagree by more than 3, use down-and-distance.
   - A number on a later line counts only if:
     - it's followed by "yard(s)", "-yarder" or "for N", before the next snap;
     - the line has no stat-talk words (season, career, last week, on Sunday, against the <other team>, this year, has N yards);
     - it agrees with the spots when they're known.

   Expected: 6 wrong yards become 4 blank and 2 right. Confidence: High.
2. **Sound-alike names on kicks and returns.**
   - R18 keeps the reader's credit when a word in the play's lines sounds like the surname by a phonetic key: Wetjen → "weegen", "legion", "region" share the "-jen/-gen/-gion" ending and the syllable count.
   - This applies only to roles one player fills (kick or punt returner, kicker, punter), and is logged as "sound-alike".
   - Better still, after the first time the reader and a sound-alike agree, keep that heard form as a per-game alias, so the later returns pass the plain check.

   4 plays and 4 count cells. Confidence: High.
3. **A defensive foul on a pass makes it a no-play.** Defensive holding, illegal contact or pass interference, accepted (not "declined", or the booth says "automatic first down" or "1st down"), on a pass play marks the play nullified, whatever the reader said. Roughing the passer and post-play personal fouls don't. 3 plays. Confidence: High.
4. **The reader's quarterback beats an unconfirmed default.**
   - Until a named QB credit has set who's on the field, R14 keeps the reader's passer when he's a QB on the offense.
   - When the first named QB credit arrives, re-point any earlier passes on that side that were filled with the default.
   - Optional: a "starter" tap per team next to the "Out" toggle.

   1 play here, but it would have hit every pass in a game where the first several are unnamed. Confidence: High.
5. **Halftime only at halftime.** Trigger on:
   - the first second-half play or kickoff;
   - "end of the first 0.5", "that'll do it for the 0.5", or "halftime score";
   - 6+ minutes of quiet after a Q2 play with the clock under 0:30.

   "At halftime" and "coming up at halftime" don't count. Confidence: High.
6. **Extra point from the score.** When the booth says a score ("7 nothing Steelers") that is one more than the touchdown gives, and no try was read, credit the kicker with the made extra point (R32 already knows the kicker). 1 play here. It happens most on TV, where the extra point is often shown and not said. Confidence: Medium.
7. **Scorer: NFL counting rules.** For `league: "nfl"` truth, take sacks out of Spotter's carries and rush yards before comparing (kneels stay in, ESPN counts them). Code-only, no effect on the live product.

## 6. Where that would leave it (estimate)

| | Right player and stat | Of plays the booth named |
|---|---|---|
| Tonight | 142 of 163 (87%) | 142 of 156 (91%) |
| After fixes 2–4 and 6 | about 151 (93%) | about 151 of 157 (96%) |
| Ceiling on this broadcast | about 157 (96%): 6 plays never described | 100% |

So on player and stat, the 95% target for named plays is within reach with code fixes alone. **Yards are now the gap:** 58 of 97 right, and fix 1 trades 6 wrong for blanks rather than adding many right ones. The next gain in yards comes from the reader reading the "to the 23"/"first down" lines more reliably, plus the down-and-distance math, which went 6 for 6.

## 7. Test set

Truth file `statcast-log-20261011-2002-77852e49.truth.json`: `{"source":"espn","league":"nfl","gameId":"401872964"}`. It stays out of git with the others. The ESPN box includes the final interception and kneel that the recording missed, so expect Rodgers att/int, Delpit int and Watson carries to show 1 off in `score:stats`.

## Sources

- ESPN box score and play-by-play, Steelers at Browns, Oct 1, 2026, game 401872964: https://www.espn.com/nfl/game/_/gameId/401872964
- Spotter exports for session `77852e49` (log, stats, matches, report).
