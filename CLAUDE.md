@AGENTS.md

# Spotter

Spotter puts a player's card on screen the moment a high school announcer says their surname or cued jersey number, using Deepgram for the words and two saved rosters for the names. This repo is V3 (`JedSandler/Spotter` at `ad934d3`) moved onto the class stack: Railway Postgres with raw `pg`, Google sign-in only, Railway deploys. Live stats is not part of it yet.

**The product spec is `docs/V3_DEFINITION.md`; the architecture is `docs/technical-design.md`.** Where the spec talks about Supabase or Vercel, the design doc wins. If neither answers a question, stop and ask Jed rather than deciding.

## Git

- **One branch, one environment** (since Oct 7). `main` is the only long-lived branch, and Railway's production environment deploys it once CI passes. There is no staging.
- `main` is protected: work goes on a short-lived branch and reaches `main` through a pull request (merge commit, never a squash). Delete the branch once it is merged.
- With no staging, CI and a local run are the test. Run `npm run check && npm run build`, and `npm run test:db` against the local database, before opening the PR.
- The change sets are listed in `docs/technical-design.md` section 8.

## Production Standard

This project follows the class Production Standard (the `production-standard` skill).

- Before finishing any change that touches auth, the database or migrations, API routes, rendering of user content, uploads, env vars, or deploy/CI config, run the `production-standard` skill and fix any Critical/High finding it reports.
- Known gaps and their status live in `docs/SECURITY-GAPS.md`. Update it when you fix or find one.
- **Identity comes from the session, never the request body.** Every query that takes an id from the request also filters by the signed-in owner, and a foreign id is a 404.
- **Sign-in is Google only.** There are no passwords, so there is no reset or verification email. Users are keyed on Google's `sub`, never on email.

## Rules that do not bend

- **The hot path stays synchronous.** The function that handles Deepgram results and everything in `SpotterEngine.process` must not gain an `await`, a fetch or a storage call. Everything a live game needs is built before the mic turns on. Cards are direct DOM writes, not React renders.
- **Ported, not rewritten (G1).** `lib/matching/`, `lib/deepgram/` and `lib/audio/` come from Spotter `ad934d3` byte for byte, with their tests. `test/g1Ported.test.ts` fails if any of them changes; a deliberate fix is its own small change with its own tests and updates that file's line in `test/fixtures/g1-ad934d3.sha256`. Do not change matcher scoring or thresholds in `lib/matching/matcher.ts`.
- **A bare number never fires.** A number reaches the screen only with a cue beside it.
- **Keys stay server side.** `ANTHROPIC_API_KEY`, `DEEPGRAM_API_KEY` and the database URLs are read only in server code. Only `NEXT_PUBLIC_GOOGLE_CLIENT_ID` reaches the browser.
- **Never store an uploaded file.** No disk, no object storage, no logging of file contents or extracted text. Errors and events carry codes and counts, never roster content.
- **The browser log never leaves the browser** except by the user's own Download.
- **Analytics never carry player names, jerseys, heard words, transcript or file contents.**
- **Schema changes are SQL files in `db/migrations/`**, applied by `scripts/migrate.mjs` on deploy. Never change a production schema by hand.
- **Secrets live in Railway's variables (one set per environment) and in `.env.local`.** Never commit a .env file, never ask anyone to paste a key into a session. `.env.example` holds the names and no values.
- **Verify before claiming.** A feature is not done because it typechecks. Run it, look at it, and say plainly what you did not verify.

## Auth and the database

- **Sign-in:** the page asks `GET /api/auth/nonce` for a nonce (the raw value stays in an HttpOnly cookie, the page gets its SHA-256), hands it to Google Identity Services, and posts the ID token to `POST /api/auth/google`, which checks it with `lib/server/google.ts` and starts a session. Users are created waiting for approval.
- **Sessions** are `lib/server/session.ts`: a random token in `__Host-spotter_session`, only its SHA-256 in `sessions`. Never store or log a raw token.
- **Gates** are `lib/server/auth.ts`: `requireApprovedUser()` before anything that calls Anthropic or Deepgram (401 `signed_out`, 403 `not_approved`, 503 `approval_unavailable`), `requireAdmin()` for admin (404 to everyone else), `getViewer()` for pages.
- **Every state-changing route** checks `isSameOrigin()` and, if it takes credentials or spends money, a limit from `RATE_LIMITS` in `lib/server/rateLimit.ts` (429).
- **Queries** go through `lib/server/db.ts` with `$1` placeholders only. The app connects as `app_rw_login` (rows only); migrations run as the owner. `lib/server/config.ts` refuses to start on Railway with any other database user or a public host.
- **A new table** goes in a new numbered file in `db/migrations/`, references `users (id) on delete cascade` through `owner_id`, and pins child rows to their parent's owner with a composite foreign key, like `roster_players`. Add what the app's role must be able to do to `scripts/check-app-role.mjs`.
- **Local database:** `docker run -d --name spotter-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=spotter -p 55432:5432 postgres:18`, then `MIGRATION_DATABASE_URL=postgresql://postgres:postgres@localhost:55432/spotter APP_DB_PASSWORD=local npm run migrate`.

## Analytics

- `track()` in `lib/analytics/track.ts` queues in memory and sends batches to `POST /api/events` after paint. The vocabulary and the privacy filter live in `lib/analytics/events.ts`, which the browser and the route both run. **A string prop survives only if its value is declared in `ENUM_PROPS`.** A new event name needs `EVENT_NAMES` and a migration changing the `app_events` check constraint together; a test compares them.
- The route stamps `env` from the server's own `RAILWAY_ENVIRONMENT_NAME` (anything but `production` is recorded as `preview`, which the metric views leave out) and records nothing off Railway or from localhost.
- `account.signed_up` is sent when `POST /api/auth/google` says the sign-in created the account; a unique index keeps it to one per account.

## Teams and roster import

- `/teams` lists saved teams; `/teams/new` and `/teams/[id]` are one screen, `components/rosters/RosterEditor.tsx`: team fields, import, the review table, Save, Delete. Save sends `PUT /api/rosters`, which calls `save_roster` with the session's user id; passing the team's id renames it in place, and without an id it matches by `roster_key`, so importing the same team again replaces its roster.
- **One reading path.** `POST /api/rosters/extract` runs `readUpload` (checks the multipart body) then `readRoster`, and every format ends in the same `extractRoster` call: a PDF's text layer as text (falling back to the PDF itself, which Claude reads as page images), images as images, pasted text and spreadsheet rows as text. The prompt is `lib/rosters/extractionPrompt.ts`. Limits and failure codes are in `lib/rosters/extractErrors.ts`.
- The browser prepares files in `lib/rosters/importFiles.ts`: HEIC to JPEG with `heic-to`, oversized images shrunk to fit, CSV parsed (`lib/rosters/tableText.ts`) and .xlsx read with `read-excel-file` into " | " rows. Both libraries are loaded only when that kind of file is dropped.
- The review is `reviewRoster` in `lib/rosters/reviewPlayers.ts`. Common phrases heard during play are `lib/rosters/commonPhrases.ts` (meant to grow), scored through `scanWords` exactly like a live utterance. Look-alikes use V2's `findCrossPlayerCollisions` at the same "close" ratio as the common-word check, because Bargas and Vargas score just under the full threshold.
- `lib/rosters/editor.ts` holds the editor's rules as pure functions: football offensive linemen (`isOffensiveLineman`) start with spotting off but are saved; a re-import keeps pronunciations and spotting settings for the same surname and jersey and drops season stats; `toSaveArgs` builds exactly what `PUT /api/rosters` sends.

## Season stats and cards

- `/teams/[id]/stats` imports a team's season stats; `/teams/[id]/cards` previews every player's card. Both are linked from the team page, which asks first if the roster has unsaved edits: stats are matched to saved player ids, and a roster save replaces them.
- **Same four formats, one panel.** `components/rosters/ImportPanel.tsx` is the drop zone and paste box for both imports; `RosterImport` and `components/stats/StatsImport.tsx` wrap it. `POST /api/stats/extract` runs `requireApprovedUser()`, reuses `readUpload`, loads the roster with `getRosterForStats` (scoped to the owner), and calls `extractStats` (`lib/stats/extractStats.ts`). A stats PDF always goes as the document (page images), never its text layer.
- **Football is read in three calls at once**, one per group in `FOOTBALL_KEY_GROUPS` (offense, defense, special teams), each offered only its own keys, then joined by player (`mergeNumberReads`). One call writing every number on Brentwood's seven page MaxPreps sheet ran past the 120 s route budget. The prompt leaves zeros out and skips sections that only repeat numbers (All Purpose Yards, Total Yards, Scoring). Calls run at `effort: "low"`. The route logs one line per import with milliseconds and output tokens, counts only, so Railway's log shows how close a real sheet comes to the limit.
- **Football is numbers, every other sport is lines.** `statsKindFor` in `lib/stats/types.ts` decides. The prompts are `lib/stats/statsPrompt.ts`; football's schema is a list of `{ key, value }` pairs on the 9.2 keys, so nothing in it is nullable. The key list is `FOOTBALL_STAT_KEYS` in `lib/cards/statKeys.ts`; a test holds it equal to the spec and to `clean_season_stats`.
- Rows are placed by `matchStats` (jersey first, surname second, never a guess). A row that lands on nobody becomes a warning naming its jersey (`unmatchedWarnings`). The review's rules and exactly what `PUT /api/rosters/[id]/stats` sends (and `set_season_stats` gets) are pure functions in `lib/stats/review.ts`. A new import replaces the old stats, and `stats_as_of` defaults to today.
- **`lib/cards/` is shared card code** that the card path and live stats may both import, and that imports neither. `toCardPlayer` (`lib/cards/cardPlayer.ts`) is the one place that decides what a card says; the preview uses it, and the live screen's game builder must too. `seasonLines` (`lib/cards/lines.ts`) builds football's SEASON lines: one line per group, biggest first, extra groups sharing the last line; its TUNING block is at the top. Line limits are `lib/cards/limits.ts`.
- **The card:** a pronunciation, when there is one, is the big text in its typed case, with the spelled surname small beside it (`spelled` in `components/PlayerCard.tsx`; `fitCards` measures it). The "as of" date is an absolutely positioned stamp, so it can never change the card's size. Both are precomputed on `WatchlistPlayer`, so `writeCard` only copies strings.

## Game setup and the live screen

- `/` is the menu: New game, the game still open in this browser (`components/game/CurrentGame.tsx`), Teams. `/games/new` is setup (`components/game/GameSetup.tsx`): away roster left, home right, the warnings, an optional "Wearing tonight" per side, Start. There is no stats switch: live stats is not in this repo yet, so every game is stored with stats off. `/live` is `components/live/LiveScreen.tsx`.
- **Add a team from setup** (Oct 3): "+ Add a team" under each side goes to `/teams/new`, then `/teams/[id]/stats`, then back to `/games/new?away=…&home=…` with the new team picked. The way back rides in the URL (`?for=game&side=…&away=…&home=…`), built and read only by `lib/game/setupReturn.ts`, which keeps nothing but real team ids. `RosterEditor` takes it as `then` (Save goes on to the stats step) and `StatsImport` as `afterSave`; the stats step can be skipped. `GameSetup` opens with the URL's picks and loads them straight away.
- **Stale stats** (Oct 3): `lib/game/staleStats.ts` warns at setup about a team whose newest `stats_as_of` is `STALE_STATS_DAYS` (7) days old or more, counted in calendar days from the date string so no time zone moves it. `assembleGame` puts the date on each side as `statsAsOf`. `Summary` takes `today` as a prop so a test can fix the day; the warning links to the stats step with the way back, and never disables Start.
- **`lib/game/buildGame.ts` is the only place a game is built**, for Start and for Refresh rosters. `assembleGame` is the pure part: every card goes through `toCardPlayer`, players with spotting `off` are dropped inside `buildGameWatchlist` (no surname, no jersey), and `exact_only` rides on the entry as `exactOnly` for item 7's engine rule. The team-sounding warning is `lib/game/teamSounds.ts`: each school and mascot phrase through `scanWords`, the way `commonPhraseHits` scores play-by-play.
- The game lives in localStorage (`lib/game/snapshot.ts`, read through `useSyncExternalStore`), as in V2, so a reload mid-game needs no network. Its `gameId` is made in the browser before the `called_games` row is written (`lib/game/calledGames.ts`, through `POST /api/games`), so the log always has a game to belong to; `recorded` says whether the row landed. Starting a game while another is open ends the open one first.
- The live screen is V2's `Spotter.tsx` without the play feed or team colours. `handleResults` runs the engine and writes the cards; everything else goes through `afterPaint` into `afterResult`. `test/cardPathIsolation.test.ts` reads its source and fails if it gains an await, fetch, storage, database, or a log, count or analytics call before paint.
- Keys are `reduceLiveKey` in `lib/keys.ts`, pure: X is the newest card, 1 to 3 count from the top, with V2's repeat guard, text-entry check and debounce (`TAKEDOWN_DEBOUNCE_MS`). Start/Stop listening has no key on purpose.
- Counts for `called_games` and `game.ended` are pure functions in `lib/game/liveCounts.ts`, held in a ref and mirrored to localStorage after paint. `cards_shown` counts match rows, as V2 counted matches. `names.card_removed` props come from `lib/game/liveEvents.ts`; its enums (`CARD_CUES`, `MATCH_KINDS`, `SCORE_BUCKETS`) are declared in `lib/analytics/events.ts`.
- **The browser log is `lib/log/`**: IndexedDB, one store indexed by game (`gameLog.ts`), with a writer whose `push` only buffers and flushes in batches on a timer. `records.ts` holds the record shapes (every raw result with its words, interims included; utterances; match rows; the game as built, again on every refresh) and the two downloads: a `.json` a replay can feed back through `SpotterEngine` (`toDeepgramResults`), and a `.csv` in V2's match log columns. Clear removes this game's log only.

## The 7.3 name-spotting fixes

Tests for all of them are `test/spotFixes.test.ts` (the Sept 25 transcripts, through the real engine) and `test/numbers.test.ts`.

- **A team cue alone never fires a single digit.** The knob is `TEAM_CUE_MIN_DIGITS` in the TUNING block of `lib/matching/numbers.ts`; the check is one branch in `parseJerseyMentions`, after the no-cue check. "Number", "numero", "jersey", "wearing", "#5" (which `tokensFor` turns into "number 5") or a surname right beside the number still fire it. The blocked number is a `near_miss` with reason `single_digit_team_cue`, carrying the team word as `cueWord`.
- **Exact-only** is applied in `SpotterEngine.process` straight after `scanWords`: a surname match under 1.0 whose entry has `exactOnly` is filtered out before the number parse and the spot building, so a dropped near sound is not a cue for the number beside it. It is a `near_miss` with reason `exact_only`, logged from finals only like every other near miss. It is about how the surname sounds: numbers are not touched, and a pronunciation note is an exact form. `matcher.ts` is not edited.
- The team-sounding warning is setup only (`lib/game/teamSounds.ts`), and the look-alike warning is in the roster review (`lib/rosters/lookAlikes.ts`) and at setup, both at `CLOSE_RATIO`, because Bargas and Vargas score under the line. No live-path code.

## Past games

- `/games` (`app/games/page.tsx`, `components/games/PastGames.tsx`) lists `called_games`, newest first, with the rating joined from `game_feedback`. It is linked from the menu and from the live screen's header. The read is `listPastGames` in `lib/server/repo/games.ts`, which says a failed read apart from having no games. Counts only, as in 9.1: no player name is on the page or in the query.
- **Download shows only when this browser still has that game's log**: `logsInBrowser` asks IndexedDB (`countGameLog`) once per game after the page loads, and a game it cannot read counts as having none. The download itself is `lib/log/download.ts`, shared with the live screen's Log panel. Dates are formatted in the browser, because the server does not know the announcer's time zone.

## End game feedback and the metric views

- **The feedback card** (`components/live/FeedbackCard.tsx`) takes the live screen after End game has written the counts and cleared the game, and before the menu. It saves one `game_feedback` row through `PUT /api/games/[id]/feedback`, keyed by the game id (an upsert, so a second Save is still one row), and Skip saves nothing. A game whose `called_games` row never wrote gets no card, because there is nothing to attach it to. The rules are pure functions in `lib/game/feedback.ts` (`validateFeedback`, `toggleBlocker`), held equal to the table's check constraints by `test/feedback.test.ts`: rating 1 to 5, a note of at most 280 characters counted the way `char_length` counts them, and the seven chips, with "Nothing" never beside another chip. The note is the one place a player name could be typed; it never goes to analytics and the views leave it out.
- **The metric views** are in the `admin` schema (`db/migrations/0005_metrics_views.sql`), on which the app's role has no rights. They are read as the database owner, cover every account, and count `env = 'production'` only; `docs/METRICS.md` says what each one tests. A new view goes in the same schema and gets no grants. `test/metricsViews.test.ts` reads the SQL and fails if a view reads `app_events` without the production filter, reads an event name that is not in `EVENT_NAMES`, or reads a property the app does not send. `metrics_stats` reads property names that live stats must send once it reaches `main` (listed in the SQL and in `docs/METRICS.md`).


## Before you say you are done

```bash
npm run check && npm run build
```

Tests are vitest under `test/`.

## Traps this project has already fallen into

Each of these cost real time in V3. They are not hypothetical. (V3's Supabase, Vercel and iCloud traps are left out; the class stack does not have them.)

- **PDF.js detaches the array you open a PDF with.** `getDocumentProxy(bytes)` leaves `bytes.length` at 0, silently, so anything that needs the file afterwards sends an empty string to Anthropic. Always use `openPdf` from `lib/pdf.ts`.
- **A nullable enum in a structured output schema needs `anyOf`.** `{ type: ["string","null"], enum: [...values, null] }` is rejected before Claude reads anything, so it fails identically for every file. `test/extractionSchema.test.ts` guards this.
- **A stats table's meaning is in its columns.** Extracting text drops empty cells, so a ragged row cannot be aligned. Stats go to Claude as the PDF itself, where the page image preserves the layout. Rosters are simple lists and read fine from the text layer.
- **`proxy.ts` makes Next buffer the request bodies it matches** and silently truncate them. Its matcher skips `/api/*`, so uploads never pass through it; keep it that way.
- **Tailwind's preflight honours the `hidden` attribute**, which is what lets the card slots be shown and hidden by DOM writes.
- **Deleting a route breaks `tsc` and `next build` until `.next/dev/types` is cleared.** A dev server that ran earlier left a validator that still imports the old route. With no dev server running, `rm -rf .next/dev/types` fixes it.
- **`numerals=true` rewrites more than numbers.** It is what turns "twenty three" into one `23` token, which is the whole reason jersey numbers work, but it also renders "half" as `0.5`, "quarter" as `0.25` and "third" as `3rd`. That shows in the transcript line and is harmless: a decimal is one of the shapes that can never be a jersey. Verified against the live socket and the pre-recorded endpoint, 2026-09-17.
- **Holding a number to the end of an interim costs a whole utterance.** An interim that ends on the number is the normal case when an announcer says a number and looks up, and Deepgram sends no further result until it decides the utterance ended. Holding every such number put the card seconds late; holding only the ones that could still grow into another jersey on tonight's rosters (`couldGrow` in `numbers.ts`) puts it up at about 1.2s, which is where surnames are. Measured against the live socket, 2026-09-17. Firing early is safe because a final that disagrees retracts it.
- **With `smart_format` off there are no punctuated tokens.** A score arrives as `"14","12"`, never `"14-12"`, and a clock as `"2","30"`, never `"2:30"`. Write fixtures from that, not from what a written transcript looks like.
- **The matcher joins short adjacent words, so a surname's span can swallow its own number.** "12 Chen" scores as one Chen candidate covering both words, because a number normalizes to nothing. Number tokens are excluded when surname spans are mapped in `parseJerseyMentions`, or a surname can never sit next to a number and nothing narrows.
- **A browser takes the wake lock back whenever the tab is hidden**, and does not hand it back when the tab is shown again. `useWakeLock` re-requests on every `visibilitychange`, and treats a release while the page is visible as a refusal, which is the only case worth telling the announcer about.
- **Tailwind only writes CSS for class names it can read in the source.** A size moved into a constant and interpolated into a className generates no rule at all, and the element silently falls back to whatever it inherits. That is why the compact card's stat sizes are literals in `components/PlayerCard.tsx` rather than constants at the top of the file, which is the shape everything else there uses.
- **A snapshot rewritten mid-game reaches the live screen through `useSyncExternalStore`**, and two things hang off that: the engine is rebuilt because `watchlist` is a new array (identity, not contents), and the socket reopens only when the keyterm list actually changed, because `useDeepgramStream` keys its effect on the joined keyterms. A refresh that changes no names does not reconnect.
- **Every guard in the upload routes has a code** in `lib/rosters/extractErrors.ts`. It reaches the browser, the terminal and `app_events` (as `prep.import_finished`'s `fail_code`, which lists every code). Add a code when you add a guard; a generic failure is what made the first roster bug take a whole session to find.
- **A markup test that looks for "disabled" matches Tailwind's `disabled:` classes.** Match the attribute, ` disabled=""`, or the test passes whether the button is disabled or not.
- **A database outage must not end a game.** The proxy only checks that a session cookie exists, and the live screen runs from what the browser already holds. The Deepgram token route does read the database (`requireApprovedUser`), and answers 503 `approval_unavailable` when it cannot, which `DeepgramStream` retries with backoff; `not_approved` and `signed_out` are not in its fatal codes either, so the live screen has to refuse to start for an unapproved account rather than rely on the socket giving up.
- **Catching every error in the session check hides Next's own signal.** Reading cookies is how a page tells Next it depends on the request; `lib/server/auth.ts` reads them outside its `try`, or the build tries to prerender `/games` and fails.
