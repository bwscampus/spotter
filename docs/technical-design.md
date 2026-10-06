# Spotter on the class stack: Technical Design

Status: Approved 2026-10-06 · Product owner: Jed Sandler · Spec: `docs/V3_DEFINITION.md`

## 1. Summary

Spotter V3 (`JedSandler/Spotter` at `ad934d3`) runs on Next.js 16, Supabase (auth, Postgres, row level security) and Vercel, with Deepgram for speech and Claude for reading rosters and stats. Its matching engine and card path are well tested and must not regress. Its operations don't yet meet the class Production Standard: it has no license, no CI, no security headers, no limits on the paid routes, no account deletion, no health check or error tracking, and preview builds share production's database and keys.

This repo moves V3 onto the class stack:

- Railway Postgres with raw `pg` and SQL migrations, following papaspuzzles
- Google OAuth as the only sign-in
- Railway deploys, with separate `staging` and `production` environments

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
- There are two environments, `staging` and `production`, each with its own Postgres and variables (OPS-5). Staging deploys `staging`; production deploys `main`. "Wait for CI" is on.

### Variables

`.env.example` lists the names with no values:

- `DATABASE_URL`, `MIGRATION_DATABASE_URL`, `APP_DB_PASSWORD`
- `GOOGLE_CLIENT_ID` and `NEXT_PUBLIC_GOOGLE_CLIENT_ID`
- `DEEPGRAM_API_KEY`, `ANTHROPIC_API_KEY`
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

Each one is a branch off `staging` and a pull request into it.

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
4. **`port/app`**
   - the repo layer and the routes in section 5
   - every page and component moved from Supabase to `fetch`
   - a BOLA test for each route that takes an id
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

- **GitHub:** secret scanning and push protection (OPS-3). Protect `main`: pull requests only, CI must pass, one review (OPS-4). `staging` is left unprotected so work can be pushed to it directly. `main` stays the default branch, as in papaspuzzles.
- **Railway:** the project; `staging` and `production` environments, each with its own Postgres; a sealed `APP_DB_PASSWORD`; Wait for CI; backups and point-in-time recovery; one practice restore.
- **Google Cloud:** authorized JavaScript origins for the staging and production domains.
- **Deepgram and Anthropic:** separate staging keys, or at least spend alerts.
- **First admin:** after Jed's first production sign-in, run `update users set is_admin = true, approved = true where google_sub = '…'`.
- **Privacy note (PRIV-1):** written with the teacher before outside announcers are invited.
