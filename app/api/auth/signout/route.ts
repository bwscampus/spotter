import { forbidden, isSameOrigin, NO_STORE } from "@/lib/server/request";
import { endAllSessions, endSession } from "@/lib/server/session";
import { requireUser } from "@/lib/server/auth";

// Signs this browser out (POST), or every browser with ?everywhere=1. Either way
// the session rows are deleted, so the old cookie is worthless (AUTH-4).

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return forbidden();
  if (new URL(request.url).searchParams.get("everywhere") === "1") {
    const gate = await requireUser();
    if (!gate.ok) return gate.response;
    await endAllSessions(gate.user.id);
  }
  await endSession();
  return Response.json({ ok: true }, { headers: NO_STORE });
}
