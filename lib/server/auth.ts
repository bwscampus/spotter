import { cache } from "react";
import { WAITING_NOTE, type Approval } from "@/lib/auth/approval";
import { NO_STORE } from "./request";
import { readSession, type SessionUser } from "./session";

// Who is asking, and what they may do. Identity always comes from the session
// cookie, never from the request body (Production Standard API-1).

export type GateCode = "signed_out" | "not_approved" | "approval_unavailable";
export type Refusal = { ok: false; response: Response };
export type Allowed = { ok: true; user: SessionUser };

function refuse(status: number, code: GateCode | "not_found", error: string): Refusal {
  return { ok: false, response: Response.json({ code, error }, { status, headers: NO_STORE }) };
}

/** The session, or "unknown" when the database could not be asked. */
async function sessionOrUnknown(): Promise<SessionUser | null | "unknown"> {
  try {
    return await readSession();
  } catch {
    return "unknown";
  }
}

/** Where the account stands, for pages. Read once per request. */
export const getViewer = cache(async (): Promise<Approval & { user?: SessionUser }> => {
  const session = await sessionOrUnknown();
  if (session === "unknown") return { status: "unknown" };
  if (!session) return { status: "signed_out" };
  return { status: session.approved ? "approved" : "waiting", userId: session.id, user: session };
});

/** Any signed-in account, approved or not. */
export async function requireUser(): Promise<Allowed | Refusal> {
  const session = await sessionOrUnknown();
  if (session === "unknown") {
    return refuse(503, "approval_unavailable", "Could not check your account just now. Try again in a moment.");
  }
  if (!session) return refuse(401, "signed_out", "Sign in first.");
  return { ok: true, user: session };
}

/**
 * The gate in front of everything that spends money. Every route that calls
 * Anthropic or Deepgram runs this first and returns its response when it says
 * no (docs/V3_DEFINITION.md section 5). It fails closed: a database outage is
 * 503 approval_unavailable, which DeepgramStream retries with backoff.
 */
export async function requireApprovedUser(): Promise<Allowed | Refusal> {
  const gate = await requireUser();
  if (!gate.ok) return gate;
  if (!gate.user.approved) return refuse(403, "not_approved", WAITING_NOTE);
  return gate;
}

/** Admin pages and routes. A non-admin gets 404, so the page does not admit it exists. */
export async function requireAdmin(): Promise<Allowed | Refusal> {
  const gate = await requireUser();
  if (!gate.ok) return gate;
  if (!gate.user.isAdmin) return refuse(404, "not_found", "Not found.");
  return gate;
}
