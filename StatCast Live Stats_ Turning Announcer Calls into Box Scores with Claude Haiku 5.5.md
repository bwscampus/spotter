# StatCast Live Stats: Turning the Announcer's Call into a Box Score with a Haiku-Class Model

The bottom line: the cheapest design that can get close to your goal is mostly plain code with a small model doing the reading, not the other way round. It works like this. One shared Deepgram stream feeds both features. Deterministic parsers track yard lines, down and distance, and jersey numbers. A code state machine keeps the game state. Claude Haiku 5.5 is called once per play, in a stateless call with a cached roster and rules prefix, and returns opaque roster IDs through structured outputs. Code checks every claim against the next down-and-distance call, and the model runs a reconciliation pass at quarter breaks. Model cost should be about $0.10 to $0.30 per game. Whether the whole thing stays "well under $1" depends on what Deepgram actually charges for streaming with model-training opt-out, which I could not pin down. The 85% yards goal looks reachable on offensive plays. The 95% goal is at the edge for offensive credits and very unlikely if every tackle in the official play-by-play counts, because announcers don't name a tackler on every snap. No model fixes words that were never said.

**Evidence labels used below:** *(sourced)* means a named document I read or saw quoted; *(vendor)* means the claim comes from the company selling the product; *(inference)* means my reasoning, and the strength is stated.

## TL;DR

- **Build a code-first pipeline with Haiku 5.5 as a per-play reader.** Deterministic parsing, a game-state machine and a "next down-and-distance confirms the last play" check do most of the accuracy work. Haiku 5.5 resolves who did what. Expect roughly $0.10 to $0.30 per game in model costs at $0.10/$0.50 per million tokens with $0.01 cache reads, plus speech recognition that is either already paid for by player cards or about $0.30 to $0.92 per game.
- **The goal is only partly reachable, and the limit is the announcer, not the model.** My estimate (inference, moderate confidence) is 93 to 97% right-player-right-stat on offensive and kicking credits, 80 to 90% with exact yards, and 75 to 88% if every defensive tackle credit has to match. Your first experiment should measure how often the call actually names the credited player, because that number caps everything.
- **Don't fine-tune, don't feed the whole game to the model every play, and don't send audio straight to an LLM.** Fine-tuning isn't offered for any current Claude model. Long prompts cross Haiku 5.5's 100,000-token price step (5x). In the independent Structured Output Benchmark (arXiv 2604.25359), the best model scored 83.0% value accuracy on text but only 23.7% on its "audio" set, which was speaker-labelled meeting transcripts rather than raw audio. So conversational speech is already hard as text, and skipping ASR is my inference, not something that benchmark tested. Spend the first two weeks hand-charting three of your archived games instead; that test set decides everything else.

## Key Findings

1. **No one has published accuracy for turning American football announcer speech into a box score.** The academic work goes the other way (data to commentary) or covers soccer, tennis and basketball text.\[1\]\[2\]\[3\] High school stat products are manual tap-entry apps or human video tagging.\[4\]\[5\]\[6\] You are building something new, so your own test set is the only evidence that will count. *(sourced, strong for "nothing found"; absence of evidence is weaker than evidence)*
2. **Haiku 5.5 is priced for this, but it is one week old.** Anthropic's docs list $0.10/$0.50 per million tokens up to 100,000-token prompts, $0.50/$2.50 above that, $0.01 cache reads, a 512-token minimum cacheable prompt, structured outputs, and an effort dial with medium as the default.\[7\]\[8\]\[9\] There are no independent tests yet on noisy conversational event extraction. General independent scores (Artificial Analysis) put it ahead of GPT-6 Luna at the same price.\[9\] *(sourced; task-specific evidence is missing)*
3. **ZDR is workable but has traps.** Haiku 5.5 is not one of Anthropic's "Covered Models" (Fable and Mythos), which require 30-day retention.\[10\]\[11\]\[12\] So by Anthropic's own page it falls under normal ZDR, though the page never names it. ZDR on the Claude API needs an arrangement with Anthropic. Structured outputs cache the JSON schema for up to 24 hours, so minors' names must never go in the schema.\[13\] Deepgram keeps audio for training unless every request sets `mip_opt_out=true`.\[14\]\[15\] *(sourced, with one inference flagged)*
4. **Speech recognition sets a hard ceiling, and keyterm limits can hurt your player-card feature.** Deepgram's keyterms are capped at 500 tokens per request.\[16\] Deepgram's changelog correction on over-limit Configure keyterm updates says such an update "stops transcription without an Error, and after about 30 seconds the server closes the stream with 1011 (NET-0000)." A careless roster push from the stats side could take down player cards. *(sourced)*
5. **Getting yards right is a game-state problem more than a language problem.** NFHS stat rules measure yards from line of scrimmage to dead-ball spot, with specific rules for penalties, sacks and returns.\[17\]\[18\] Announcers usually say spots and the next down-and-distance. Code that computes yards from spots and checks them against the next "second and 4" will beat any model guessing a number. *(sourced rules; inference on effect size, moderate confidence)*

## Details

### 1. Prior art: what exists and what it reached

**Academic work.**
- Recent sports-language datasets mostly generate commentary *from* event data. Examples are the Live Football Commentary (LFC) dataset of 40 J1 League matches, about 60 hours of timestamped Japanese commentary aligned with tracking data, and LLM-Commentator, which fine-tunes LLaMA on Opta event data.\[1\]\[3\]\[19\] These go in the opposite direction from StatCast. *(sourced)*
- "Moneyball with LLMs" (arXiv 2510.18173, Arizona State and Adobe Research) builds SporTabSet from 998 2025 NBA games' ESPN play-by-play text plus over 6,500 cricket commentaries, and tests LLMs turning them into box-score tables. The best basketball cell accuracy was 75% (Gemini 2.5 Flash), and the authors conclude "multi-entity memory, rather than local arithmetic, is the primary bottleneck." It is the closest task to yours, but it uses clean written play-by-play, not live speech, and its finding supports keeping the running tally in code rather than in the model. *(sourced)*
- A survey of AI game commentary notes that commentary data needs "audio track extraction, transcription, and manual proofreading and annotation."\[20\] That matches what your test set will cost. *(sourced)*
- An older voice-recognition game-analysis study (Journal of Science and Medicine in Sport) had trained observers speak gait categories into software and reported "90% or better accuracy" with 1.9% classification error.\[21\] The speakers were trained to talk *for the machine*, which you can't ask of announcers. *(sourced; weak relevance)*
- A Naver patent on finding sports video moments reports F1 of about 0.6 or more using commentary speech recognition, against about 0.4 or less from video action recognition alone.\[22\] This is weak but real evidence that commentary carries event signal. *(sourced, patent, low rigor)*

**What high schools actually use.**
- XO Stats, PressBox Football Stats, iTouchdown and MaxPreps' MaxStats are all manual play entry by a statistician.\[4\]\[6\]\[23\]\[24\] *(sourced)*
- Hudl sells human-tagged breakdowns (Assist). One Indiana coach on a forum said they dropped Hudl Assist because they "had to fix half the games anyway."\[5\]\[25\] That is one anecdote, but it is a warning that "official" stats are noisy too. *(sourced, weak)*
- SnapStat advertises "90% Target Accuracy" for predicting which player was involved. It is marketing language for a product "coming soon," so give it no weight.\[26\] *(vendor)*

**Takeaway (inference, strong):** there is no published baseline to beat. Your accuracy claims will rest on your own hand-charted games.

### 2. Claude Haiku 5.5: what is documented

| Item | Value | Source quality |
|---|---|---|
| Price, prompts ≤100k tokens | $0.10 in / $0.50 out per M; cache read $0.01; 5-min write $0.125; 1-hr write $0.20 | Anthropic docs via OrcaRouter, aiwiz, VentureBeat (sourced)\[7\]\[9\]\[27\] |
| Price, prompts >100k tokens | $0.50 / $2.50; whole request reprices | same (sourced)\[7\]\[28\] |
| Tokenizer | ~30% more tokens than Haiku 4.5 for same text | Anthropic "What's new" (vendor)\[8\]\[29\] |
| Context / output | 1M / 128k | Anthropic release notes (vendor), confirmed by Artificial Analysis\[8\]\[30\] |
| Min cacheable prompt | 512 tokens | Anthropic "What's new" (vendor)\[8\] |
| Structured outputs | Yes on Claude API and Claude Platform on AWS; **not on Bedrock** | Anthropic docs (vendor)\[13\]\[30\]\[31\] |
| Removed | `temperature`, `top_p`, `top_k`, prefill, `budget_tokens` return 400 | Anthropic release notes (vendor)\[30\] |
| Thinking | Adaptive, on by default, effort default `medium`; can disable at low/medium/high | Anthropic prompting guide (vendor)\[7\]\[32\]\[33\] |

**Independent evidence.**
- Artificial Analysis scores Haiku 5.5 at Max effort at 43 on its Intelligence Index and measures 236 output tokens/second.\[34\] It also flags verbosity: 440M tokens generated during the index run, against a 95M median.\[7\] *(sourced, independent)*
- At Medium effort, the score drops to 34.\[35\] *(sourced)*
- A secondary write-up of Artificial Analysis's AA-Omniscience test puts Haiku 5.5's hallucination rate at 40%, against 77% for GPT-6 Luna.\[9\] That is a closed-book knowledge test, not grounded extraction, so it says more about the model's willingness to abstain than about your task. *(sourced, secondary, indirect)*

**What the vendor's own guide says matters for accuracy.**
- **Effort:** `low` for simple high-volume calls, where Anthropic says the model is "more likely to skip... a check"; `medium` as the default. Changing effort between requests invalidates the cache.\[33\] *(vendor)*
- **Structured outputs:** constrained JSON. Prompts and responses are processed with ZDR, but "the JSON schema itself is temporarily cached for up to 24 hours."\[13\] *(vendor)*
- **Multi-turn costs:** thinking blocks from earlier turns stay in context and are billed as input.\[8\] *(vendor)*

**Known failure modes of small models on extraction, and their remedies.**
- **Valid but wrong JSON.** The Structured Output Benchmark (arXiv 2604.25359) found GPT-5.4 at 99.97% JSON pass rate but only a 0.486 "perfect response" rate. It calls in-field hallucination "invisible without field-level verification against the source." Schema constraints moved value accuracy by only −0.007 to +0.033.\[36\] *(sourced, independent, strong)*
  - **Remedy:** require a verbatim evidence span for every credited player and spot, and have code check that the span exists in the transcript and contains the name or number.
- **Multi-speaker conversational transcripts are much harder.** The same benchmark (JigsawStack, 21 models) reports best value accuracy of "83.0% on text, 67.2% on images, and 23.7% on audio." Its 115 audio records came from the AMI meeting corpus and were "supplied as timestamped, speaker-labelled conversation transcripts," so models never heard raw audio. *(sourced)*
  - **Remedy:** keep speech recognition separate, and narrow each model call to a short single-play window with a tight schema rather than asking it to read long conversation. That the benchmark's low score carries over to football calls is my inference.
- **Inventing a player.** *(inference, strong)*
  - **Remedy:** constrain player fields to an enum of opaque roster IDs (`H23`, `A07`) plus `UNKNOWN`. The model can't name someone who isn't on the roster, and the cached schema holds no minors' names.
- **Double-counting recaps and stat-line reads.** *(inference, strong; this is the classic failure for this task)*
  - **Remedy:** add an explicit `utterance_kind` enum (`live_play`, `recap`, `stat_line`, `other`) and only commit `live_play`.

### 3. Models at a similar price with ZDR (October 2026)

| Model | Input / Output per M | Cached input | ZDR path | Notes |
|---|---|---|---|---|
| Claude Haiku 5.5 | $0.10 / $0.50 (≤100k) | $0.01 | Claude API with Anthropic ZDR agreement; not a Covered Model (inference from Anthropic's page) | AA Index 43 at Max (sourced)\[7\]\[9\]\[10\] |
| GPT-6 Luna | $0.10 / $0.50 (≤272k) | $0.01; cache write $0.125 | `/v1/responses` lists gpt-6-luna as ZDR-eligible; needs OpenAI approval; extended prompt caching is *not* ZDR-eligible | AA Index 38 per secondary source; 1,024-token cache minimum (sourced)\[9\]\[37\]\[38\]\[39\] |
| Gemini 3.5 Flash-Lite | $0.30 / $2.50 | $0.03 | Vertex AI; reseller listing says "Data retention: None" (secondary) | 3x input and 5x output price; ruled out on cost per quality (inference)\[40\]\[41\] |

**Verdict (inference, moderate):** Haiku 5.5 and GPT-6 Luna are the two real options. Haiku has the better independent general scores and lower measured hallucination. Luna is the hedge. Build the extractor behind a thin interface and run both on your test set; the vendor benchmarks don't settle it.

**Fine-tuning or distillation:** not available. The only fine-tunable Claude is Claude 3 Haiku on Bedrock, in us-west-2. One source reports it reached end of life on September 10, 2026, and a Bedrock pricing review says no current-generation Claude model supports fine-tuning.\[42\]\[43\] *(sourced, moderate)* Don't plan around it. Few-shot examples taken from your own games are the substitute.

### 4. Speech recognition

**Prices (pay-as-you-go, 2 hours of audio):**

$$
\begin{aligned}
\text{Deepgram Nova-3 streaming, list:}\quad & 120 \times \$0.0077 = \$0.92\\
\text{Deepgram, promotional rate:}\quad & 120 \times \$0.0048 = \$0.58\\
\text{Deepgram keyterm add-on:}\quad & 120 \times \$0.0013 = \$0.16\\
\text{AssemblyAI Universal-Streaming:}\quad & 2 \times (\$0.15 + \$0.04\ \text{keyterms}) = \$0.38
\end{aligned}
$$\[44\]\[45\]\[46\]\[47\]

*(sourced from third-party pricing write-ups; check the live pricing pages)*

**The Deepgram ZDR question is unresolved, and it matters.**
- Deepgram's docs: "Add `mip_opt_out=true` ... Data from opted-out requests is retained only for the duration necessary to process the request."\[15\] *(sourced)*
- Deepgram staffer jkroll-deepgram wrote in GitHub Discussion #1292 (June 18, 2025) that "you may opt out (mip_opt_out=true), which forgoes a 50% discount for participating in the program." Gladia's Deepgram pricing page agrees that opting out means "forgoing the 50% discount, thereby doubling the listed rates." A guide on convertaudiototext.com (checked July 2026) says "opting out does not incur a penalty, it simply means forgoing the participant discount." That is the same thing in softer words, so the sources don't actually conflict: all three say opting out costs you the discount. *(sourced)*
- If the 50% claim holds, Deepgram streaming with opt-out could run about $1.15 to $1.85 per game. Check your Deepgram console logs, which show `mip_opt_out` per request, and your invoice.\[15\]
- AssemblyAI says streaming customers who opt out of training get zero retention of audio and transcripts. That applies to paid accounts only; free users can't opt out.\[48\]\[49\] *(sourced, secondary)*

**Accuracy evidence, all general-domain:**
- Artificial Analysis's AA-WER Streaming benchmark (June 2026) measured Deepgram Nova-3 Realtime at 6.69% WER and Flux at 7.36%. On first partials, ElevenLabs Scribe v2 Realtime led at 3.65%. On final transcripts, Cartesia Ink-2 (semantic endpoints) led at 3.59%, with Scribe v2 Realtime at 3.64%. *(sourced, independent)*
- AssemblyAI's own page claims its premium realtime model leads.\[50\] *(vendor)*
- None of these benchmarks measure proper names, jersey numbers or press-box noise.

**How much transcript quality limits everything after it (inference, strong):** every name or number the recognizer gets wrong is a credit error. That happens unless the fuzzy roster matcher rescues the name or the jersey number disambiguates. The fix is to measure **entity error rate** on roster names and numbers, not WER.

**Recommendation:**
- Keep Deepgram, because you already have it, it's fast, and your matcher is tuned to it. Use one stream with a server-side fan-out.
- Add keyterms for the two teams' likely ball handlers. Deepgram's own guidance recommends "keeping your list to the most important 20–50 terms rather than filling the full budget," so check the list with a real token count to stay well under the 500-token cap.
- **Never let the stats feature send a mid-stream Configure.** Deepgram's changelog correction says an over-limit update "stops transcription without an Error, and after about 30 seconds the server closes the stream with 1011."\[51\] Only the card path should own the stream config.
- Run one A/B against AssemblyAI Universal-Streaming on the same recorded audio before committing for the long term.

### 5. The rules the system must follow (NFHS, and where NCAA and NFL differ)

From the NFHS Statisticians' Manual (2003 edition, the newest I could find dated; NFHS still sells an undated "Statisticians' Manual"):

| Situation | NFHS rule | NCAA | NFL |
|---|---|---|---|
| Sack | QB downed behind LOS "apparently intending to pass" is "Loss by Rushing"; solo sack also gets solo tackle + TFL; assisted sacks split yards; "no pass sack without loss of yardage"; QB fumble before contact = no individual sack | Same: "Loss by Rushing" for the passer | Sack yards come off **team passing**; passer not charged with an attempt or rush\[17\]\[18\]\[52\] |
| Kneel-down | CD: QB falls down, "credit Player A with a loss of 2 yards rushing" (individual) | **Team** rush, not the QB | No special rule found; apparently an ordinary rush (inference)\[17\]\[18\] |
| Two-point try | "No passing statistics are recorded, and no rushing statistics"; only the try and success | "PAT Attempt," not a rush or reception | Two-point conversion credited, kept distinct from kick stats; no rush/pass yards\[17\]\[18\]\[52\] |
| Defensive foul, run ends beyond LOS | Run credited to the end of the run; penalty enforced from there | Similar | Similar\[18\] |
| Defensive foul, run ends behind LOS | "The play is nullified. Do not charge the ball carrier with a rush." | Similar | Similar\[18\] |
| Offense foul like illegal motion | "Play is nullified and is not recorded" unless declined | Similar | Similar\[18\] |
| Clipping during a run | Rush credited to the spot of the foul (e.g. 18 yards, no first down) | Similar | Similar\[18\] |
| Kick returns | Measured from where the returner gains possession; returns after a foul behind the start of the return get no credit; fair-catch muff = no return, no fumble | Similar | Similar\[18\] |
| Interception | Passer gets an incomplete + interception, no yards | Same | Same\[18\] |
| Team stats | Bad-snap losses, blocked punts and similar go to "Team" | Same | Same\[18\] |
| Yardage | Only goal line to goal line; partial yards round by the "forward point" rules | Same | Similar\[17\]\[18\] |

*(sourced: NFHS 2003 manual; NCAA 2022 manual; NFL Guide for Statisticians 2025)*

**Practical point (inference, strong):** encode these as code rules, not prompt text. The model's job is to report *what happened*: who carried, where it started, where it ended, which flag, accepted or declined. A rules engine then applies NFHS crediting. That keeps the model's job small and makes the rules auditable. Some state associations may follow NCAA conventions. Make kneel-down and sack treatment a per-league setting, and match whatever produces your ground truth.

### 6. Designs compared

All costs assume about 150 events per game. That figure comes from about 45 to 65 offensive plays per team per game (MaxPreps and coaches' forums; informal sources), plus kicks and tries.\[53\]\[54\]\[55\]\[56\]

| Design | How the work is split | Accuracy vs goal (inference) | Model cost/game | Delay | Build |
|---|---|---|---|---|---|
| A. Whole-game LLM | Send the growing transcript every play | Poor: drift, double counting, crosses 100k price step late | $1+ (5x price above 100k) | 5 to 20 s | 1 week |
| B. Per-utterance LLM tagging | Model tags every final transcript chunk | Fair; recaps and partial calls cause errors | ~$0.30 | 1 to 3 s | 2 weeks |
| **C. Code-first, per-play Haiku (recommended)** | Parsers + state machine segment plays; Haiku reads one play window; code credits and checks | Best available; see estimates below | **~$0.10 to $0.30** | 2 to 5 s provisional, commit on next snap call | 5 to 7 weeks |
| D. C + Sonnet 5.5 audit | C, plus Sonnet reviews flagged plays at halftime and end | +1 to 2 points on hard plays (inference, weak) | +~$0.10 to $0.15 | minutes, for corrections | +1 week |
| E. Rules/regex only | No model | Good on clean calls, brittle on loose phrasing | $0 | <1 s | 3 weeks, endless tuning |
| F. Audio-native LLM | Send audio to a multimodal model | Likely worst (inference): no roster-matching or keyterm layer, and even transcript-based multi-speaker extraction topped out at 23.7% value accuracy in the Structured Output Benchmark | Higher | Higher | 1 week |

**Design C in detail.**

1. **Shared stream, separate lane.** The server fans out Deepgram finals to two consumers. The card path stays exactly as it is. The stats worker reads from a queue in a separate process with its own CPU budget, never awaited by the card path. Guard against regressions: alert if `ms_to_paint` p95 in your log moves after the stats worker ships.
2. **Deterministic layer.** Reuse your roster fuzzy matcher, and add parsers for:
   - jersey numbers ("number 23", "the 23")
   - yard lines ("own 35", "plus-40", "at the 12", "midfield")
   - down and distance ("third and 6", "first and goal")
   - flags ("flag on the play", "holding", "declined", "offsetting")
   - scores
3. **Play segmentation.** A down-and-distance call starts a new play window. The window closes at the next one, at a kick or try cue, or after a silence timeout.
4. **Haiku call per window.**
   - Cached prefix of about 5,000 tokens: schema notes, 15 to 25 real examples from your own calls, both rosters with IDs and numbers and phonetic variants.
   - Fresh suffix of about 1,000 to 1,500 tokens: game state, the last two windows, and this window.
   - Output enums: `utterance_kind`, `play_type`, roster IDs, `start_spot`, `end_spot`, `yards_said`, penalty fields, `confidence`, and evidence spans.
   - Settings: `effort: low`, compared against `medium` on your evals. Stateless single turns, so no thinking blocks pile up.
5. **Code credits the play.**
   - Yards = spot difference when both spots are known; otherwise the yards the announcer said.
   - Then it checks against the next down and distance. "First and 10 at the 30" followed by "second and 3" implies a 7-yard gain.
   - A conflict lowers confidence and flags the play.
6. **Provisional, then committed.** Show a stat right away as provisional, and commit it when the next snap's down and distance agrees. Penalties announced late revise it.
7. **Checksums.** When the announcer reads "he's got 87 yards on 9 carries," code compares that to the ledger. A mismatch triggers a targeted re-read of that player's plays.
8. **Reconciliation at quarter breaks.** Haiku reads the full quarter transcript (well under 100k tokens) plus the ledger and proposes corrections. Code accepts only corrections that are grounded in an evidence span.
9. **Typed fixes.** The announcer can type "23 had the TD not 32"; Haiku parses that into a ledger edit.

**Cost math for Design C** (tokens counted on the new tokenizer):

$$
\begin{aligned}
\text{Per play call:}\quad & \underbrace{5000 \times \tfrac{\$0.01}{10^6}}_{\text{cached prefix}} + \underbrace{1500 \times \tfrac{\$0.10}{10^6}}_{\text{fresh input}} + \underbrace{600 \times \tfrac{\$0.50}{10^6}}_{\text{output + thinking}} \approx \$0.0005\\[4pt]
\text{Per-play calls (200, incl. false triggers):}\quad & 200 \times \$0.0005 = \$0.10\\[4pt]
\text{Quarter reconciliations:}\quad & 4 \times \left(35{,}000 \times \tfrac{\$0.10}{10^6} + 3{,}000 \times \tfrac{\$0.50}{10^6}\right) \approx \$0.02\\[4pt]
\text{Optional Sonnet 5.5 end-of-game audit:}\quad & 40{,}000 \times \tfrac{\$2}{10^6} + 5{,}000 \times \tfrac{\$10}{10^6} = \$0.13\\[4pt]
\text{Model total:}\quad & \approx \$0.12 \text{ to } \$0.30
\end{aligned}
$$

If output and thinking run 3x my estimate at `medium` effort, the per-play line rises to about $0.25. That is still fine. *(inference)*

**Whole-pipeline cost:**

$$
C_{\text{game}} = C_{\text{STT}} + C_{\text{model}} \approx
\begin{cases}
\$0 + \$0.20 & \text{if the card feature already pays for the stream}\\
\$0.38 + \$0.20 = \$0.58 & \text{AssemblyAI Universal-Streaming}\\
\$0.74 \text{ to } \$1.08 + \$0.20 & \text{Deepgram list, with keyterms}\\
\text{up to } \$2.05 & \text{if MIP opt-out really doubles Deepgram}
\end{cases}
$$

### 7. Expected accuracy, and why 95% is at the edge

Model the per-play result as coverage times extraction:

$$
P(\text{play correct}) \approx c \times a_{\text{ASR}} \times a_{\text{model}} \times a_{\text{revise}}
$$

- $c$: share of plays where the call names each credited player
- $a_{\text{ASR}}$: share of those names and numbers transcribed or matched correctly
- $a_{\text{model}}$: extraction accuracy given a correct transcript
- $a_{\text{revise}}$: share of penalty or review revisions handled correctly

**Plausible numbers for offensive and kicking credits (inference, moderate):**

$$
0.98 \times 0.985 \times 0.985 \times 0.995 \approx 0.946
$$

That is right at your 95% line, and every factor has to be excellent.

**If defensive tackle credits count:** with $c_{\text{def}} \approx 0.8$, the same factors give about 0.77. I found no published rate for how often HS announcers name tacklers, so this is inference with low to moderate confidence. Your hand-charted games will produce the real $c$.

**Yards (inference, moderate):** exact yards need both spots, or a stated gain, plus correct NFHS rounding. Estimate 80 to 90% on offensive plays. Spot-difference arithmetic plus the next-down check should be what pushes it over 85%.

**Blunt conclusion:**
- If your scoring counts every tackle in the official play-by-play, the 95% goal can't be met from announcer audio alone, whatever the model.
- If it covers passer, rusher, receiver, kicker, returner, interceptions, sacks and fumble recoveries, the best design should land around 93 to 96%, and 85% with yards looks achievable.
- I'd define the goal both ways and report both numbers.

### 8. Measurement

**Ground truth.** HS "official" play-by-play is rare and noisy. Build your own: chart each game from the NFHS Network video archive using the NFHS manual's rules. Record each play with:
- quarter and sequence number
- down, distance and spot
- play type
- every credited (player, stat, yards)
- penalty outcome

**Alignment.** System and official plays won't line up one-to-one. Align the two sequences with dynamic programming (edit distance), using play type, down and distance, and spot as the match features. Then:
- An unmatched system play is a **phantom** and counts as wrong for both goals, as you specified.
- An unmatched official play is a **miss**.

**Per-play scores.** Let $S_i$ be the system's set of (player, stat) credits and $O_i$ the official set:

$$
\text{Goal 1 hit}_i = \mathbb{1}\left[S_i = O_i\right], \qquad
\text{Goal 2 hit}_i = \mathbb{1}\left[S_i = O_i \ \wedge\ |y^{S}_{i} - y^{O}_{i}| = 0 \ \forall \text{credits}\right]
$$

$$
\text{Accuracy}_k = \frac{\sum_i \text{Goal } k \text{ hit}_i}{N_{\text{official}} + N_{\text{phantom}}}
$$

Report both "offense and kicking" and "all credits" versions, and break errors down by cause: coverage, ASR, model, rules, revision.

**How many games before a difference between two designs is real?** Run both designs on the same plays, which makes this a paired comparison. Use McNemar's test with a clustering correction by game (Gönen 2004, Statistics in Medicine).\[57\] For a target difference $\delta$ and discordant-pair rate $p_d$:

$$
n_{\text{plays}} = \frac{\left(z_{1-\alpha/2}\sqrt{p_d} + z_{1-\beta}\sqrt{p_d - \delta^2}\right)^2}{\delta^2}
$$

Inflate for clustering by game with the design effect, where $m$ is plays per game and $\rho$ the within-game correlation:

$$
\text{DE} = 1 + (m-1)\rho
$$

**Worked example A** (detect 2 points, $\alpha = 0.05$, 80% power, $p_d = 0.06$):

$$
n = \frac{(1.96 \times 0.245 + 0.84 \times 0.244)^2}{0.02^2} \approx 1{,}170 \text{ plays}
$$

With $m = 150$ and $\rho = 0.02$, DE ≈ 4.0, so about **4,700 plays, roughly 31 games**. With $\rho = 0.01$, about 20 games.

**Worked example B** (detect 5 points, $p_d = 0.10$):

$$
n = \frac{(1.96 \times 0.316 + 0.84 \times 0.312)^2}{0.05^2} \approx 310 \text{ plays}
$$

With DE ≈ 4.0, that is about **1,240 plays, roughly 8 to 9 games**.

The $\rho$ values are my assumption (inference). Estimate the real one from your first 5 to 10 games.

**Practical reading:** 8 to 10 charted games will separate big design choices (5+ points). Telling 93% from 95% needs 20 to 30 games, across several announcers, not just you. To claim "≥95%" with confidence, the lower bound of the cluster-adjusted interval has to clear 95%. With 10 games, the half-width is about ±2.2 points:

$$
\text{SE} = \sqrt{\tfrac{0.95 \times 0.05}{1500/4}} \approx 0.011
$$

## Recommendations

**Build Design C.** Ranked by expected gain per dollar and per week of work (all inference; the ranking itself is what the experiments test):

| Rank | Part | Expected gain | $ per game | Weeks |
|---|---|---|---|---|
| 1 | Hand-charted test set + scorer | Makes every other decision possible | $0 | 2 |
| 2 | Deterministic parsers + game-state machine + next-down check | Large: yards and phantom-play suppression | $0 | 1.5 |
| 3 | Haiku per-play reader with roster-ID enums, evidence spans, `utterance_kind` | Large: who did what | ~$0.10 | 1.5 |
| 4 | NFHS crediting rules in code | Medium: sacks, penalties, tries, team stats | $0 | 1 |
| 5 | Keyterms for likely ball handlers (card path owns config) | Medium on names | $0 to $0.16 | 0.5 |
| 6 | Stat-line checksum + quarter reconciliation | Small to medium | ~$0.02 | 1 |
| 7 | Sonnet 5.5 audit of flagged plays | Small | ~$0.13 | 0.5 |
| 8 | GPT-6 Luna swap test | Unknown, hedge | same | 0.5 |
| Skip | Fine-tuning, whole-game prompts, audio-in LLMs | Unavailable or negative | n/a | n/a |

**Compliance setup:**
- Get Anthropic ZDR on your API org in writing, and confirm Haiku 5.5 by name, since the page doesn't list it.\[10\]
- Set `mip_opt_out=true` on every Deepgram request and confirm it in the console logs.\[15\]
- Keep the schema free of names.
- Log nothing with names on your own side beyond what you need.

**About your log file:** I only saw the column list for "9252026 - BWS vs. Estancia Game Log.csv," not its contents. Two things in it are worth using right away:
- Use `ms_to_paint` and `ms_to_dom` as your regression guard for the shared stream.
- Use the `match_score` and `deepgram_confidence` distributions for roster hits to set the stats path's entity threshold. Stats should probably require a higher threshold than cards, because a wrong card costs a second while a wrong stat persists.

## Caveats

- Haiku 5.5 was released October 7, 2026.\[27\]\[30\]\[58\]\[59\] Every Haiku-specific accuracy number here is either vendor-reported or a general benchmark. No one has tested it on this task.
- Pricing comes from third-party write-ups that quote vendor pages. The Deepgram opt-out price conflict is unresolved.\[60\]\[61\]
- Anthropic's ZDR page doesn't name Haiku 5.5. Its eligibility is inferred from it not being a Covered Model.\[10\] One reseller lists 30-day retention for it, which is probably that reseller's own policy.\[62\]
- Plays-per-game figures come from informal sources.
- The newest dated NFHS statisticians' manual I found is 2003.\[18\] Your state association may differ.
- The accuracy estimates in section 7 are reasoning, not measurements.

## One-Page Design

**Pipeline:**

```
Mic → browser → server → Deepgram Nova-3 (mip_opt_out, keyterms owned by card path)
                      ├─► Player cards (unchanged, latency-guarded)
                      └─► Queue → Stats worker (separate process)
                             1. Parsers: names (existing matcher), numbers, spots, down & distance, flags
                             2. Segmenter: play window = one down-and-distance call to the next
                             3. Haiku 5.5 (effort low, stateless, cached prefix, structured output,
                                roster-ID enums, evidence spans, utterance_kind)
                             4. Grounding check: evidence span exists and contains the name/number
                             5. Rules engine (NFHS): credits, yards, sacks, penalties, tries, Team
                             6. State machine: next down & distance confirms → commit; conflict → flag
                             7. Checksums vs announcer stat-line reads; quarter-break Haiku reconcile
                             8. Optional Sonnet 5.5 audit of flagged plays; typed fixes via Haiku
                      → Box score UI (provisional / committed)
```

**Targets:**
- Model cost about $0.10 to $0.30 per game.
- Provisional stat 2 to 5 s after the result call, committed at the next snap call.
- Expected 93 to 96% offensive credit accuracy and 80 to 90% with exact yards.

**Build order:**
1. **Weeks 1 to 2:** chart three archived games and write the scorer and aligner.
2. **Weeks 2 to 3:** parsers, state machine, shared-stream fan-out with a latency guard.
3. **Weeks 3 to 4:** Haiku reader, grounding check, NFHS rules engine.
4. **Week 5:** checksums, reconciliation, typed fixes; chart five more games.
5. **Week 6:** ablations and model swap; decide on the Sonnet audit.

**First experiments:**
1. **Coverage audit.** On three charted games, count how often the call names each credited player and both spots. This gives $c$ and settles whether 95% is possible at all.
2. **Error decomposition.** Run Haiku on (a) your hand-corrected transcript and (b) the raw Deepgram transcript, with Sonnet 5.5 on (a) as an upper bound. The gaps separate ASR loss from model loss.
3. **Next-down check on/off.** Measure the gain on yards and on phantom plays.
4. **Effort low vs medium, and Haiku 5.5 vs GPT-6 Luna,** on the same windows; compare accuracy and cost.
5. **Entity error rate:** keyterms on/off, and Deepgram vs AssemblyAI Universal-Streaming, on the same recorded audio, scoring roster names and numbers only.
6. **Recap trap set.** Fifty hand-picked recap and stat-line utterances; target zero committed double counts.

## Sources

1. [Live Football Commentary (LFC): A Large‑Scale Dataset ...](https://aclanthology.org/2025.inlg-main.13.pdf)
2. [Moneyball with LLMs: Analyzing Tabular Summarization in Sports Narratives](https://arxiv.org/pdf/2510.18173)
3. [LLM-Commentator: Novel fine-tuning strategies of large language models for automatic commentary generation using football event data - ScienceDirect](https://www.sciencedirect.com/science/article/pii/S0950705124008530)
4. [PressBox Football Stats App - App Store](https://apps.apple.com/us/app/pressbox-football-stats/id6482231158)
5. [Football Video Analysis Software • Hudl](https://www.hudl.com/sports/football)
6. [XO Stats · Live, play-by-play stat tracking for high school football](https://xostats.com/)
7. [Claude Haiku 5.5: Specs, Pricing and the 100K Step](https://www.orcarouter.ai/blog/claude-haiku-5-5)
8. [What's new in Claude Haiku 5.5 - Claude Platform Docs](https://platform.claude.com/docs/en/models/haiku-5-5/whats-new-haiku-5-5)
9. [Claude Haiku 5.5 review: benchmarks, real costs, and the 100k catch](https://www.eesel.ai/blog/claude-haiku-5-5-review)
10. [API and data retention](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention)
11. [Anthropic Claude Data Retention Policy 2026](https://anarlog.so/blog/anthropic-data-retention-policy/)
12. [What is zero data retention and how can my organization get it?](https://harriethq.com/blog/zero-data-retention/)
13. [Structured outputs - Claude Platform Docs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
14. [Deepgram Data Retention (2026): The List Price Opts You Into Model Training](https://humla.team/blog/deepgram-data-retention-policy)
15. [Model Improvement Partnership Program | Deepgram's Docs](https://developers.deepgram.com/docs/the-deepgram-model-improvement-partnership-program)
16. [Keyterm Prompting](https://developers.deepgram.com/docs/keyterm)
17. <http://fs.ncaa.org/Docs/stats/Stats_Manuals/Football/2022.pdf>
18. [Stats manual 2003\_Stats manual 2003.qxd](https://assets.nfhs.org/umbraco/media/865876/stat_manual_2003.pdf)
19. [Neural Sabermetrics with World Model: Play-by-play Predictive Modeling with Large Language Model](https://arxiv.org/pdf/2602.07030)
20. [AI-Generated Game Commentary: A Survey and a Datasheet Repository](https://arxiv.org/html/2506.17294v1)
21. [Validity and reliablility of a voice-recognition game analysis system for field sports - ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S1440244002800251)
22. [Computer system for detecting target video from sports video based on voice recognition and method of the same](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/12657912)
23. [MAXPREPS.COM RELEASES MAXSTATS:](https://www.cbssports.com/info/aboutus/press/2010/maxstats)
24. [iTouchdown Football Scoring](https://apps.apple.com/us/app/id447860344)
25. [Best in Game Stat App - The Indiana High School Football Forum - The Gridiron Digest](https://gridirondigest.net/topic/2868-best-in-game-stat-app/)
26. [High School Football Stat App](https://snapstat.ai/)
27. [Claude Haiku 5.5 explained: price, effort and UK data](https://aiwiz.uk/blog/claude-haiku-5-5/)
28. [Anthropic launches Claude Haiku 5.5 with 90% API price reduction, matching GPT-6 Luna](https://venturebeat.com/technology/anthropic-launches-claude-haiku-5-5-with-90-api-price-reduction-matching-gpt-6-luna)
29. [What Is Claude Haiku 5.5? Specs, Benchmarks, Pricing, Features, and API Access - CometAPI](https://www.cometapi.com/what-is-claude-haiku-5-5/)
30. [Claude Platform release notes - Claude Platform Docs](https://platform.claude.com/docs/en/release-notes/overview)
31. [Claude Haiku 5.5 migration guide - Claude Platform Docs](https://platform.claude.com/docs/en/models/haiku-5-5/migration-guide)
32. [Claude Haiku 5.5 - Claude Platform Docs](https://platform.claude.com/docs/en/models/haiku-5-5/overview)
33. [Prompting Claude Haiku 5.5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-haiku-5-5)
34. [Claude Haiku 5.5 - API Pricing & Benchmarks](https://openrouter.ai/anthropic/claude-haiku-5.5)
35. [Claude Haiku 5.5 (medium) - Intelligence, Performance & Price Analysis](https://artificialanalysis.ai/models/claude-haiku-5-5-medium)
36. [The Structured Output Benchmark: A Multi-Source Benchmark for Evaluating Structured Output Quality in Large Language Models](https://arxiv.org/pdf/2604.25359)
37. [GPT-6 Sol and Luna API Pricing: Rates, Caching and Limits](https://techjacksolutions.com/ai-tools/chatgpt/gpt-6-sol-and-luna-pricing-and-api/)
38. [Data controls in the OpenAI platform](https://developers.openai.com/api/docs/guides/your-data)
39. [Zero Data Retention for the OpenAI API: audit the full data path](https://blog.ish.chat/r/openai-api-zero-data-retention-audit)
40. [Google LLC (Vertex AI) gemini-3.5-flash-lite API Pricing & Cost: Context Window & Benchmarks](https://www.requesty.ai/models/vertex/gemini-3.5-flash-lite)
41. [Gemini 3.5 Flash Lite - API Pricing & Benchmarks](https://openrouter.ai/google/gemini-3.5-flash-lite)
42. [AWS Bedrock Pricing 2026: Rates and Tiers](https://www.spheron.network/blog/aws-bedrock-pricing-2026-managed-api-cost/)
43. [Claude Fine-Tuning: Getting Started with Bedrock and Pricing](https://book.st-hakky.com/en/data-science/optimizing-claude-monet-artwork-fine-tuning-methods)
44. [Dictation: add Deepgram Nova-3 Multilingual with keyterms by adityavardhansharma · Pull Request #205 · adityavardhansharma/EchoFlow](https://github.com/adityavardhansharma/EchoFlow/pull/205)
45. [AssemblyAI Pricing 2026: Every Product, Rate & Add-On](https://www.cekura.ai/blogs/assemblyai-pricing)
46. [AssemblyAI Pricing](https://www.usagepricing.com/blueprint/assemblyai)
47. [Best Speech-to-Text APIs in 2026: A Comprehensive Comparison Guide](https://deepgram.com/learn/best-speech-to-text-apis-2026)
48. [A major privacy concern with Deepgram and AssemblyAI API requests. · Issue #935 · Beingpax/VoiceInk](https://github.com/Beingpax/VoiceInk/issues/935)
49. [AssemblyAI Universal-3 Pro: model profile · Signal](https://opentranscription.io/blog/universal-3-pro-deep-research-report-profile.html)
50. [AssemblyAI Universal-3.6 Pro Realtime benchmarks](https://www.assemblyai.com/benchmarks)
51. [Changelog](https://developers.deepgram.com/changelog)
52. <https://www.nflgsis.com/gsis/documentation/stadiumguides/guide_for_statisticians.pdf>
53. [Watch: Top 10 High School Football Plays of the Year](https://www.maxpreps.com/news/LqoL1QuK00encJBSSmN48w/watch-top-10-high-school-football-plays-of-the-year.htm)
54. [Average number of plays?](https://coachhuey.com/thread/26575/average-number-plays)
55. [How many possessions a Game?](https://jcfb.forums.net/thread/1877/how-many-possessions-a-game)
56. [3,304 Yards of Jogging to Get the Play From the Sideline](https://theteamroom.substack.com/p/3304-yards-of-jogging-to-get-the)
57. [Sample size and power for McNemar's test with clustered data](https://www.researchgate.net/publication/8473335_Sample_size_and_power_for_McNemar's_test_with_clustered_data)
58. [Introducing Claude Haiku 5.5](https://www.anthropic.com/claude-haiku-5-5)
59. [Introducing Claude Haiku 5.5 on AWS](https://aws.amazon.com/blogs/machine-learning/introducing-claude-haiku-5-5-on-aws/)
60. [Data Retention · deepgram · Discussion #1292](https://github.com/orgs/deepgram/discussions/1292)
61. [Opt Out of AI Training With Your Audio: Per-Vendor Guide (2026)](https://convertaudiototext.com/blog/opt-out-of-ai-training-with-your-audio)
62. [Claude Haiku 5.5 in OpenCode Go: What \$10 Really Buys](https://www.orcarouter.ai/blog/claude-haiku-5-5-opencode-go-allowance)
