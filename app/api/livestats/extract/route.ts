import { requireVerifiedUser } from "@/lib/server/auth";
import { isSameOrigin } from "@/lib/server/request";
import { gameTokens } from "@/lib/livestats/cost";
import { extractStatsPlaysOpenRouter, OPENROUTER_TIMEOUT_MS } from "@/lib/livestats/openrouter";
import { readRequest } from "@/lib/livestats/request";
import { NO_USAGE, type ExtractStatsResponse } from "@/lib/livestats/types";
import { extractFailure, type ExtractFailureCode } from "@/lib/rosters/extractErrors";
import { readJsonBody } from "@/lib/usage/body";
import { beginUsage, finishUsage, type UsageOutcome } from "@/lib/server/usage";

// One model call with a 25 second budget (OPENROUTER_TIMEOUT_MS), and the sign-in check before it.
export const maxDuration = 30;

const NO_STORE = { "Cache-Control": "no-store" };

/** Above this the body is not something the live loop sends. */
const MAX_BODY_BYTES = 256 * 1024;

/**
 * Reads the finished plays out of one window of play-by-play
 * (docs/V3_DEFINITION.md 8.1 and 8.2) and returns them with the call's token
 * usage. Applying them is the browser's job, through lib/livestats/apply.ts.
 *
 * The body is { utterances, rosters, recentPlays }: the window, both full
 * saved rosters (spotting-off players included, rule R9), and the summaries of
 * the last few applied plays.
 *
 * PRIVACY: the transcript names minors. Nothing in the request or the reply is
 * stored, and nothing from either is logged: a failure logs its code and HTTP
 * status and nothing else. Analytics are the browser's job; this route
 * records only the call's token counts and cost in public.usage (lib/usage/).
 */
export async function POST(request: Request) {
  // Only Spotter's own page may ask, not another site open in the browser.
  if (!isSameOrigin(request)) return fail("cross_origin");

  // Reading plays is paid model time: signed-in accounts only.
  const gate = await requireVerifiedUser();
  if (!gate.ok) return gate.response;

  // One read every few seconds, so many a day, and the dollar caps
  // (public.usage_begin). A refusal is a 429 the strip words as a pause.
  const usage = await beginUsage(gate.user.id, "livestats");
  if (!usage.ok) return usage.response;

  const outcome: UsageOutcome = { ok: false, provider: "openrouter" };
  try {
    const result = await read(request);
    if (result.reply) {
      outcome.ok = true;
      Object.assign(outcome, recorded(result.reply));
      return Response.json(result.reply, { headers: NO_STORE });
    }
    return fail(result.code);
  } finally {
    await finishUsage(gate.user.id, usage.ticket, outcome);
  }
}

type ReadResult = { reply: ExtractStatsResponse; code?: never } | { reply?: never; code: ExtractFailureCode };

async function read(request: Request): Promise<ReadResult> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) return { code: "missing_key" };

  // Counted as it arrives, so a body without a content-length is held to the same limit.
  const body = await readJsonBody(request, MAX_BODY_BYTES);
  if (body.kind !== "ok") return { code: "bad_play_request" };

  const parsed = readRequest(body.value);
  if (parsed === "too_long") return { code: "play_window_too_long" };
  if (parsed === null) return { code: "bad_play_request" };

  if (parsed.utterances.length === 0 || parsed.rosters.length === 0) {
    return { reply: { plays: [], usage: NO_USAGE } };
  }

  try {
    const reply = await extractStatsPlaysOpenRouter(apiKey, parsed, AbortSignal.timeout(OPENROUTER_TIMEOUT_MS));
    return { reply };
  } catch (error) {
    const code = error instanceof Error && "code" in error ? (error as { code: ExtractFailureCode }).code : "unknown";
    return { code };
  }
}

/** The ledger's numbers for one read: lib/livestats/cost.ts's own tokens and dollars (OpenRouter's charged cost when it sent one). */
function recorded(reply: ExtractStatsResponse): Partial<UsageOutcome> {
  const tokens = gameTokens(reply.usage);
  return {
    inputTokens: tokens.tokens_in,
    outputTokens: tokens.tokens_out,
    cachedTokens: tokens.tokens_cached,
    costUsd: reply.usage.costUsd,
  };
}

function fail(code: ExtractFailureCode) {
  const failure = extractFailure(code);
  // The code and the status only. Never the request or the reply.
  console.error(`[Spotter] Live stats rejected at the "${failure.code}" check (HTTP ${failure.status}).`);
  return Response.json({ error: failure.message, code: failure.code }, { status: failure.status, headers: NO_STORE });
}
