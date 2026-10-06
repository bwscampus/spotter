import { isLocalHost } from "@/lib/analytics/localHost";
import { parseBatch } from "@/lib/analytics/events";
import { requireUser } from "@/lib/server/auth";
import { insertEvents } from "@/lib/server/repo/events";
import { isSameOrigin } from "@/lib/server/request";

// =============================================================================
// Receives a batch of analytics events from lib/analytics/track.ts and writes
// them to app_events for the signed-in account only.
//
// Open to accounts still waiting for approval: recording what someone did
// costs nothing, and account.signed_up happens before anyone is approved.
//
// Logs error codes only, never props, so nothing an event carried can reach
// Railway's logs.
// =============================================================================

/** Far past MAX_EVENTS_PER_REQUEST events at their largest. */
const MAX_BODY_BYTES = 128 * 1024;

const NO_STORE = { "Cache-Control": "no-store" };

type Env = "production" | "preview";

const ENVIRONMENTS: Record<string, Env> = { production: "production", staging: "preview" };

function nothing(status = 204) {
  return new Response(null, { status, headers: NO_STORE });
}

export async function POST(request: Request) {
  // Only Spotter's own pages may record events.
  if (!isSameOrigin(request)) {
    return Response.json({ error: "Forbidden" }, { status: 403, headers: NO_STORE });
  }

  // A development machine is not usage. The browser already drops these; this
  // catches anything that got past it.
  if (isLocalHost(request.headers.get("host"))) return nothing();

  // env comes from where this server runs, not from what the page says. Staging
  // is recorded as "preview", which the metric views leave out. Off Railway
  // there is nothing to tag it with, so there is nothing to record.
  const env = ENVIRONMENTS[process.env.RAILWAY_ENVIRONMENT_NAME ?? ""];
  if (!env) return nothing();

  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) return nothing(413);

  const gate = await requireUser();
  if (!gate.ok) return gate.response;
  const userId = gate.user.id;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return nothing(400);
  }

  const batch = parseBatch(body, new Date());
  if (!batch) return nothing(400);
  if (batch.events.length === 0) return nothing();

  try {
    await insertEvents(userId, { env, appVersion: batch.appVersion, sessionId: batch.sessionId }, batch.events);
  } catch (error) {
    console.error(`[Spotter] Could not record ${batch.events.length} analytics events (${(error as { code?: string }).code ?? "unknown"}).`);
    return nothing(502);
  }
  return nothing();
}
