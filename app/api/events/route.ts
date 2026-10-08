import { isLocalHost } from "@/lib/analytics/localHost";
import { parseBatch } from "@/lib/analytics/events";
import { requireUser } from "@/lib/server/auth";
import { insertEvents } from "@/lib/server/repo/events";
import { forbidden, isSameOrigin, NO_STORE } from "@/lib/server/request";
import { readJsonBody } from "@/lib/usage/body";

// =============================================================================
// Receives a batch of analytics events from lib/analytics/track.ts and writes
// them to app_events for the signed-in account only.
//
// Open to every signed-in account: recording what someone did costs nothing.
// The database caps how many one account records a day (app_events_daily_cap).
//
// Logs error codes only, never props, so nothing an event carried can reach
// Railway's logs.
// =============================================================================

/** Far past MAX_EVENTS_PER_REQUEST events at their largest. */
const MAX_BODY_BYTES = 128 * 1024;

function nothing(status = 204) {
  return new Response(null, { status, headers: NO_STORE });
}

export async function POST(request: Request) {
  // Only Spotter's own pages may record events.
  if (!isSameOrigin(request)) return forbidden();

  // A development machine is not usage. The browser already drops these; this
  // catches anything that got past it.
  if (isLocalHost(request.headers.get("host"))) return nothing();

  // Where this server runs, not what the page says. Only production counts: a
  // local run records nothing (lib/deployEnv.ts).
  if (process.env.RAILWAY_ENVIRONMENT_NAME !== "production") return nothing();

  const gate = await requireUser();
  if (!gate.ok) return gate.response;

  // Counted as it arrives, so a body without a content-length is held to the same limit.
  const body = await readJsonBody(request, MAX_BODY_BYTES);
  if (body.kind === "too_large") return nothing(413);
  if (body.kind !== "ok") return nothing(400);

  const batch = parseBatch(body.value, new Date());
  if (!batch) return nothing(400);
  if (batch.events.length === 0) return nothing();

  try {
    await insertEvents(gate.user.id, { env: "production", appVersion: batch.appVersion, sessionId: batch.sessionId }, batch.events);
  } catch (error) {
    console.error(`[Spotter] Could not record ${batch.events.length} analytics events (${(error as { code?: string }).code ?? "unknown"}).`);
    return nothing(502);
  }
  return nothing();
}
