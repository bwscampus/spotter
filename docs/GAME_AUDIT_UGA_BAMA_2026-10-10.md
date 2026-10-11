# Game audit: Georgia 20, Alabama 17 (Oct 10, 2026)

Written Oct 10, 2026. Session `7912da92`. Spotter run against the ABC broadcast. This was the first game read by **Claude Haiku 5.5** (effort low), after the switch from Gemini merged on testrun2 that afternoon (PR #29). The Oct 9 fixes (PR #27) were in. The truth is ESPN's play-by-play and box score (game 401856712). The game was in Tuscaloosa (Alabama home, Georgia away).

## 1. Where it stands

Of the 137 plays that put a stat on someone (kneels, timeouts and touchbacks left out):

| Result | Plays | Share |
|---|---|---|
| Right | 29 | 21% |
| Right, yards blank or off | 18 | 13% |
| Partly counted | 15 | 11% |
| Wrong player or wrong stat | 12 | 9% |
| Missed | 63 | 46% |

**Count stats against the ESPN box: 11 of 53 cells match (21%).** That's against 60% for the Oct 9 high school game. Stockton shows 14 of 18 (official 18 of 22), Russell 8 of 17 (16 of 30), Phillips 5 carries (17), Brown 1 carry (9), Hill 0 (4 carries, 3 catches).

| Kind of play | Right or right with yards blank | Missed |
|---|---|---|
| Runs | 14 of 58 | 38 |
| Completions | 10 of 35 | 10 |
| Incompletions | 13 of 18 | 4 |
| Sacks | 2 of 6 | 0 |
| Kicks, punts, returns | 3 of 19 | 13 |

**Cost:** about $0.13 for the game on Haiku: 3.1M tokens in, 2.9M of them cached, 145k out, 258 calls. The same tokens on Gemini would have been about $0.93, so the switch saved what it promised. 149 of the 258 calls returned no plays.

## 2. Causes

| # | Cause | Plays | What happened |
|---|---|---|---|
| 1 | **The reader wrote ids with extra words** | 28 | New with Haiku: Gemini never did this in four games. It sent "A14-STOCKTON Gunner QB" or "H18-HUBBARD Bray" instead of "A14-STOCKTON". 51 credits were thrown out as "not on either roster". Gone this way: Hubbard's interception, 5 Phillips carries, Humphreys, Taylor and Reddell catches, Edwards, Hill, Miller's punt, Bolden's sack. When it happened to the passer, the passer fill gave the pass to the quarterback, which was right only by luck. |
| 2 | **The reader skipped plays the booth described** | 47 missed, 8 misread | "Crowell off the left side slips a tackle", "this is Crowell at the right side", "Woodring ... a 23-yarder ... chip shot ... caps off a wonderful drive", "Stockton downfield shot ... Dandridge". All were said clearly, and the window that held them came back empty or with another play only. The prompt says to return a play "only once its outcome is known", and a TV booth often never states one. |
| 3 | **An update moved a touchdown to the other team** | 3 | The reader sent Russell's 22-yard TD to Pritchett as an update to Georgia's TD to Humphreys, 120 lines earlier. The code accepted it: Humphreys lost his TD, Stockton got credit for throwing Alabama's TD, and Russell got nothing. Then the same thing happened to Stockton's 14-yard TD run, which became a Crowell run and was dropped. |
| 4 | **The quarterback on the field switched on a wiped play** | 3 | "Burlisi" (Deepgram for a Phillips run) gave Ryan Puglisi a carry. Later an update on a holding-wiped play named Puglisi as the passer. That made Puglisi the "quarterback on the field", so the next fills gave Stockton's completions to Puglisi. |
| 5 | **The booth said a different name** | 1 | The booth said Brooks; it was Scott. |

Causes 1, 3 and 4 are code. Cause 2 is the reader (model plus prompt). Whether it's Haiku at low effort, the prompt, or this booth can only be settled by replaying this log through each. Cause 5 is the call.

**What was right:**
- All five plays wiped by a flag added nothing.
- Incompletions were 13 of 18.
- The 3 fumbles were found.
- Nothing was counted twice.
- No play came from the highlight cut-ins of other games, or the ads, both of which Deepgram transcribed.

## 3. Fix list, in priority order

1. **Take the id the reader meant.** 28 plays. **Fix:** when a returned id isn't on a roster, use the roster id it starts with ("A14-STOCKTON Gunner QB" is A14-STOCKTON). Failing that, use side plus surname when exactly one player matches ("H-HUBBARD" is H18-HUBBARD). Otherwise keep today's drop. Also put each roster line in the prompt as `A14-STOCKTON | Gunner | QB`, and tell the reader to copy the id before the first bar only. This is a certain fill, the same kind as the passer rule. Confidence: High.
2. **An update stays on its own team.** 3 plays, including 2 touchdowns. **Fix:** an item the reader marks as an update of a play is dropped and logged when its offense differs from that play's, or when its ball carrier, receiver or passer is on the other team. Making it a new play would have given the passer a phantom touchdown. The side check runs on the play after any update, not only on new plays. Confidence: High.
3. **A wiped play can't change the quarterback on the field.** 3 plays. **Fix:** currentQbs skips wiped-out plays and credits the code filled in. Only a quarterback the reader named, on a play that counts, changes who is on the field. Confidence: High.
4. **Recall: return a play when the next one starts, even with no result said.** About 47 plays. **Fix:** change the reader's rule from "only once its outcome is known" to: a play is finished when the booth has said who had the ball, or when the next snap or the next down and distance comes; return it then with yards blank if no gain was said. Then replay this log three ways (Haiku low, Haiku medium, Gemini) with fixes 1 to 3 in place, and count plays found against ESPN. Haiku medium costs more output but is still well under Gemini. Confidence: Medium. This is the largest gap, and the only one that needs a live replay, with your OpenRouter key on your Mac.
5. **Don't call the reader on ads.** Several calls read stretches of Geico, Navy Federal and NFL promos. The "sounds like football" filter let them through because of words like "Thursday night football". Low priority: it's money, not accuracy, and a booth call has no ads.

## 4. Where that would leave it (estimate)

| | Right player and stat (yards aside) |
|---|---|
| Tonight | 47 of 137 (34%) |
| After fixes 1 to 3 (code only, can be checked by replay with no key) | about 78 (57%) |
| Plus fix 4 recovering half the skipped plays | about 100 (73%) |
| Ceiling on this broadcast | about 90%: a handful of plays were never described, or were called with the wrong name |

## 5. How this compares with your own call

On Oct 9 (your booth, a high school game), missed plays were 6%. Here they're 46%, and 47 of the 63 were plays the booth did describe. The difference is the booth's style. ABC's crew describes a play once, often without a result, then talks over the replay. You and Eli say the down, the runner and the result every snap. So TV tests are a good stress test for recall, but fix 4 matters much more for them than for the product's real use.

## Sources

- ESPN box score and play-by-play, Georgia at Alabama, Oct 10, 2026, game 401856712: https://www.espn.com/college-football/game/_/gameId/401856712/georgia-alabama
- Spotter exports for session `7912da92` (stats, matches, log, report).
