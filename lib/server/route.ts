import { randomUUID } from "node:crypto";
import { requireUser, type Allowed } from "./auth";
import { forbidden, isSameOrigin, NO_STORE } from "./request";

// Shared by the data routes: who is asking, a capped JSON body, and errors that
// say nothing about the server (Production Standard API-2, API-3, API-6).

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: NO_STORE });
}

export function failure(status: number, code: string, error: string): Response {
  return json({ code, error }, status);
}

export const notFound = () => failure(404, "not_found", "Not found.");
export const badRequest = (error = "That request was not valid.") => failure(400, "bad_request", error);

/** Postgres errors a request can cause, as the announcer should read them. */
function userFacing(err: unknown): Response | null {
  const { code, message } = (err ?? {}) as { code?: string; message?: string };
  // save_roster and set_season_stats raise sentences written for the announcer.
  if (code === "P0001" && typeof message === "string") return failure(400, "refused", message);
  // A check constraint or a foreign key (another owner's id) the input broke.
  if (code === "23514" || code === "23502" || code === "22P02" || code === "22007" || code === "22008") return badRequest();
  if (code === "23503") return notFound();
  return null;
}

/**
 * Runs a data route for a signed-in account. State-changing methods must come
 * from Spotter's own pages. Anything unexpected is a generic 500, logged with a
 * request id and the error code only, never the body or the message.
 */
export async function forUser(request: Request, handle: (gate: Allowed) => Promise<Response>): Promise<Response> {
  if (request.method !== "GET" && !isSameOrigin(request)) return forbidden();
  const gate = await requireUser();
  if (!gate.ok) return gate.response;
  try {
    return await handle(gate);
  } catch (err) {
    const known = userFacing(err);
    if (known) return known;
    const requestId = randomUUID();
    console.error(`[Spotter] ${request.method} ${new URL(request.url).pathname} failed (${(err as { code?: string })?.code ?? "unknown"}) request=${requestId}`);
    return json({ code: "server_error", error: "Something went wrong. Try again.", requestId }, 500);
  }
}

/** The body as JSON, refused past `maxBytes` (read, not trusted from Content-Length). */
export async function readJson(request: Request, maxBytes: number): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  const text = await request.text();
  if (Buffer.byteLength(text) > maxBytes) return { ok: false, response: failure(413, "payload_too_large", "That is too large to save.") };
  try {
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false, response: badRequest() };
  }
}
