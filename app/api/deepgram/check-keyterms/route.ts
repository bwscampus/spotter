import { requireApprovedUser } from "@/lib/server/auth";
import { takeToken, tooManyRequests } from "@/lib/server/rateLimit";
import { isSameOrigin } from "@/lib/server/request";
import { buildKeytermCheckUrl } from "@/lib/deepgram/config";
import { silentWav } from "@/lib/deepgram/silentWav";
import { MISSING_KEY_MESSAGE } from "@/lib/messages";

// =============================================================================
// Deepgram caps keyterms at 500 tokens across the whole request, and a
// websocket rejected at connect time gives the browser nothing useful to show.
// So the game setup screen asks here first, using one second of silence.
// =============================================================================

/** Deepgram's documented cap is per-term; anything longer is a mistake upstream. */
const MAX_TERM_LENGTH = 100;

/** Far past what any two rosters produce, and short enough to keep the URL sane. */
const MAX_TERMS = 500;

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return Response.json({ error: "Forbidden" }, { status: 403, headers: NO_STORE });
  }

  // The check is a real (one second) Deepgram request, so it is paid for too.
  const gate = await requireApprovedUser();
  if (!gate.ok) return gate.response;
  if (!takeToken("keytermCheck", gate.user.id)) return tooManyRequests();

  const apiKey = process.env.DEEPGRAM_API_KEY?.trim();
  if (!apiKey) {
    return Response.json({ error: MISSING_KEY_MESSAGE }, { status: 503, headers: NO_STORE });
  }

  let keyterms: string[];
  try {
    const body = await request.json();
    keyterms = Array.isArray(body?.keyterms) ? body.keyterms : [];
    if (!keyterms.every((term) => typeof term === "string")) throw new Error("not strings");
  } catch {
    return Response.json({ error: "Send a list of keyterms." }, { status: 400, headers: NO_STORE });
  }

  keyterms = keyterms.map((term) => term.trim()).filter((term) => term.length > 0);
  if (keyterms.length === 0) {
    // Nothing to check: no keyterms is always accepted.
    return Response.json({ ok: true }, { headers: NO_STORE });
  }
  if (keyterms.length > MAX_TERMS || keyterms.some((term) => term.length > MAX_TERM_LENGTH)) {
    return Response.json(
      { ok: false, reason: `Too many names, or a name longer than ${MAX_TERM_LENGTH} characters.` },
      { headers: NO_STORE },
    );
  }

  let response: Response;
  try {
    response = await fetch(buildKeytermCheckUrl(keyterms), {
      method: "POST",
      headers: { Authorization: `Token ${apiKey}`, "Content-Type": "audio/wav" },
      // .buffer, because fetch's body type does not accept a typed array here.
      body: silentWav().buffer as ArrayBuffer,
    });
  } catch {
    return Response.json({ error: "Could not reach Deepgram to check the names." }, { status: 502, headers: NO_STORE });
  }

  if (response.ok) {
    return Response.json({ ok: true }, { headers: NO_STORE });
  }

  const body = await response.text().catch(() => "");
  if (response.status === 400 && /keyterm/i.test(body)) {
    return Response.json({ ok: false, reason: readReason(body) }, { headers: NO_STORE });
  }

  console.error(`[Spotter] Deepgram keyterm check failed (HTTP ${response.status}).`);
  return Response.json(
    { error: `Deepgram could not check the names (HTTP ${response.status}).` },
    { status: 502, headers: NO_STORE },
  );
}

/** Deepgram puts the useful sentence in err_msg. Truncated, and never the key. */
function readReason(body: string): string {
  let message = body;
  try {
    const parsed = JSON.parse(body);
    message = [parsed?.err_msg, parsed?.err_code, parsed?.reason].find((part) => typeof part === "string") ?? body;
  } catch {
    // Not JSON: use the raw text.
  }
  return message.slice(0, 200);
}
