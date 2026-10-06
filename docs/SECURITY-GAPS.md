# Security gaps

Measured against the class Production Standard (the `production-standard` skill). Rule IDs refer to its `standard.md`. Update this file when a gap is fixed or found.

Most rows are planned work for a later change set (`docs/technical-design.md` section 8), listed now so nothing is forgotten.

| Rule | Sev | Where | Gap | Status |
|---|---|---|---|---|
| API-9 | Medium | `app/api/health/route.ts` | Health check does not ping the database yet (no database until `security/db-auth`) | Open: `security/db-auth` |
| API-4 | Low | `lib/securityHeaders.ts` | CSP allows `'unsafe-inline'` scripts for Next's bootstrap; a per-request nonce would remove it | Open |
| DB-6 / RLS | Low | (planned) | No row level security as a backstop; owner filtering is enforced in `lib/server/repo/` and tested | Open: by design for v1 |
| AUTH-3 | Low | (planned) | The in-memory rate limiter resets on deploy and is per instance; fine for one Railway replica | Open: revisit if scaled out |
| OPS-6 | Medium | (planned) | No error tracking or uptime monitor yet | Open: `ops/launch` |
| DB-5 / OPS-7 | Medium | (planned) | Backups, restore rehearsal and rollback steps not written yet | Open: `ops/launch` |
| PRIV-1 | High before outside users | (planned) | No privacy note. Needed before anyone but Jed is invited; rosters hold minors' names, grades, heights and weights | Open: teacher to write |

## Owner actions

See `docs/technical-design.md` section 10.
