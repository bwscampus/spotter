@AGENTS.md

# Spotter

Spotter puts a player's card on screen the moment a high school announcer says their surname or cued jersey number, using Deepgram for the words and two saved rosters for the names. This repo is V3 (`JedSandler/Spotter` at `ad934d3`) moved onto the class stack: Railway Postgres with raw `pg`, Google sign-in only, Railway deploys. Live stats is not part of it yet.

**The product spec is `docs/V3_DEFINITION.md`; the architecture is `docs/technical-design.md`.** Where the spec talks about Supabase or Vercel, the design doc wins. If neither answers a question, stop and ask Jed rather than deciding.

## Git

- `staging` has no branch protection. Work may be committed and pushed straight to it, or go through a short-lived branch and a PR into it. Railway's `staging` environment deploys it.
- `main` is production and is protected. It changes only by a tested `staging` → `main` merge commit, never a squash, and only when Jed says so.
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

As each port change set lands, it brings its section of Spotter-v3's CLAUDE.md here (teams and import, season stats and cards, setup and the live screen, the 7.3 fixes, past games, feedback and metrics, and the Traps), rewritten for Railway and Google sign-in.

## Before you say you are done

```bash
npm run check && npm run build
```

Tests are vitest under `test/`.
