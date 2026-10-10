# Spotter on the class stack: Technical Design

Status: Approved 2026-10-06 · Product owner: Jed Sandler · Spec: `docs/V3_DEFINITION.md`

Sections 1 to 10 describe the port of V3 at `ad934d3` (Oct 6). Section 11 is the Oct 8 sync to V3 `c607645`, which brought live stats, email and password sign-in and the spend ledger, and dropped approval; where they differ, section 11 wins.

## 1. Summary

Spotter V3 (`JedSandler/Spotter` at `ad934d3`) runs on Next.js 16, Supabase (auth, Postgres, row level security) and Vercel, with Deepgram for speech and Claude for reading rosters and stats. Its matching engine and card path are well tested and must not regress. Its operations don't yet meet the class Production Standard: it has no license, no CI, no security headers, no limits on the paid routes, no account deletion, no health check or error tracking, and preview builds share production's database and keys.

This repo moves V3 onto the class stack:

- Railway Postgres with raw `pg` and SQL migrations, following papaspuzzles
- Google OAuth as the only sign-in
- Railway deploys, from `main` to one production environment (a separate staging environment was dropped on Oct 7)

It is built to the Production Standard from the first commit.

**In scope:** V3 as it is on Spotter's `main`, which is everything except live stats. Live stats can move over later as its own change set. The old repo and its Vercel site stay live until cutover (section 9).

## 2. What carries over unchanged

These rules protect live games and stay in force:

- **G1, ported byte for byte:** `lib/matching/`, `lib/deepgram/`, `lib/audio/` and their tests. CI diffs them against Spotter `ad934d3`, and `matcher.ts` is never edited.
- **The hot path stays synchronous.** Cards are direct DOM writes (`components/PlayerCard.tsx`, `components/NameDisplay.tsx`). `test/cardPathIsolation.test.ts` comes over.
- **Privacy rules.** Uploaded files are never stored; analytics are codes and counts only; the browser log (IndexedDB, `lib/log/`) never leaves the browser.
- **Pure modules port as they are, with their tests:**
  - `lib/cards/`
  - `lib/rosters/`, except its database reads
  - `lib/stats/`, except its database read
  - the pure parts of `lib/game/`
  - `lib/keys.ts`, `lib/pdf.ts`, `lib/afterPaint.ts`
  - `lib/analytics/events.ts` and `track.ts`
  - `lib/log/`
- **Left out:**
  - `lib/plays/`, which is live stats only
  - `lib/supabase/`
  - `proxy.ts` and its session refresh
  - `scripts/keep-icloud-out.sh`, unless the repo will live under iCloud
- **Upload size.** Vercel refused any request body over 4.5 MB; Railway has no such limit. `MAX_UPLOAD_BYTES` can therefore rise toward `MAX_PDF_BYTES`.

## 3. Architecture

```
Browser (Next.js client)
  ├─ Google Identity Services button / One Tap ──ID token──▶ POST /api/auth/google
  ├─ live screen: mic ─▶ Deepgram WSS (30 s temp token from /api/deepgram/token)
  │                   └─ SpotterEngine (sync) ─▶ DOM cards      (no network on hot path)
  ├─ IndexedDB log, localStorage game snapshot (unchanged)
  └─ fetch /api/*  (same-origin, JSON, session cookie)

Next.js server on Railway (one service; npm start = migrate && next start)
  ├─ lib/server/session.ts     opaque token, SHA-256 in `sessions`, __Host- cookie
  ├─ lib/server/auth.ts        getViewer / requireUser / requireApprovedUser / requireAdmin
  ├─ lib/server/db.ts          pg Pool (from papaspuzzles src/lib/db.ts)
  ├─ lib/server/repo/*.ts      every query takes ownerId first and filters by it
  ├─ lib/server/rateLimit.ts   from papaspuzzles (X-Real-IP and per-user keys)
  └─ route handlers (section 5)

Railway Postgres (private *.railway.internal URL)
  ├─ the app connects as app_rw_login (rows only)    DATABASE_URL
  └─ migrations run as the owner                      MIGRATION_DATABASE_URL
```

## 4. Auth: Google only

### Sign-in

The Google Identity Services button and One Tap come over from V3, including its nonce logic (`lib/auth/googleNonce.ts`). The browser POSTs the ID token to `POST /api/auth/google`. The server verifies it with `jose` against Google's published keys (`createRemoteJWKSet`). It checks that:

- `iss` is Google (`accounts.google.com` or `https://accounts.google.com`)
- `aud` is `GOOGLE_CLIENT_ID`
- `exp` has not passed
- `nonce` matches an HttpOnly nonce cookie
- `email_verified` is true

### Users

Users are keyed on Google's `sub`, not on email (AUTH-2, AUTH-8). The table is `users(id, google_sub unique, email, name, approved, approved_at, is_admin, created_at)`. With no passwords, AUTH-1, AUTH-5 (for passwords) and AUTH-7 are covered by design.

### Sessions (AUTH-4, DB-8)

- A random 32-byte token lives in a `__Host-spotter_session` cookie: HttpOnly, Secure, SameSite=Lax, 30 days.
- Only its SHA-256 is stored, in `sessions(token_hash, user_id, created_at, expires_at, last_seen_at)`.
- Sign out deletes that row; "Sign out everywhere" deletes all of the user's rows.

### Approval

Approval stays as in V3. `requireApprovedUser()` keeps its contract: 401 `signed_out`, 403 `not_approved`, 503 `approval_unavailable`. That leaves `DeepgramStream`'s retry logic untouched. The 503 now also covers a database failure while looking up the session.

### Admin (AUTH-8)

`is_admin` is set only by SQL, as an owner action for Jed's own row. `/admin` lists users waiting for approval, with Approve and Revoke buttons; it replaces the Supabase Table Editor step. A trigger stamps `approved_at`.

### Rate limits (AUTH-3, API4)

| Route | Keyed on |
|---|---|
| `/api/auth/google` | `X-Real-IP` |
| Deepgram token | user (cost guard) |
| Keyterm check | user (cost guard) |
| Roster extract | user (cost guard) |
| Stats extract | user (cost guard) |

All of them answer 429. The limits sit in one table in `lib/server/rateLimit.ts`.

### Account deletion (AUTH-6)

`DELETE /api/me` requires a Google sign-in within the last 5 minutes, checked against the session's `created_at`. The delete cascades through rosters, players, games, feedback, events and sessions. The client then clears the localStorage game snapshot and the IndexedDB log.

## 5. Data: Supabase calls become owner-scoped routes

| V3 (Supabase) | Here |
|---|---|
| `save_roster` RPC from `RosterEditor` | `PUT /api/rosters` and `PUT /api/rosters/[id]` call `save_roster(owner, team, players)`, rewritten to take an explicit owner instead of `auth.uid()` |
| `set_season_stats` RPC from `StatsImport` | `PUT /api/rosters/[id]/stats` calls `set_season_stats(owner, roster_id, stats)` |
| roster list and reads (`loadRosters`, team pages) | Server components call `repo/rosters.ts`. `GET /api/rosters?ids=` serves setup and Refresh rosters. |
| `DeleteTeamButton` | `DELETE /api/rosters/[id]` |
| `calledGames.ts` insert and update | `POST /api/games`, `PATCH /api/games/[id]` |
| `pastGames.ts` | Server component on `/games` via `repo/games.ts` |
| `feedback.ts` upsert | `PUT /api/games/[id]/feedback` |
| `/api/events` | Same logic. `env` comes from `RAILWAY_ENVIRONMENT_NAME`, and nothing is recorded from localhost. |

Rules:

- **API-1:** every `repo/*` function takes `ownerId` first, and every query filters on it. A foreign or missing id is a 404.
- **API-2:** request bodies go through hand-written validators with size caps, in the style of papaspuzzles `src/lib/validate.ts`.
- **API-3:** one JSON error shape carrying Spotter's existing codes. A 500 never shows details to the client and is logged with a request id.
- **RLS:** none in the first release. The app role has no `BYPASSRLS`, so row level security can be added later as a backstop (tracked in `docs/SECURITY-GAPS.md`).

## 6. Database

- **Migrations.** `db/migrations/0001_…sql` onward rewrite V3's seven Supabase migrations without `auth.*`, the RLS policies or the Supabase grants. They keep the check constraints that tests hold equal to the code:
  - `FOOTBALL_STAT_KEYS` and `clean_season_stats`
  - `EVENT_NAMES` and the `app_events` constraint
  - the feedback limits
- **Metric views.** They stay in the `admin` schema. `app_rw` has no grant there; Jed reads the views as the owner.
- **Migrations and the app role (DB-2, DB-6).** `scripts/migrate.mjs` and `scripts/check-app-role.mjs` come from papaspuzzles. They apply migrations once each, then idempotently (re)create `app_rw` with row access only. `npm start` runs `node scripts/migrate.mjs && next start`.
- **Types.** Row types are written by hand in `lib/server/types.ts`; there is no generated `database.types.ts`.
- **Personal data (DB-7):**

  | Data | Why it's kept |
  |---|---|
  | Google email and display name | the account |
  | Players' names, jersey, position, grade, height and weight (many are minors) | the rosters the announcer uploads |
  | Pronunciation notes | the cards |
  | The optional feedback note | free text, and could name a player |

  Analytics hold codes and counts only. No field needs application-level encryption.

## 7. Platform and operations

### Railway

- `.railway/railway.ts` describes the project as code: the `spotter` service and its own Postgres per environment, with the healthcheck at `/api/health`. Preview changes with `railway config plan` and apply them with `railway config apply`, once per environment. It pings the database and answers 503 when it is down (API-9).
- One environment, `production`, with its own Postgres, deploying `main` once CI passes. A staging environment ran until Oct 7 and was dropped to keep one branch and one environment; OPS-5 is tracked in `docs/SECURITY-GAPS.md`.

### Variables

`.env.example` lists the names with no values:

- `DATABASE_URL`, `MIGRATION_DATABASE_URL`, `APP_DB_PASSWORD`
- `GOOGLE_CLIENT_ID` and `NEXT_PUBLIC_GOOGLE_CLIENT_ID`
- `DEEPGRAM_API_KEY`, `OPENROUTER_API_KEY` (every model call since Oct 8: imports to Claude Sonnet 5, live stats to Claude Haiku 5.5 since Oct 10 (Gemini 3.8 Flash before), both through OpenRouter)
- `SENTRY_DSN`

Startup validation refuses to boot in production when one is missing (API-10).

### Headers (API-4)

The headers are in `lib/securityHeaders.ts` and applied in `next.config.ts`. The CSP allows these extra sources:

- Google Identity Services: script, style, frame and connect, all under `https://accounts.google.com/gsi/`
- Deepgram: `wss://api.deepgram.com` and `https://api.deepgram.com`
- `blob:` workers, for `heic-to` and the PCM worklet

`Permissions-Policy` allows `microphone=(self)`. `Cross-Origin-Opener-Policy: same-origin-allow-popups` lets Google's sign-in popup reach back to the page. `poweredByHeader` is off.

### Monitoring and recovery

- **Errors (OPS-6).** Sentry, with `sendDefaultPii: false` and a `beforeSend` that drops breadcrumbs and request bodies, so no transcript or roster text leaves.
- **Uptime.** A monitor on `/api/health`.
- **Backups and rollback.** Railway backups and point-in-time recovery, with one practice restore (DB-5). Rollback by redeploying the previous Railway deployment (OPS-7). Both are written up in the README.

## 8. Change sets

Each one was a branch and a pull request into `staging` (merged to `main` on Oct 7); from now on, branches go straight to `main`.

1. **`setup/skeleton`**
   - license, README, CLAUDE.md, docs
   - Next 16, Tailwind 4 and vitest config
   - `.nvmrc`, `.env.example`, Railway config (`.railway/railway.ts` since Oct 6)
   - CI `check` job and Dependabot
   - security headers, `/api/health` stub
2. **`port/engine`** (done Oct 6)
   - the pure modules and card components from section 2, with their tests, copied from `ad934d3`
   - G1 guard: `test/g1Ported.test.ts` checks every file in `lib/matching`, `lib/deepgram` and `lib/audio` (and the PCM worklet) against SHA-256s taken at `ad934d3`
   - no database
   - held back until the code they test arrives, taken from `ad934d3` again at that point:
     - change set 3: `metricsViews.test.ts`, `requireApprovedUser.test.ts` (rewritten for sessions), and one case each in `analyticsEvents.test.ts` and `statsExtraction.test.ts` that read the migrations (`it.skip` now)
     - change set 4: `cardPathIsolation`, `spotFixes`, `staleStats`, `buildGame`, `liveCounts`, `feedback`, `pastGames`, `importGate`, `rosterImport`
     - dropped: `playWindow.test.ts` (live stats)
3. **`security/db-auth`** (Oct 6)
   - `db/migrations/0001`–`0005` (users and sessions, rosters, games and feedback, events, metric views), `scripts/migrate.mjs`, the `app_rw` / `app_rw_login` role, `lib/server/db.ts`
   - composite foreign keys keep every child row inside its owner's data; a trigger stops the app's role from ever setting `is_admin`
   - Google sign-in (`/api/auth/nonce`, `/api/auth/google`), sessions, sign-out (`/api/auth/signout`, `?everywhere=1`), `lib/server/auth.ts`, the rate limiter, startup validation (`instrumentation.ts`)
   - health pings the database
   - CI `db` job on Postgres 18: migrate twice, then `scripts/check-app-role.mjs`
4. **`port/app`** (Oct 6)
   - every V3 page and component, with Supabase replaced by owner-scoped routes (section 5) and `lib/server/repo/`; the email/password and reset pages are gone
   - the Google-only sign-in button and page, `/auth/signout`, and a `proxy.ts` that sends visitors with no session cookie to `/login` without touching the database
   - the four paid routes behind `requireApprovedUser()` with per-user limits; a test proves each refuses before calling out
   - `test/db/ownership.test.ts`: every route that takes an id, called as another account against real Postgres (CI `db` job)
   - V3's held-back tests are back; 771 unit tests and 11 database tests
5. **`security/account-admin`**
   - `/admin` approvals
   - `DELETE /api/me`
   - Sign out everywhere
   - sign-out and deletion clear the browser data
6. **`ops/launch`**
   - Sentry
   - backup, restore and rollback docs
   - `SECURITY-GAPS.md` brought up to date
   - cutover checklist

## 9. Cutover

There are two ways to carry rosters over, decided at change set 6:

- Jed re-imports his rosters, as he did for V2 → V3.
- A one-time script matches Supabase `auth.identities` Google `sub`s to the new `users` and copies `rosters` and `roster_players` only.

Then:

1. Point the domain at Railway.
2. Add Railway's origins to the Google OAuth client.
3. Keep Vercel and Supabase as the fallback until one real game passes.

## 10. Owner actions

These need a person with access; they can't be done from code.

- **GitHub:** secret scanning and push protection (OPS-3). Protect `main`: pull requests only, CI must pass, one review (OPS-4).
- **Railway:** the project; the production environment with its own Postgres; a sealed `APP_DB_PASSWORD`; Wait for CI; backups and point-in-time recovery; one practice restore.
- **Google Cloud:** sign-in reuses V2/V3's OAuth web client (`265976696241-1oqf3scr31bglef3gk11dpb6i4e832dj.apps.googleusercontent.com`), which lives in Jed's Google Cloud project; Railway holds it as `GOOGLE_CLIENT_ID` and `NEXT_PUBLIC_GOOGLE_CLIENT_ID`. Jed adds the Railway production address to its authorized JavaScript origins, and removes the Vercel ones once V3 is retired. If the app should not depend on his account, create a client in a school-owned project and swap the two variables.
- **Deepgram and OpenRouter:** spend alerts on both keys.
- **First admin:** after Jed's first production sign-in, run `update users set is_admin = true, approved = true where google_sub = '…'`.
- **Privacy note (PRIV-1):** written with the teacher before outside announcers are invited.

## 11. Syncing from V3 (Oct 8)

The port's base moved from V3 `ad934d3` (Oct 6) to V3 `c607645` (V3's `main`, Oct 8). Everything V3 built in between came over, rewritten for this stack where it touched Supabase or Vercel. The sync was made on the branch `sync/v3-2026-10-08` and reaches `main` by pull request like any other change.

### What came over

- **Live stats** (spec section 8): `lib/livestats/`, `components/livestats/`, `lib/plays/`, `lib/replay/`, `scripts/replay-livestats.ts` and `scripts/check-cards.ts`, with their tests. `POST /api/livestats/extract` reads plays with Gemini through OpenRouter (`OPENROUTER_API_KEY`), or Claude with `LIVE_STATS_PROVIDER=anthropic`. Setup's Live stats switch is football only and off by default.
- **The card** as redesigned Oct 3 and made horizontal Oct 4 (`docs/CARD_SPEC.md`: `lib/cards/cardFace.ts`, `bigLine.ts`, `tonight.ts`, the stage font), and the dashboard look of Oct 5 (`docs/UI_STYLE.md`, `components/ui/`, `SiteChrome`).
- **Name spotting:** stars and call rate (spec 7.4), keyterm selection and fitting, suffixes, first-name collisions, cross-roster look-alikes, the determiner veto, "heard as" forms with the sound check and Past games' suggestions, the room boost and quiet warning, and the silence alarm with its connection record.
- **Teams:** inferred team colours, storylines and the "other info" import (`POST /api/storylines/extract`).
- **Pre-launch work** from V3's audit: the spend ledger, delete my account, upload consent, crash reports, shared scrubbed game logs, browser data stamped per account, the idle and browser checks, the public landing page, `/home`, and `/privacy`, `/terms` and `/contact`.
- **Email and password sign-in**, which V3 had through Supabase Auth, built on this server. This supersedes section 4's "Google only", approval and `/admin`.

New routes for this: `/api/auth/signup`, `/signin`, `/forgot-password`, `/reset-password`, `/verify-email`, `/resend-verification`; `/api/livestats/extract`, `/api/storylines/extract`; `/api/game-logs`, `/api/client-errors`, `/api/upload-terms`, `/api/me` (account deletion); `/api/players/[id]` (heard-as forms and spotting) and `/api/rosters/players` (players for the sound check and suggestions).

### The four product decisions

1. **Live stats is in.** It was out of scope in section 1; it came over whole, with G3 to G6 (spec section 4) and `test/cardPathIsolation.test.ts` guarding the card path from it.
2. **No approval; the spend ledger instead.** V3 removed its approval step on Oct 7 and limits a new account with a per-account spend ledger. Here: every account is created with `users.approved = true` (`0013`), `approved` stays only as an off switch the database owner can set to false, and every paid route runs `beginUsage` (`lib/server/usage.ts`) right after the sign-in check, calling `usage_begin` / `usage_finish` (`0009`). The ledger replaced this repo's in-memory per-user limits on the paid routes; the in-memory limiter in `lib/server/rateLimit.ts` now covers only the sign-in, sign-up, reset and verification routes. There is no `/admin` page; the off switch is `update users set approved = false where …`, run as the owner.
3. **Google and email/password sign-in.** An email and password account is in at once, but nothing that spends money opens until it has opened its emailed confirmation link: the paid routes run `requireVerifiedUser()` (`lib/server/auth.ts`), which adds 403 `email_not_verified` to `requireApprovedUser()`'s answers. Google accounts count as confirmed. Schema in `0016`; passwords are scrypt, emailed links are stored as SHA-256, and email goes through Resend (`RESEND_API_KEY`, `EMAIL_FROM`, `APP_URL`).
4. **Shared scrubbed game logs, as V3 does them.** On by default at setup, off with one click, sent at End game through `POST /api/game-logs`, production only. A row keeps players' last names (minors among them) server-side by design, and has no owner id or game id.

### The V3-compatible shim

Where V3 code imports a module that talks to Supabase, this repo keeps that module's path, export names and return shapes and implements it on its own server, so V3's pages and components port byte for byte and the next sync is a merge rather than a rewrite:

| V3 module | Here |
|---|---|
| `lib/rosters/loadRosters.ts` (`loadTeamList`, `loadRosters`, `loadRosterState`, `loadRoster`) | the same names, served from `lib/server/repo/rosters.ts` for the session's user |
| `lib/auth/viewer.ts` (`getViewerId`, `getViewerEmail`, `getUploadTermsAccepted`) | the same names, read from the session (`getViewer()`) and `users` |
| `lib/usage/server.ts` (`beginUsage`, `finishUsage`) | `lib/server/usage.ts`, the same functions with the owner's id passed in; `lib/usage/limits.ts`, `body.ts` and `prices.ts` are V3's |
| `countsInSupabase()` in `lib/deployEnv.ts` | kept by name; true only when `NEXT_PUBLIC_DEPLOY_ENV` (set in `next.config.ts` from `RAILWAY_ENVIRONMENT_NAME`) is `production` |
| browser inserts, RPCs and deletes under row level security | a same-origin route called with `api()` (`lib/apiClient.ts`) and an owner-scoped repo function |
| pg_cron jobs | `lib/server/housekeeping.ts`, started from `instrumentation.ts`, once a day |

Database functions that read `auth.uid()` in V3 take `p_owner uuid` as their first argument here, and return what V3's returned, so the TypeScript that parses their answers is V3's.

### Migrations 0006 to 0017

Each file's header names the V3 migrations it comes from.

| File | From V3 | What it covers |
|---|---|---|
| `0006_stats_keys_color_heard_as.sql` | `20260930214906`, `20261003205012`, `20261004210919` | `int_td` and `fr_td` in `clean_season_stats`; `rosters.primary_color`; `roster_players.heard_as`. Its header also maps every later V3 migration to its file here and lists what was skipped. |
| `0007_app_events_names.sql` | `20261002031051`, `20261004213450` | four event names: `stats.play_discarded` and the three `prep.heard_as_*`; must equal `EVENT_NAMES` |
| `0008_shared_game_logs.sql` | `20261005235549`, `20261006045051`, `20261007051643`, `20261007052059` | the `shared_game_logs` table (no owner id, no game id), `owner_hash`, 6 million characters and 5 a day per account; writes only through `share_game_log(p_owner, …)`, which refuses a switched-off account; `delete_expired_shared_logs()` for the 90-day expiry |
| `0009_usage_limits.sql` | `20261007043948` | the `usage` ledger, `usage_begin(p_owner, p_route)` and `usage_finish(p_owner, …)` ($3 a day per account, $50 for everyone, per-route counts; the two Deepgram routes by count only), `admin.usage_by_user`, and `app_events_daily_cap` (5,000 events per account per UTC day) |
| `0010_accounts_and_errors.sql` | `20261007044924`, `20261007045325` | `users.accepted_upload_terms_at` and `accept_upload_terms(p_owner)`; the `client_errors` table, `record_client_error()` (20 an hour per account) and `delete_old_client_errors()`; `admin.pending_approvals` and `admin.recent_client_errors` |
| `0011_delete_my_account.sql` | `20261007060000` | `delete_my_account(p_owner)`: the account's shared logs by `owner_hash`, then the `users` row, and everything else by cascade |
| `0012_save_roster_whole.sql` | `20261007060100`, `20261007203248` | `roster_players.storyline`; `save_roster` writes the colour, heard-as forms and storylines in the same transaction (an entry without a key keeps the same player's value, found by `roster_player_identity`), and refuses oversized rosters, names and forms and a 61st team |
| `0013_no_approval.sql` | `20261007234005` | `users.approved` defaults to true, and everyone waiting is approved |
| `0016_email_password.sql` | none (V3 used Supabase Auth) | `password_hash`, `email_verified_at`, `google_sub` nullable, one account per `lower(email)`, every account must have a way in, and `email_tokens` (SHA-256 of single-use links) |
| `0017_spend_limits.sql` | none (this repo, Oct 8) | replaces `usage_begin`: $8 a day per account and $1,000 for everyone, no wait between calls, no count cap on live stats and the imports; the Deepgram routes keep 180 tokens an hour and 60 keyterm checks a day |

There is no `0014` or `0015` in `db/migrations/` as this is written. `scripts/migrate.mjs` applies files in name order, once each, so a gap does no harm, but a file numbered below one production has already applied would run out of order: give new migrations numbers above the highest applied.

### V3 migrations with no counterpart

Listed in `0006`'s header, all because they only existed for Supabase:

- every grant and revoke to `anon` and `authenticated`, every row level security policy, and security definer used to get past one (`app_rw` has rows on `public` and nothing else, and functions take the owner explicitly);
- the pg_cron jobs in `20261005235549` and `20261007045325` (their functions are kept and run by `lib/server/housekeeping.ts`);
- `20261007052320_v3_tighten_grants.sql` (revokes Supabase's default TRUNCATE, REFERENCES and TRIGGER grants, and `rls_auto_enable()`; `app_rw` never had them, and `scripts/check-app-role.mjs` proves truncate is refused);
- `20261007060200_v3_drop_v2.sql` (this database never had V2);
- `handle_new_user()` in `20261007234005` (Supabase's trigger making a profile per auth user; the app inserts users here);
- the `set local lock_timeout` guards in `20261007051643` and `20261007052059` (`shared_game_logs` was new and empty here).

### G1

`test/g1Ported.test.ts` now checks `lib/matching`, `lib/deepgram`, `lib/audio` and `public/pcm-capture-worklet.js` against `test/fixtures/g1-v3.sha256`, taken at V3 `c607645` (it replaced `g1-ad934d3.sha256`). Those files are V3's byte for byte again, including V3's changes since `ad934d3` (stars, the determiner veto, the room boost, the silence alarm's hooks).

### How to do the next sync

1. **Pick the new base.** In the V3 clone, note V3's new `HEAD` and list what changed since the last base: `git diff --stat c607645 <new>`. Work on a new branch here.
2. **Merge per file, three ways.** For each changed file the base is V3's version at the old base, ours is this repo's, and theirs is V3's at the new base:
   - if ours is still byte for byte V3's old version (a file we never adapted), take V3's new version as it is;
   - otherwise merge V3's change into ours (`git merge-file ours base theirs`), and resolve by hand, keeping our stack: routes and `api()` where V3 calls Supabase, `p_owner` where V3 reads `auth.uid()`, `RAILWAY_ENVIRONMENT_NAME` where V3 reads `VERCEL_ENV`;
   - a new V3 file that calls Supabase goes through the shim: extend `loadRosters.ts`, `viewer.ts`, `lib/server/usage.ts` or add a route and a repo function, rather than editing V3's callers;
   - **a "new" V3 file whose path this repo already has is not new: merge it.** On Oct 8 V3's `.github/workflows/ci.yml` (added after `ad934d3`) was copied over ours and dropped the `db` job and the audit; the `main` ruleset's required `check` and `db` checks caught it. Check every new V3 path with `git cat-file -e main:<path>` before copying, and never take V3's `.github/`, `.railway/`, `railway.json` or `vercel.json`.
3. **Migrations.** Each new V3 migration becomes a new numbered file in `db/migrations/` whose header names the V3 files it comes from, with grants, policies, `auth.uid()`, security definer and pg_cron dropped or rewritten as above. Record anything skipped and why.
4. **Re-baseline G1.** Regenerate `test/fixtures/g1-v3.sha256` from V3's new base (and its comment line, and the commit named in `test/g1Ported.test.ts`), in the sync itself. Our own copies of those files must then equal V3's.
5. **Tests and docs.** Bring V3's new tests over with the code. Merge `CLAUDE.md` the same three ways, rewriting Supabase and Vercel steps for this stack, and add a section here like this one. Then `npm run check && npm run build`, `npm run test:db` against the local database, and a local run of a game before the pull request.
