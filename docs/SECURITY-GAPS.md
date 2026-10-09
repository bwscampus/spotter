# Security gaps

Measured against the class Production Standard (the `production-standard` skill). Rule IDs refer to its `standard.md`. Update this file when a gap is fixed or found.

Most rows are planned work for a later change set (`docs/technical-design.md` section 8), listed now so nothing is forgotten.

| Rule | Sev | Where | Gap | Status |
|---|---|---|---|---|
| API-9 | Medium | `app/api/health/route.ts` | Health check did not ping the database | Fixed in `security/db-auth` |
| DB-6 | High | Railway variables | Production must run the app as `app_rw_login`; the code refuses to start otherwise. Done on the old staging environment Oct 7 | Open until production's cutover |
| OPS-5 | Medium | Railway | No staging environment: one branch and one environment by decision (Oct 7). Changes reach users as soon as `main` deploys; CI (unit, database and ownership tests) and a local run are the only test | Accepted: decision |
| API-7 | Low | `lib/rosters/extractErrors.ts` | `MAX_UPLOAD_BYTES` is still 4 MB, sized for Vercel's 4.5 MB limit that Railway does not have; a PDF between that and `MAX_PDF_BYTES` is refused | Open: raise deliberately, with a test |
| API-4 | Low | `lib/securityHeaders.ts` | CSP allows `'unsafe-inline'` scripts for Next's bootstrap; a per-request nonce would remove it | Open |
| DB-6 / RLS | Low | `db/migrations` | No row level security as a backstop. Owner scoping is in the queries (`lib/server/repo/`, proved per route by `test/db/ownership.test.ts`) and composite foreign keys refuse cross-owner rows (`scripts/check-app-role.mjs`) | Open: by design for v1 |
| OPS-2 | Low | dev dependencies | `npm audit` reports `braces` (via `eslint-config-next`); dev-only, nothing shipped | Open: waiting on upstream |
| AUTH-3 | Low | `lib/server/rateLimit.ts` | The in-memory rate limiter resets on deploy and is per instance; fine for one Railway replica. It now guards only the sign-in, sign-up, reset and verification routes; the paid routes' limits moved to the database (spend ledger, below) | Open: revisit if scaled out |
| OPS-6 | Medium | (planned) | No error tracking or uptime monitor yet | Open: `ops/launch` |
| DB-5 / OPS-7 | Medium | (planned) | Backups, restore rehearsal and rollback steps not written yet | Open: `ops/launch` |
| AUTH-2 | High | `lib/server/auth.ts` | Email and password sign-in (Oct 8 sync) would let an unconfirmed address spend money. Every paid route (Deepgram token and keyterm check, roster, stats and storyline import, live stats) runs `requireVerifiedUser()`, which answers 403 `email_not_verified` until the emailed link is opened; Google accounts count as confirmed | Fixed in the Oct 8 sync |
| AUTH-3 | High | `lib/server/rateLimit.ts`, `app/api/auth/*` | New credential endpoints. Google sign-in, password sign-in, sign-up, forgot password, reset password, verify email and resend verification are each limited by client IP, and the ones that name an address by that address too (429 `rate_limited`) | Fixed in the Oct 8 sync |
| AUTH-1, AUTH-5, AUTH-7, DB-8 | High | `lib/server/password.ts`, `app/api/auth/*`, `app/api/me/route.ts`, `0016_email_password.sql` | Passwords are scrypt, 8 to 200 characters, common ones refused; sign-in, sign-up and reset answer the same whether or not an account exists; deleting an account needs the current password (or a Google sign-in within 10 minutes); a reset signs out every session; emailed links are stored as SHA-256 and work once | Fixed in the Oct 8 sync |
| Cost (OWASP API4) | High | `lib/server/usage.ts`, `db/migrations/0009_usage_limits.sql` | The paid routes had only in-memory per-user limits, reset on every deploy, and no dollar cap. V3's spend ledger replaced them: `usage_begin` refuses $8 a day per account and $1,000 a day for everyone (raised from $3 and $50 by `0017_spend_limits.sql` on Oct 8, which also removed the wait between calls and the count caps on the dollar-capped routes; the Deepgram routes keep their counts), and survives deploys. The Deepgram token route fails open if the check itself errors, so a database blip does not stop cards mid-game | Fixed in the Oct 8 sync |
| PRIV-3 / DB-7 | Medium | `shared_game_logs`, `lib/log/scrub.ts` | Shared game logs (on by default, off at setup or from the live screen) store players' last names, many of them minors', with the transcript on the server for 90 days. By design, so pronunciation failures can be read; first names and schools are masked, there is no owner id or game id, only the database owner can read it, and it is deleted with the account. `/privacy` says so ("The shared game log") | Accepted: by design, disclosed |
| DB-6 | Low | `scripts/migrate.mjs` | `app_rw` has plain row rights on every `public` table, including `usage`, `shared_game_logs` and `client_errors`, which the app should only reach through `usage_begin`/`usage_finish`, `share_game_log` and `record_client_error`. Owner scoping and the limits there rely on the app calling the functions, not on the database | Open: Low |
| PRIV-1 | High before outside users | `app/privacy/page.tsx`, `app/terms/page.tsx`, `app/contact/page.tsx` | The Oct 8 sync brought V3's privacy, terms and contact pages, written by Jed's team (the privacy page is marked "Draft, pending legal review"). The class rule is that the teacher reviews legal text before outside users are invited; rosters hold minors' names, grades, heights and weights. The privacy page also still says data is kept by Supabase and the site is hosted by Vercel, which is V3's platform, not this one's (Railway); fix that before the review. Since Oct 8 every file and paste goes to Gemini through OpenRouter (zero data retention routing) rather than Anthropic, and "Who processes it" says so; the reviewer should see that change | Open: teacher to review |

## Sensitive data (DB-7)

| Table | Column | Class | Why it is kept |
|---|---|---|---|
| `users` | `google_sub`, `email`, `name` | PII | the account; a Google account is found by `google_sub`, a password account by `lower(email)` |
| `users` | `password_hash` | CREDENTIAL (scrypt, AUTH-1) | email and password sign-in |
| `email_tokens` | `token_hash` | CREDENTIAL (hashed, DB-8) | single-use confirmation and reset links |
| `sessions` | `token_hash` | CREDENTIAL (hashed, DB-8) | sign-in; raw tokens live only in the browser cookie |
| `roster_players` | names, jersey, position, grade, height, weight, pronunciations, heard-as forms, storyline | PII of minors | the rosters the announcer uploads; the storyline is one line about the player, typed or written by Claude from an uploaded file |
| `roster_players` | `season_stats`, `season_lines` | public sports stats about minors | the cards |
| `game_feedback` | `note` | free text (could name a player) | feedback; left out of every metric view |
| `shared_game_logs` | `log_gz_b64`, `owner_hash` | PII of minors (last names, transcript) | finding where name spotting fails; scrubbed in the browser, kept 90 days |
| `client_errors` | error name, first line of the message, page path | none expected | crash reports; kept 90 days |
| `called_games`, `app_events`, `usage` | counts, codes and dollars | none | metrics and the spend ledger |

Railway encrypts storage and backups at rest. No column needs application-level encryption: nothing here is health, financial or a minor's own writing.

## Owner actions

See `docs/technical-design.md` section 10.
