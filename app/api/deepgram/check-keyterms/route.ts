import { requireVerifiedUser } from "@/lib/server/auth";
import { isSameOrigin } from "@/lib/server/request";
import { buildKeytermCheckUrl } from "@/lib/deepgram/config";
import { silentWav } from "@/lib/deepgram/silentWav";
import { MISSING_KEY_MESSAGE } from "@/lib/messages";
import { readJsonBody } from "@/lib/usage/body";
import { beginUsage, finishUsage } from "@/lib/server/usage";

// =============================================================================
// Deepgram caps keyterms at 500 tokens across the whole request, and a
// websocket rejected at connect time gives the browser nothing useful to show.
// So the game setup screen asks here first, using one second of silence.
//
// With `fit: true` and a list that is too long, it also finds how much of the
// front of the list Deepgram does take, so the most called players keep the
// boost (lib/game/keytermBudget.ts orders the list). Deepgram counts its own
// tokens, so the answer comes from asking it, halving the gap each time.
// =============================================================================

/** Deepgram's documented cap is per-term; anything longer is a mistake upstream. */
const MAX_TERM_LENGTH = 100;

/** Far past what any two rosters produce, and short enough to keep the URL sane. */
const MAX_TERMS = 500;

/** Deepgram calls spent finding what fits. 9 settles any list up to 500 exactly. */
export const MAX_FIT_PROBES = 9;

/** Far past MAX_TERMS terms of MAX_TERM_LENGTH characters, quoted. */
const MAX_BODY_BYTES = 128 * 1024;

export const maxDuration = 30;

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return Response.json({ error: "Forbidden" }, { status: 403, headers: NO_STORE });
  }

  // The check is a real (one second) Deepgram request, so it is paid for too.
  const gate = await requireVerifiedUser();
  if (!gate.ok) return gate.response;

  // A few checks a game at most (public.usage_begin). A refusal leaves the
  // names unchecked, which never blocks Start.
  const usage = await beginUsage(gate.user.id, "deepgram_keyterms");
  if (!usage.ok) return usage.response;

  const response = await check(request);
  // Deepgram time is limited by count, not dollars: recorded at $0.
  await finishUsage(gate.user.id, usage.ticket, { ok: response.ok, provider: "deepgram" });
  return response;
}

async function check(request: Request): Promise<Response> {
  const apiKey = process.env.DEEPGRAM_API_KEY?.trim();
  if (!apiKey) {
    return Response.json({ error: MISSING_KEY_MESSAGE }, { status: 503, headers: NO_STORE });
  }

  const read = await readJsonBody(request, MAX_BODY_BYTES);
  if (read.kind === "too_large") {
    return Response.json({ error: "Too many names to check at once." }, { status: 413, headers: NO_STORE });
  }

  let keyterms: string[];
  let fit = false;
  try {
    if (read.kind !== "ok") throw new Error("unreadable");
    const body = read.value as { keyterms?: unknown; fit?: unknown } | null;
    keyterms = Array.isArray(body?.keyterms) ? body.keyterms : [];
    fit = body?.fit === true;
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

  const whole = await probe(keyterms, apiKey);
  if (whole.kind === "ok") return Response.json({ ok: true }, { headers: NO_STORE });
  if (whole.kind === "unreachable") {
    return Response.json({ error: "Could not reach Deepgram to check the names." }, { status: 502, headers: NO_STORE });
  }
  if (whole.kind === "failed") {
    console.error(`[Spotter] Deepgram keyterm check failed (HTTP ${whole.status}).`);
    return Response.json(
      { error: `Deepgram could not check the names (HTTP ${whole.status}).` },
      { status: 502, headers: NO_STORE },
    );
  }
  if (!fit) return Response.json({ ok: false, reason: whole.reason }, { headers: NO_STORE });
  return Response.json({ ok: false, reason: whole.reason, fits: await longestAccepted(keyterms, apiKey) }, { headers: NO_STORE });
}

type Probe =
  | { kind: "ok" }
  | { kind: "too_many"; reason: string }
  | { kind: "unreachable" }
  | { kind: "failed"; status: number };

/** One second of silence through Deepgram with these keyterms. */
async function probe(keyterms: string[], apiKey: string): Promise<Probe> {
  let response: Response;
  try {
    response = await fetch(buildKeytermCheckUrl(keyterms), {
      method: "POST",
      headers: { Authorization: `Token ${apiKey}`, "Content-Type": "audio/wav" },
      // .buffer, because fetch's body type does not accept a typed array here.
      body: silentWav().buffer as ArrayBuffer,
    });
  } catch {
    return { kind: "unreachable" };
  }
  if (response.ok) return { kind: "ok" };
  const body = await response.text().catch(() => "");
  if (response.status === 400 && /keyterm/i.test(body)) return { kind: "too_many", reason: readReason(body) };
  return { kind: "failed", status: response.status };
}

/**
 * How many keyterms from the front of a list Deepgram takes, when it refused
 * the whole list. Only ever a count Deepgram said yes to: a probe that cannot
 * get an answer stops the search at what is already known to fit.
 */
async function longestAccepted(keyterms: string[], apiKey: string): Promise<number> {
  let fits = 0;
  let refused = keyterms.length;
  for (let probes = 0; probes < MAX_FIT_PROBES && refused - fits > 1; probes++) {
    const middle = Math.floor((fits + refused) / 2);
    const answer = await probe(keyterms.slice(0, middle), apiKey);
    if (answer.kind === "ok") fits = middle;
    else if (answer.kind === "too_many") refused = middle;
    else break;
  }
  return fits;
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
