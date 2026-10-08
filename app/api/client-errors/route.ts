import { appVersionOrUnknown } from "@/lib/analytics/events";
import { isLocalHost } from "@/lib/analytics/localHost";
import { cleanReport, MAX_REPORT_BYTES as MAX_BODY_BYTES } from "@/lib/errors/clean";
import { requireUser } from "@/lib/server/auth";
import { recordClientError } from "@/lib/server/repo/account";
import { forbidden, isSameOrigin, NO_STORE } from "@/lib/server/request";
import { readJsonBody } from "@/lib/usage/body";

// =============================================================================
// Receives one crash report from lib/errors/report.ts and writes it to
// public.client_errors through public.record_client_error(), which also keeps
// an account to 20 an hour (V3 audit H5).
//
// Signed-in accounts only: recording a crash costs nothing. The report is cut
// again here with the browser's own rules, so a page that sends more gets
// less. Like /api/events, nothing is recorded off production or from a
// development machine, and nothing the report carried is logged.
// =============================================================================

function nothing(status = 204) {
  return new Response(null, { status, headers: NO_STORE });
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return forbidden();
  if (isLocalHost(request.headers.get("host"))) return nothing();
  if (process.env.RAILWAY_ENVIRONMENT_NAME !== "production") return nothing();

  const gate = await requireUser();
  if (!gate.ok) return gate.response;

  const body = await readJsonBody(request, MAX_BODY_BYTES);
  if (body.kind === "too_large") return nothing(413);
  if (body.kind !== "ok" || typeof body.value !== "object" || body.value === null) return nothing(400);

  const report = cleanReport(body.value as Record<string, unknown>);
  try {
    await recordClientError(gate.user.id, appVersionOrUnknown(process.env.NEXT_PUBLIC_GIT_COMMIT), report);
  } catch (error) {
    console.error(`[Spotter] Could not record a client error (${(error as { code?: string }).code ?? "unknown"}).`);
    return nothing(502);
  }
  return nothing();
}
