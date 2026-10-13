import type { ShareOutcome } from "./repo/account";
import { failure, json } from "./route";

// What the shared-log routes (app/api/game-logs/) have in common: only
// production collects, and the database's refusals as the codes the browser
// reads. The browser never shows these; it keeps the piece and tries again
// later, or gives up quietly.

/** Only production keeps game logs (CLAUDE.md "Only production counts"). Anywhere else a write is a quiet 204. */
export function collectsLogs(): boolean {
  return process.env.RAILWAY_ENVIRONMENT_NAME === "production";
}

export const notCollected = () => new Response(null, { status: 204 });

export function shareResponse(outcome: ShareOutcome, created = false): Response {
  switch (outcome) {
    case "ok":
      return json({ ok: true }, created ? 201 : 200);
    case "not_found":
      return failure(404, "not_found", "Not found.");
    case "daily_limit":
      return failure(429, "shared_log_daily_limit", "Twenty game logs a day have already been shared.");
    case "too_large":
      return failure(413, "too_large", "That game log is too large to share.");
    case "not_approved":
      return failure(403, "not_approved", "This account cannot share game logs.");
  }
}
