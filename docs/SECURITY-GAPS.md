# Security gaps

Measured against the class Production Standard (the `production-standard` skill). Rule IDs refer to its `standard.md`. Update this file when a gap is fixed or found.

Most rows are planned work for a later change set (`docs/technical-design.md` section 8), listed now so nothing is forgotten.

| Rule | Sev | Where | Gap | Status |
|---|---|---|---|---|
| API-9 | Medium | `app/api/health/route.ts` | Health check did not ping the database | Fixed in `security/db-auth` |
| DB-6 | High | Railway variables | Each environment must run the app as `app_rw_login`; the code refuses to start otherwise, so until the cutover is run a deploy of this code fails its health check and the previous one keeps serving | Open: owner action (cutover, below) |
| API-4 | Low | `lib/securityHeaders.ts` | CSP allows `'unsafe-inline'` scripts for Next's bootstrap; a per-request nonce would remove it | Open |
| DB-6 / RLS | Low | `db/migrations` | No row level security as a backstop. Owner scoping is in the queries (`lib/server/repo/`, port/app) and composite foreign keys refuse cross-owner rows (`scripts/check-app-role.mjs`) | Open: by design for v1 |
| OPS-2 | Low | dev dependencies | `npm audit` reports `braces` (via `eslint-config-next`); dev-only, nothing shipped | Open: waiting on upstream |
| AUTH-3 | Low | (planned) | The in-memory rate limiter resets on deploy and is per instance; fine for one Railway replica | Open: revisit if scaled out |
| OPS-6 | Medium | (planned) | No error tracking or uptime monitor yet | Open: `ops/launch` |
| DB-5 / OPS-7 | Medium | (planned) | Backups, restore rehearsal and rollback steps not written yet | Open: `ops/launch` |
| PRIV-1 | High before outside users | (planned) | No privacy note. Needed before anyone but Jed is invited; rosters hold minors' names, grades, heights and weights | Open: teacher to write |

## Sensitive data (DB-7)

| Table | Column | Class | Why it is kept |
|---|---|---|---|
| `users` | `google_sub`, `email`, `name` | PII | the account; keyed on `google_sub` |
| `sessions` | `token_hash` | CREDENTIAL (hashed, DB-8) | sign-in; raw tokens live only in the browser cookie |
| `roster_players` | names, jersey, position, grade, height, weight, pronunciations | PII of minors | the rosters the announcer uploads |
| `roster_players` | `season_stats`, `season_lines` | public sports stats about minors | the cards |
| `game_feedback` | `note` | free text (could name a player) | feedback; left out of every metric view |
| `called_games`, `app_events` | counts and codes | none | metrics |

Railway encrypts storage and backups at rest. No column needs application-level encryption: nothing here is health, financial or a minor's own writing.

## Owner actions

See `docs/technical-design.md` section 10.
