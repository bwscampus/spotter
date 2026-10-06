# Spotter V3: Definition

Written Sept 26, 2026 from Jed's answers in Cowork. Target: live on Friday, Oct 2, 2026.
This is the spec Claude Code builds from. It lives at `docs/V3_DEFINITION.md` on the `v3` branch. If this file and a prompt disagree, this file wins, and whoever notices fixes the one that's wrong.

> **On the class stack (Oct 6, 2026).** This spec was written for `JedSandler/Spotter`. In this repo the product rules still hold, but the platform changed: Railway Postgres instead of Supabase, Google sign-in only (no email/password), Railway instead of Vercel, and approval in `/admin` instead of the Supabase Table Editor. Sections 5, 9 and 12 describe the old platform; `docs/technical-design.md` replaces them where they differ. Live stats (sections 4 G4–G6 and 8) is not in this repo yet.

---

## 1. The straight answer on Friday

**The full scope isn't realistic by Friday.** At 10 to 20 hours of your time, the full V3 comes out to about 20 hours of your own time:

- accounts with Google and email/password
- four roster formats, plus season stats
- live names with four fixes
- Past games
- analytics
- live stats across all four stat groups, plus an NFL test and a round of fixes

That only works if nothing goes wrong, and something always does.

**What is realistic for Friday is V3 without live stats**, about 12 to 13 hours. That's accounts, prep (all four formats plus season stats), live name-spotting with the four Sept 25 fixes, Refresh rosters, pronunciation notes, the browser log, and analytics events. Past games and the analytics views are small, so they go in if you're on schedule Wednesday.

**Live stats get built on their own branch in parallel**, and they only merge if they pass an NFL test. The live NFL games before Friday are on Sunday and Monday, which is too early because stats won't be built until Wednesday, and Thursday night (Steelers at Browns, 5:15 PM Pacific). There are two ways to run the test:

- **A recorded full game** (a DVR recording of Sunday's or Monday's game, or NFL+) can be run Wednesday night. That leaves Thursday for fixes.
- **Thursday night live** leaves no time for fixes. Stats only make Friday if that game comes back clean and you decide Friday morning to merge.

Plan on stats landing for Oct 9. If they make Friday, that's a bonus, and the stats on/off switch means you can turn them off mid-game if they get noisy.

**If V3 isn't solid by 4 PM Thursday, you call Friday on V2.** It's still on your domain. You sign in again and re-upload two rosters, because the old records are deleted.

---

## 2. Decisions locked in the Q&A

| Topic | Decision |
|---|---|
| Codebase | New app and new schema, same tools as V2 (Next.js, TypeScript, Tailwind, Supabase, Deepgram, Claude). V2's matching engine, Deepgram connection and their tests get **copied in unchanged**. |
| Where it's built | Claude Code **cloud sessions** at claude.ai/code. The one stats-tuning replay step runs on Jed's Mac. |
| UI | Don't focus on it. Plain pages. The live screen reuses V2's card components as they are, since they're part of the proven card path. |
| Branches | V2 stays on `main` and keeps your domain. V3 lives on `v3`. Stats live on `v3-stats`, branched from `v3`. Each cloud session pushes its own `claude/...` branch, and you merge its pull request into `v3` (or `v3-stats`). **Nothing merges into `main` until the swap.** |
| Supabase data | Delete **all** records now, including sign-in accounts. Keep V2's empty tables until V3 has survived one real game, so V2 can still run as a fallback. |
| API keys | Same Deepgram, Anthropic, Supabase and Google keys. They also have to work on the branch preview links. |
| Accounts | Google sign-in **and** email/password, open sign-up. |
| Email | "Confirm email" off for now. Password reset only reaches you until custom email (Resend) is set up after Friday. |
| Approval | New accounts wait for your approval. Unapproved accounts are blocked from **everything that costs money**: roster reading, stats reading, live listening and stat calls. |
| Sports | Name-spotting works for all sports. Live stats are football only. |
| Linemen | Offensive linemen are left out of name-spotting but stay on the saved roster, so they can be credited with a stat (like a fumble recovery) without ever putting a card up. |
| Roster formats | PDF, screenshot/photo, pasted text, CSV/Excel. |
| Spot fixes | All four: single digits need "number", common-phrase names get a warning plus exact-only, team-sounding names get a warning, look-alike pairs get a warning. |
| Keys on the live screen | `X` takes down the newest card; `1`/`2`/`3` take down that card; `U` undoes the last stat. Start/Stop listening is **on-screen only**, with no keyboard shortcut. |
| Stats groups | Offense, defense, fumbles, special teams. YDS on every stat that has yards. |
| Stat approval | Auto. Every play counts as soon as it's read, with a visible +/- and an undo. |
| Stats switch | On/off per game on the setup screen, and it can be turned off mid-game. Names keep working either way. |
| Stats vs cards | **Stats never move cards.** Only your voice saying a name puts a card up. |
| Season stats | During the game, the card's season numbers include tonight. Nothing is saved after the game, and you upload a fresh stats PDF next week. |
| Sacks | High school rule: a sack is a QB rushing attempt with negative yards. |
| Yards | Interpret as much as possible: stated numbers, yard lines, phrasing. Worked-out yards are marked with `~`. |
| Stat model | Claude Sonnet 5. |
| Logs | Audio is never recorded. The text log (transcript, extracted plays with a 20-word evidence quote, card log) stays in that browser until you clear it, with a Download button. |
| Analytics | Built in from the start, designed around job stories (section 10). Codes and counts only. Never names, words or transcript. |
| NFL test | Spotter listens to the NFL announcers' audio. The results get compared to the official box score. |
| V2 features back | Past games (matchup and counts only), Refresh rosters mid-game, pronunciation notes. Team-color split screen is out. |

---

## 3. Scope

### In at launch

1. **Accounts:** Google sign-in, email/password sign-up (no confirm email), sign-out, a "waiting for approval" screen, and your approval step in Supabase.
2. **Prep:**
   - create a team
   - import a roster from PDF, image, pasted text, CSV or Excel
   - review and edit every row, and see the warnings
   - set per-player spotting (normal, exact-only, off) and pronunciation notes
   - import season stats
   - preview every player's spotting card
3. **Live names:**
   - pick away and home teams
   - Start/Stop listening button
   - cards on screen from surnames and cued jersey numbers
   - keys to take a wrong card down
   - Refresh rosters
   - screen stays awake, and Deepgram auto-reconnects
   - End game with a quick feedback card
4. **Live stats** (football, `v3-stats` until it passes):
   - read plays from the call and apply them automatically
   - per-player +/- with YDS
   - season + tonight on cards
   - `U` to undo, and the stats on/off switch
5. **Browser log:** transcript, raw Deepgram results, card log and stat log, with Download and Clear.
6. **Past games:** matchup, date and counts.
7. **Analytics:** the event table, the end-game feedback card, and the metric views (section 10).

### Out (not in V3 unless you say so)

Team-color split screen; sharing rosters between accounts; pricing; highlight reels; post-game analytics for the announcer; saving stats after the game; a stat grading or approval queue; custom email sending (after Friday); printable spotting board; always-on or hands-free listening; any fetching from MaxPreps or other sites; a metrics dashboard page (the views in Supabase cover it for now).

### Friday cut line

If time runs short, cut in this order. Each one is a whole item that can land the week after.

1. Live stats (stays on its branch).
2. Past games page.
3. Analytics views and the feedback card. The events themselves keep flowing, because they're built into each item.
4. Within stats, special teams goes first, if stats are otherwise ready.

Accounts, prep and live names aren't on the cut list, because Friday doesn't work without them.

---

## 4. The non-negotiable: live stats must not make name-spotting worse

Sept 25 had more wrong cards, and you approved plays without checking them. We can't prove what caused the extra wrong cards from one log with no earlier log to compare against. So V3 closes every route by which stats *could* touch the cards, and adds a test that proves it.

**G1. The engine is ported, not rewritten.** `lib/matching/*` (SpotterEngine, matcher, numbers, resolveJersey, jerseySound, matchLog) and their tests come over from `main` byte for byte. Matcher scoring and thresholds stay off-limits, same rule as V2. The only engine changes V3 allows are the ones in section 7.3, and each one is its own small change with its own tests.

**G2. The hot path stays synchronous.** The function that handles Deepgram results and everything inside `SpotterEngine.process` can't gain an `await`, a fetch, or a storage call. Cards are written with direct DOM writes, not React renders. V2's `cardPathIsolation` test comes over and gets extended. Analytics calls happen after paint, never on the hot path.

**G3. Stats can't put up, take down or reorder a card.** The stats code has no import path to the engine or to `NameDisplay.show()`. It only supplies text for cards' stat lines and delta chip, in two ways. It keeps an in-memory map of each player's current lines, which the live screen hands to the card when your voice puts it up (the way V2 passed its TONIGHT lines). And it writes text directly into cards that are already up. Those slots are fixed-size, so a stat can't change a card's size or position. The line builder lives in `lib/cards/`, which both sides may import. The card path may never import `lib/livestats/`. A test enforces the import rule by reading source files, the same way V2's isolation test does.

**G4. Stats run after the card is painted and fail silently.** The stats loop runs off the hot path. A Claude timeout, error or bad reply shows "stats paused" in the change strip and never touches a card.

**G5. Replay equality test (new, required before stats merge).** The browser log saves the raw Deepgram results. A test feeds one saved log through the card path twice, once with stats off and once with stats on, and asserts the sequence of cards shown is identical. That's the hard proof that stats didn't change spotting.

**G6. No grading while calling.** V2's per-play Enter/X grading is gone. That removes the attention cost that came with "I approved without checking," and it frees `X` to go back to meaning "wrong card."

---

## 5. Accounts and access

- **Sign-in methods:** Google (V2's button and One Tap flow, ported) and email/password (sign up, sign in, sign out). "Confirm email" is off in Supabase, so a new account works right away. Password reset uses Supabase's built-in email, which only reaches addresses on your Supabase team (2 per hour) until custom email is set up.
- **Approval:** every account gets a `profiles` row with `approved = false`. You approve someone in Supabase: Table Editor, `profiles`, tick `approved`, Save. You approve your own account the same way the first time. A trigger stamps `approved_at` when you do.
- **What unapproved accounts can do:** sign in, see a "Waiting for approval" banner, and create a roster by typing players in by hand. Every import button and the live screen are disabled with a note. Nothing that calls Anthropic or Deepgram works.
- **Server-side gate:** every route that spends money checks the session **and** `approved` before calling out: roster extract, stats extract, Deepgram token, keyterm check, play extract. The check lives in one helper that every one of those routes calls.
- **Privacy between accounts:** every V3 table has row level security by `owner_id`, same pattern as V2. Nobody can change `approved` from the app.
- **Keys stay server-side:** `ANTHROPIC_API_KEY` and `DEEPGRAM_API_KEY` are only read in route handlers. Deepgram still uses 30-second temporary tokens.

---

## 6. Prep mode

**Goal:** from whatever roster you have, get one checked spotting card per player in a few minutes.

### 6.1 Teams
Create a team with school, mascot, sport, level (varsity/JV/frosh) and season. Re-importing the same team replaces its roster instead of making a duplicate. V2 matched teams by a `school|sport|gender|level|season` key, and V3 keeps that behavior.

A team can also be added from New game (*Jed, Oct 3*): "+ Add a team" under either side opens the new team's roster (import, check, Save), then its season stats (import, check, Save, or Skip), and comes back to setup with the new team picked on that side and the other side's pick kept.

### 6.2 Roster import (all four formats, one reading path)
- **PDF:** text layer first. If the text layer is empty (a scan), send the page images to Claude vision. Use V2's `openPdf` helper, because of the PDF.js "detached array" trap.
- **Screenshot/photo (PNG, JPG, WebP; iPhone HEIC converted in the browser):** Claude vision.
- **Pasted text:** straight to Claude.
- **CSV/Excel:** parse in the browser into plain text rows, then Claude maps the columns. No hand-written column mapping.
- **Limits:** V2's (10 MB, 10 pages) for PDFs; 5 images per import; 50,000 characters of pasted text.
- **Nothing is stored:** the uploaded file is read in memory and dropped. No Supabase Storage, and no logging of file contents.
- **Fields extracted:** jersey (as text, since "0" and "00" differ), first name, last name, position, grade/year, height, weight, plus Claude's own "couldn't read this" flags. V2's grounding check (is this surname actually in the source text?) comes over for PDF and pasted text.

### 6.3 Review screen
One row per player, all fields editable. Each row shows:
- **Warnings**, all of them from V2 unless marked new:
  - duplicate jersey; similar-sounding jerseys (15/50); missing jersey; ambiguous surname split; name not found in source; surname sounds like a common word.
  - **New:** surname sounds like a common *phrase* from play-by-play (seed list in the build list, taken from the Sept 25 near misses: "long", "are gonna", "be sick", "Oregon", "right", "how", "there is", "we're gonna" and more). Scored with the real matcher.
  - **New:** surname sounds like either school's name or mascot (Ossuetta/Estancia). This check runs at game setup, since that's when both schools are known.
  - **Look-alike pairs** on either roster (V2's collision check). Bargas #8 and Vargas #21 were *both* Estancia, and Deepgram flipped between them 10 times on Sept 25.
  - **New:** single-digit jersey (0 to 9): an info note that this number only fires when you say "number" or the surname is right beside it.
- **Spotting setting** per player: `normal`, `exact-only` (near-sound matches for this player are dropped), or `off`. Football offensive linemen (OL, OT, OG, C, T, G) default to `off`. DL, LB and everyone else default to `normal`. A player listed at both an OL spot and a non-line spot stays `normal`. Players set to `off` are still saved and can still be credited with stats.
- **Pronunciation notes:** free text you type ("oh-soo-EH-tuh"). It's shown on the card and also added as an extra spoken form, which is how V2 already used pronunciations.

Save is atomic. The whole roster saves or nothing does, same as V2's RPC approach.

### 6.4 Season stats import
- Same four formats. The source is usually a MaxPreps team stats page.
- **Football:** Claude returns **numbers**, not phrases, mapped onto the stat keys in section 9.2 and matched to roster players by jersey first, surname second. Numbers have to be numbers so tonight's plays can add to them live.
- **Other sports:** V2's behavior. Up to 3 short stat lines per player, as text.
- The same column-alignment warning from V2 applies: stats PDFs go to Claude as page images, because extracting text scrambles the columns.
- A new import replaces the old numbers. The "as of" date is shown on the card.
- **Stale stats** (*Jed, Oct 3*): at game setup, a team whose stats are a week old or older gets a warning naming the date and the age, with a link to import this week's sheet that comes straight back to setup. Age is counted from the "as of" date, which is the day of the import unless it was set to the sheet's own date. It never blocks Start.

### 6.5 Spotting cards preview
A page listing every player's card exactly as live mode will draw it, sorted by jersey, one section per team. This is the "spotting cards per player" output.

---

## 7. Live mode: names

### 7.1 Setup
Pick the away team and the home team, or add a new one from here (6.1), and set the stats switch (football only). Spotter then:

1. builds the watchlist (V2's `buildGameWatchlist`)
2. runs V2's keyterm check against Deepgram
3. shows any setup warnings (team-sounding names, and season stats a week old or older)
4. opens the live screen

### 7.2 Live screen
- **Start listening / Stop listening:** one on-screen button, with no keyboard shortcut.
- **Mic picker:** V2's.
- **Wake lock:** held while listening (V2's `useWakeLock`).
- **Deepgram:** V2's settings exactly. nova-3, interim results, `numerals=true`, no punctuation, keyterms from the roster, `mip_opt_out=true`. Auto-reconnect with a fresh token.
- **Cards:** V2's layout. Up to 3 cards, newest on top and largest, the two behind it compact. Card shows jersey, name, year · height · weight, pronunciation note, and stat lines.
- **Wrong card:** `X` takes down the newest card; `1`, `2`, `3` take down the card with that number in its corner. Same 300 ms debounce, key-repeat guard and "Removed NAME" flash as V2.
- **Refresh rosters:** rebuilds the game from the saved rosters without stopping the mic.
- **End game:**
  - stops the mic
  - writes the counts to `called_games`
  - shows the feedback card (section 10)
  - keeps the browser log
  - returns to the menu

### 7.3 The four name-spotting fixes

| Fix | Where | Rule |
|---|---|---|
| Single digits need "number" | `lib/matching/numbers.ts` TUNING block (tunable by design) | A jersey 0 to 9 fires only with the explicit cue ("number", "jersey", "wearing", "#") or a surname right beside it. A team cue alone never fires a single digit. On Sept 25, "Estancia 0" was almost certainly the score. |
| Common-phrase names: exact-only | `SpotterEngine`, at the point a spot is accepted (after scoring, synchronous). `matcher.ts` is unchanged. | If the player's setting is `exact-only`, a match scoring below 1.0 is dropped and logged as `near_miss` with reason `exact_only`. |
| Team-sounding names | Game setup warning only | No live-path code. |
| Look-alike pairs | Prep warning (V2's collision check, ported) | No live-path code. The warning suggests a pronunciation note or exact-only for one of the pair. |

Each fix ships with tests built from the Sept 25 cases: "Estancia 0", "long", "are gonna", "be sick", "Oregon".

---

## 8. Live stats (football)

### 8.1 Pipeline

```
Deepgram finals ──> transcript utterances (in memory + browser log)
                        │
                        ├──> card path (unchanged, synchronous)          ← stats can't reach this
                        │
                        └──> stats loop (after paint, async, only when the stats switch is on)
                               when: a down-and-distance call, or every 30 s, never closer than 10 s
                               sends: recent utterances (4 of overlap, max 40) + both rosters (cached)
                                      + the last 5 applied plays
                               Claude Sonnet 5 ──> structured plays (8.2)
                               validator + stat rules (8.3) ──> per-player deltas
                               auto-apply ──> change strip + card stat lines + browser log
```

V2's `lib/plays/window.ts` (when to ask, what to send, dedupe by `seqEnd` watermark) comes over with its tests. Everything after the Claude call is new.

### 8.2 What Claude returns per play

`seqStart`, `seqEnd`, `quarter`, `clock`, `down`, `distance`, `offense` (home/away), `playType` (run, pass, sack, kickoff, punt, field_goal, extra_point, two_point, kneel, spike, penalty_only, other), `nullified` (the play was wiped out by a penalty), `touchdown`, `firstDown`, `confidence` (0 to 1), `summary` (one line), `evidence` (the exact words it was read from, 20 words max), and `events`.

Each **event** is `{ playerId, action, yards, yardsSource }`:

| action | means |
|---|---|
| `rush` | ball carrier on a run (including a QB scramble) |
| `pass_complete`, `pass_incomplete`, `pass_intercepted` | the passer |
| `reception` | the catcher on a completion |
| `sacked` | QB sacked (HS rule: counts as a rush with negative yards) |
| `sack` | defender credited with the sack |
| `tackle` | defender who made the tackle |
| `pass_breakup` | defender who broke up a pass |
| `interception` | defender who intercepted (yards = return) |
| `fumble`, `forced_fumble`, `fumble_recovery` | who fumbled, who forced it, who recovered it (yards = return) |
| `kick_return`, `punt_return` | returner (yards = return) |
| `field_goal`, `extra_point` | kicker (with `made` true/false; yards = FG distance) |
| `punt` | punter (yards = punt distance) |

`yardsSource` is `stated` (you said the number), `spots` (worked out from two yard lines), `phrase` (worked out from wording like "a couple yards"), or `null` (no yards known).

### 8.3 Stat rules (deterministic code, not the prompt)

Claude only says *who did what*. A pure function (`lib/livestats/apply.ts`; `lib/stats/` is taken by season-stats reading) turns that into numbers, so the rules can be tested and can't drift.

- **R1. Only `rush` makes a carry.** A recovery, a return or anything else never adds CAR or rushing YDS.
- **R2. A pass breakup is only a PBU.** On any play with `pass_incomplete` or `pass_breakup`, any `tackle` event is dropped. There's no ball carrier to tackle on an incomplete pass.
- **R3. A tackle needs a ball carrier.** `tackle` only counts on plays with a rush, reception, return, sack or turnover return. Otherwise it gets dropped and logged.
- **R4. Sacks (HS rule).** Defender: +1 sack, sack YDS, +1 TKL. QB: +1 rush attempt and minus the yards.
- **R5. Interceptions.** Defender: +1 INT and return YDS. Passer: +1 ATT and +1 INT thrown. Nobody gets a reception.
- **R6. Fumbles.** The play's original stats still count (a 6-yard run, then a fumble, is still a carry for 6 if the 6 was said). The fumbler gets +1 FUM, and +1 FUM LOST if the other team recovered. The recoverer gets +1 FR and return YDS. The forcer gets +1 FF.
- **R7. Penalties.** A `nullified` play adds nothing.
- **R8. Yards.** Use the number if yards were stated, then work it out from yard lines, then from phrasing. Anything not stated shows with `~`. If yards are unknown, the attempt still counts, the yards don't, and that play is marked "YDS ?" in the strip.
- **R9. Rosters are the only source of players.** A `playerId` that isn't on either roster gets dropped. Players with spotting set to `off` (offensive linemen) can still be credited.
- **R10. Touchdowns** go to whoever carried or caught it, plus the passer on a passing TD, or the returner on a return TD.

Every dropped event is written to the browser log with the rule that dropped it. That's what the NFL comparison reads.

### 8.4 The Sept 25 bugs and how each one is fixed

| Bug | Why it happened in V2 | V3 fix |
|---|---|---|
| Fumble recoveries counted as carries | V2 had no "recovered" role, so Claude used `rusher` | `fumble_recovery` action plus rule R1. Test: "fumble, scooped by Vargas" gives Vargas +1 FR, +0 CAR. |
| PBUs counted as tackles | V2 had no "breakup" role, so Claude used `tackler` | `pass_breakup` action plus rules R2 and R3. Test: "broken up by Ossuetta" gives +1 PBU, +0 TKL. |
| Changes not shown per player | V2 only showed a TONIGHT total | Change strip plus a delta chip on the card, per player: "LANGAN #22  +1 CAR  +8 YDS" (8.6). |
| YDS missing | V2 counted yards only when stated, and dropped them from some lines | YDS on every stat that has yards. Yards worked out from spots or phrasing, marked `~` (R8). |
| Rigid phrasing | The prompt read stat-report language | Phrasing guide in the prompt (8.5), `spots`/`phrase` yards, and tuning from the NFL test log. |

### 8.5 Reading conversational phrasing

The prompt gets a phrasing guide. It's the main tuning surface, like V2's `prompt.ts`. It starts with these and grows from the NFL test:

- **Tackle:** "brought down by", "wraps him up", "gets him to the ground", "stuffed by", "met by", "cleans it up"
- **PBU:** "breaks it up", "knocks it away", "gets a hand on it", "swats it", "batted down"
- **Fumble:** "coughs it up", "puts it on the turf", "ball's loose", "pops out"
- **Recovery:** "falls on it", "scoops it", "comes up with it", "recovered by"
- **INT:** "picked off", "picks it", "undercuts it", "that's intercepted"
- **TD:** "takes it to the house", "in for six", "scores", "touchdown"
- **Yards from phrasing:** "picks up a couple" = ~2, "a handful" = ~5, "moves the chains" = first down (no yards on its own)
- **Yards from spots:** "from the 30 to the 42" = ~12, but only when which side of the 50 is clear from the words or the last stated spot

The prompt keeps V2's hard rules: the transcript is the only source, never invent a player, and a low-confidence play beats no play.

### 8.6 How changes show

- **Change strip** across the bottom of the live screen: the last 5 applied plays, newest first, each with its per-player changes. For example `Q2 3rd & 4 · LANGAN #22 +1 CAR +8 YDS · OSSUETTA #17 +1 TKL`. Worked-out yards show as `~8 YDS`. A play with a dropped event shows a small `!` with the rule.
- **On the card** (only if that player's card is already up): a delta chip like "+1 CAR +8" for 5 seconds, plus the updated season and tonight lines.
- **Undo:** `U` reverses the most recent applied play. Pressing it again reverses the one before. Undo is exact, because tonight's totals are always recomputed from the list of applied plays (V2's "derived, never accumulated" rule).
- **Stats switch:** set on the setup screen, with a "Stats off" button on the live screen. Off means the loop stops calling Claude and the strip says "Stats off." Stats already applied stay on the cards. Names aren't affected either way.

### 8.7 Season + tonight on the card

For football, the card shows up to two stat lines built from numbers: SEASON (the uploaded season numbers plus tonight) and TONIGHT. For example, `SEASON 64 CAR 420 YDS 5 TD` and `TONIGHT 2 CAR ~11 YDS`. Which stats a line shows depends on what that player has the most of, same idea as V2's `phraseTally`. Nothing gets written back to Supabase.

### 8.8 When stats fail

A timeout (15 s budget, same as V2), a bad reply, or a network error shows "stats paused" in the strip and tries again at the next down-and-distance call. Cards are never affected. After 5 failures in a row, the loop stops and the strip says so.

### 8.9 Model and cost

Claude Sonnet 5, thinking off, with prompt caching on the instructions plus both rosters (V2's approach, which caches). Token counts per game go into the `game.ended` analytics event, so cost per game shows up in the metrics.

---

## 9. Data model and where everything lives

### 9.1 V3 tables (new names, so they can sit next to V2's empty tables until V2 is dropped)

| Table | What's in it |
|---|---|
| `profiles` | one row per account: `id` (= auth user), `email`, `approved` (default false), `approved_at`, `created_at`. Created by a trigger on sign-up. Users can read their own row, and nobody can change `approved` from the app. |
| `rosters` | a team: owner, school, mascot, sport, gender, level, season, `roster_key` (unique per owner), timestamps |
| `roster_players` | one per player: roster, owner, sort order, jersey (text), first, last, position, grade, height, weight, `pronunciations` (text[]), `spoken_forms` (text[]), `spot_mode` (`normal` / `exact_only` / `off`), `season_stats` (jsonb, football numbers), `season_lines` (text[], other sports), `stats_as_of` (date) |
| `called_games` | owner, home/away roster ids and school names, sport, stats on/off, started/ended, mic seconds, reconnects, cards shown, cards removed, stat plays added, stat plays undone. **No player names, no transcript.** |
| `app_events` | analytics events (section 10). Codes and counts only. |
| `game_feedback` | end-of-game rating, blocker chips and an optional short note, one per game |

Writes go through RPCs so a half-saved roster can't happen: `save_roster(team, players)` and `set_season_stats(roster_id, stats)`. Every table has row level security by `owner_id`. Every migration gets applied with the Supabase connector **and** mirrored into `supabase/migrations/` (V2's rule).

### 9.2 Football stat keys (`season_stats` and tonight's totals)

`gp, rush_att, rush_yds, rush_td, pass_cmp, pass_att, pass_yds, pass_td, pass_int, rec, rec_yds, rec_td, tkl, sacks, sack_yds, def_int, int_ret_yds, pbu, ff, fr, fr_ret_yds, fum, fum_lost, kr, kr_yds, kr_td, pr, pr_yds, pr_td, fgm, fga, fg_long, xpm, xpa, punts, punt_yds`

### 9.3 Where each piece of data lives

| Data | Where | How long | Leaves your device? |
|---|---|---|---|
| Microphone audio | Streamed to Deepgram, never recorded | Deepgram keeps it only to process the request (`mip_opt_out=true`) | Yes, to Deepgram only |
| Transcript text windows | Sent to Anthropic for stat reading | Anthropic deletes API inputs/outputs within 30 days by default and doesn't train on them | Yes, to Anthropic only |
| Uploaded roster/stats files | Read in memory, then dropped | Seconds | Yes, to Anthropic for reading |
| Rosters, season stats, pronunciations | Supabase, per account | Until you delete them | Stored in Supabase |
| Tonight's stats | Browser memory plus browser log | Until Clear | No |
| Browser log (transcript, raw Deepgram results, card log, stat log with evidence quotes) | Browser (IndexedDB) | Until Clear | Only if you download it |
| Past-game counts | Supabase `called_games` | Until deleted | Counts only |
| Analytics events | Supabase `app_events` | Until deleted | Codes and counts only |
| Feedback | Supabase `game_feedback` | Until deleted | Rating, chips, and your note |

---

## 10. Analytics, built for job stories

**The goal:** as other announcers start using Spotter, the numbers should show *when* they reach for it, *what* they're trying to get done, and *where* it lets them down. That gives you job stories you can act on ("When ___, I want to ___, so I can ___").

### 10.1 Privacy rules (same spirit as V2, which already did this well)

- **Codes and counts only.** No player names, jerseys, heard words, transcript, or file contents, ever. Strings in event props are enums of 40 characters or less.
- **Every event is tagged** with `env` (production or preview), `app_version` (git commit), `session_id` (per browser tab) and, when in a game, `game_id`. The metric views count **production only**, so your own testing on branch links doesn't pollute them.
- **Nothing is sent from localhost.**
- **Never on the hot path:** events are queued and sent after paint, in batches.
- **Disclosure:** before inviting other people, the privacy note (section 11) says analytics exist and what they contain.

### 10.2 Events

| Area | Event | Props (codes and counts) |
|---|---|---|
| Account | `account.signed_up` | method (google/email) |
| Prep | `prep.import_started` | kind (roster/stats), format (pdf/image/text/csv/xlsx), pages, size bucket |
| Prep | `prep.import_finished` | kind, format, ok, fail code, players found, players flagged, ms |
| Prep | `prep.roster_saved` | players, rows edited, warnings by type (counts), exact-only set, spotting off set, pronunciations added, minutes from first import |
| Prep | `prep.cards_previewed` | players |
| Game | `game.started` | sport, stats on/off, setup warnings, keyterms |
| Game | `game.mic_started`, `game.mic_stopped` | seconds |
| Names | `names.card_removed` | key (x/1/2/3), cue (name/number_explicit/number_surname/number_team), match (exact/near), score bucket, cards on screen, seconds since shown |
| Names | `names.roster_refreshed` | changes count |
| Stats | `stats.play_applied` | play type, event count, yards source counts, confidence bucket, dropped-by-rule counts |
| Stats | `stats.play_undone` | play type, actions, seconds since applied |
| Stats | `stats.toggled` | on/off, minute of game |
| Stats | `stats.call_failed` | code |
| Game | `game.ended` | minutes, mic seconds, reconnects, cards shown, cards removed by key, refreshes, plays applied, plays undone, stats turned off mid-game, card latency p50/p95 ms, tokens in/out/cached |
| Feedback | `game_feedback` row | rating 1 to 5; blocker chips (wrong names, missing names, slow, stats wrong, stats missing, too much on screen, nothing); optional note up to 280 characters ("please don't type player names") |

### 10.3 Metric views in Supabase (read them in the Table Editor)

| View | Answers |
|---|---|
| `metrics_activation` | How many signed up, got approved, saved a roster, called a game, per week, and how long each step took |
| `metrics_prep` | Import success by format; minutes from first import to saved roster; rows edited per player (how good extraction is); how often warnings get acted on |
| `metrics_names` | Wrong-card rate per game, overall and by cue and match type; X vs digit use; latency |
| `metrics_stats` | Undo rate by play type and action (the best accuracy signal); dropped events by rule; how often stats get switched off mid-game; tokens per game |
| `metrics_retention` | Active callers per week; games per caller; who came back the next week |
| `metrics_feedback` | Average rating and top blockers per week |

### 10.4 Starting job stories to test

These are hypotheses. The views above tell you which ones hold.

1. **Prep:** When I get Friday's rosters, I want spotting cards built from whatever file I have, so I can cut prep from about 3 hours to under 1. *Watch: minutes from first import to saved, rows edited per player, formats used.*
2. **Live ID:** When a player I can't identify makes a play, I want his name and number up before I finish the sentence, so I never pause or say the wrong name. *Watch: wrong-card rate, latency, removals.*
3. **Live stats:** When a back has been busy all night, I want his running total in front of me, so I can drop an accurate stat line without keeping a sheet. *Watch: undo rate, stats switched off, feedback "stats wrong."*
4. **Context:** When a player makes a big play, I want his season plus tonight in one line, so I can put the play in context on air. *Watch: feedback chips and notes.*
5. **Trust:** When Spotter is wrong, I want to fix it in one key without losing my place, so I keep trusting it for the rest of the game. *Watch: seconds from card to removal, stats switched off mid-game.*
6. **Spreading:** When another announcer hears about Spotter, I want to go from sign-up to a called game within a week, so trying it is worth their time. *Watch: activation steps and time between them.*

---

## 11. Data sources and legality

I'm not a lawyer, and this isn't legal advice. It's a plain reading of the terms quoted in your research report and the vendors' own docs.

| Data | Where it comes from | Your personal use (paid NFHS announcer, your own games) | With open accounts |
|---|---|---|---|
| **Rosters** | You upload: MaxPreps printouts/screenshots, school athletics sites, coach rosters, game programs | MaxPreps licenses content "for your own personal, non-commercial use" and bars copying it "by any automatic or manual means." Using it to prep your own broadcast, privately, is what announcers do every week and a low practical risk. It isn't perfectly clean, though: you're paid for the broadcast, and saving a page into another tool is arguably "manual" copying. A roster from the coach or the school site is the clean source, since the school owns it. | MaxPreps also bars anyone from building "a business or other enterprise utilizing any of the Content, whether for profit or not." A public tool whose main input is MaxPreps PDFs edges toward that, even for free. Guardrails: Spotter never fetches from MaxPreps; each user uploads their own files; nothing is shared between accounts; don't market it as a MaxPreps tool. Get a real legal read before promoting it publicly. PlayOn owns both NFHS Network and MaxPreps. |
| **Season stats** | Same as rosters, plus local newspapers | Same as rosters. Newspaper *numbers* are facts. The articles themselves are copyrighted, so type the numbers, don't paste the articles. | Same as rosters. |
| **Live stats** | Your own spoken call | These come from your own words. The CIF State Office bars "non-editorial, commercial or other unauthorized use" of play-by-play descriptions of state and regional championships, and CIF-SS claims secondary rights to member contests. Your use is editorial, inside an authorized broadcast, private, and gone after the game. That's consistent with those rules. **Don't publish or sell the extracted play-by-play.** | Same, per user. |
| **Audio** | Your mic | Never recorded. Deepgram with `mip_opt_out=true` keeps it "only for the duration necessary to process the request." One unconfirmed report says opting out gives up a discount, which is worth checking on your Deepgram bill. | Same. |
| **Minors' info** (names, grade, height, weight) | Rosters | SOPIPA covers services designed and marketed for K-12 school purposes, and Spotter isn't one. CCPA only applies above $26.6M in revenue or 100,000+ consumers. COPPA is about collecting data *from* kids under 13. None of them fit. | Before inviting other people in, add a short privacy note: what's stored, who processes it (Deepgram, Anthropic, Supabase, Vercel), that analytics exist and hold no player data, and how to delete an account. It's not needed for Friday. |
| **Analytics** | Your and other users' clicks | Codes and counts tied to an account, with no player data. | Covered by the same privacy note. |
| **NFL test audio** | TV broadcast into your mic | A private test with nothing recorded and only text kept in your browser. Low risk. Don't publish the extracted stats. | n/a |
| **Rehearsal on an archived NFHS game** | Your NFHS subscription | Private viewing, nothing recorded. Low risk. | n/a |

**One thing to check yourself:** your NFHS Network freelance agreement. I haven't seen it. If it says anything about third-party tools, AI, or confidentiality, that controls.

---

## 12. What gets wiped vs kept

| Place | Wipe | Keep | Add |
|---|---|---|---|
| **GitHub** | Nothing on `main` | Repo, full history, `main` (V2, still live) | Tag `v2-final` on `main`'s current commit. Branches `v3` and `v3-stats`. V3 code starts from an empty folder on `v3`, with files copied from `main` as listed in the build list. Cloud sessions add short-lived `claude/...` branches, and each one can be deleted after its pull request is merged. |
| **Supabase data** | **Now:** every row in `teams`, `players`, `games`, `usage_events`, and every auth user | V2's empty tables, views and RPCs, until V3 survives a real game | V3 tables (section 9) |
| **Supabase data, later** | After V3's first good game: V2's tables, 5 `usage_*` views, 3 RPCs | V3 | |
| **Supabase settings** | | Project, Google provider, keys | Email provider: Confirm email **off**, min password 8, sign-ups **on**. Redirect URL `https://spotter-git-*.vercel.app/**` for branch links |
| **Vercel** | The `NEXT_PUBLIC_PLAY_FEED` variable | Project, domain, `DEEPGRAM_API_KEY`, `ANTHROPIC_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Tick **Preview** on every one of those variables so branch links get the same keys |
| **Google Cloud** | | OAuth client and client ID | Authorized JavaScript origins: the stable `v3` and `v3-stats` branch links |
| **Deepgram / Anthropic** | | Same keys | Nothing |
| **Claude Code cloud** | | | Claude GitHub App installed on the Spotter repo. No API keys go into the cloud environment. |
| **Your Mac** | | V2's `.env.local` works unchanged for the one local replay step | |

---

## 13. Testing and go/no-go

### 13.1 Names (the `v3` branch, before it goes onto your domain)
**Rehearsal:** play an archived NFHS broadcast into the laptop for at least 30 minutes, with V3 listening. Best choice: your own Sept 25 Brentwood vs. Estancia call, if it's in the NFHS archive. It's your voice, the same rosters, and we have V2's log from that game to compare against.

**Go if all of these hold:**
- No crash. A Wi-Fi drop reconnects by itself.
- Wrong-card incidents at or below V2's rate: $\frac{24}{234} \approx 10\%$ of cards.
- Zero single-digit misfires from a team cue.
- Zero "long / are gonna / be sick / Oregon" misfires for players set to exact-only.
- Sign-in, approval and roster upload work on the branch link.

### 13.2 Stats (the `v3-stats` branch, before it merges)
**The NFL test:** Spotter listens to a full NFL broadcast, or at least one half, with both teams' rosters uploaded (offensive line set to off). Afterward, download the log and compare Spotter's per-player totals to the ESPN box score.

**Merge only if all of these hold:**
- The replay equality test (G5) passes on the NFL log. Stats on vs. off, the cards are identical.
- Zero fumble recoveries counted as carries. Zero PBUs counted as tackles.
- For the top 2 rushers and top 3 receivers on each side: carries and catches within 1 of the box score, and yards within 10.
- Every yard figure that's off by more than 10 traces back to a known cause in the log (a play the announcers never called, `~` yards, and so on).
- Tackles will undercount, because announcers don't name every tackler. That's expected and doesn't block the merge.

The NFL test checks extraction on pro phrasing. It doesn't test *your* phrasing. Running the Sept 25 archive through the stats branch would, and that's the best second test if there's time.

---

## 14. What the Sept 25 log says (one game, provisional)

The game ran from 7:03 to 9:05 PM, with the mic on 105 minutes. The log has 3,979 rows: 266 match rows, 3,638 near misses, 32 wrong, 28 retracted, 8 repeats, and 7 conflicts.

- **Grouping rows into incidents:** 266 match rows are 234 separate card-ups (same name within 10 s merged), and 32 wrong rows are **24 separate mistakes** (you pressed the key more than once on some).
- **Where the 24 mistakes came from:** 11 exact-name matches, 5 Ossuetta (you said it for Estancia), 5 near-sound matches, and 3 jersey "0".
- **Near-sound matches were wrong 1 in 3 times:** $\frac{5}{15} \approx 33\%$. Every one came from an everyday phrase: "Oregon" and "are gonna" → Aragon #44, "long" → Longhi #5, "be sick" → Piesik #2.
- **Exact-name matches were wrong about 1 in 20 times**, and two of those 11 look like you clearing stale cards about 110 seconds later, not wrong matches.
- **Jersey "0":** it fired 5 times with "Estancia" as the only cue, and 4 of those rows were marked wrong. Wright #0 wears 0, and "Estancia 0" reads like a score.
- **Retractions:** 10 of the 28 were Bargas #8. Bargas and Vargas #21 are both on Estancia, and Deepgram flipped between them.
- **Context vetoes worked:** 190 near misses were blocked by down-and-distance (74), score (60), stat (25), field position (20), gain/loss (9), rank (1) and margin (1). V3 ports all of that.
- **Plays:** 117 proposed: 108 approved as-is, 5 corrected, 3 rejected, 1 never graded. The fumble and PBU errors still got through.
- **Render speed:** under 15 ms. Not an issue.

---

## 15. Settled after the Q&A (nothing left open)

- **Approved by Jed:**
  - `X` takes down the newest card
  - Start/Stop is on-screen only
  - `U` undoes the last stat
  - stats on/off switch per game
  - the 20-word evidence quote in the browser log
  - analytics built for job stories
- **Left to Claude's judgment ("whatever you think is best"):**
  - offensive linemen can get stats but never cards
  - go/no-go thresholds as written in section 13
  - table names as written in section 9
  - the analytics design in section 10

## 16. What I couldn't verify

- Your Vercel project settings. The Vercel connection here couldn't read the project. The build list has you check env vars and the branch link by hand.
- Exact button names in claude.ai/code and in Supabase's dashboard, which move around. The build list describes what to look for.
- Whether the Sept 25 game is in the NFHS archive.
- Current Deepgram pricing for opted-out requests.
- What your NFHS Network agreement says about outside tools.
- Why the card path itself put up more wrong cards on Sept 25. Section 4 guards every route, and G5 proves the stats side.
