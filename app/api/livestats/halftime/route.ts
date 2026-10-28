import { requireVerifiedUser } from "@/lib/server/auth";
import { isSameOrigin } from "@/lib/server/request";
import { gameTokens } from "@/lib/livestats/cost";
import { HALFTIME_TIMEOUT_MS } from "@/lib/livestats/halftime";
import { extractHalftimeOpenRouter } from "@/lib/livestats/openrouter";
import { readRequest } from "@/lib/livestats/request";
import { HALFTIME_SETTING, readByOf } from "@/lib/livestats/settings";
import { NO_USAGE, type ExtractStatsResponse } from "@/lib/livestats/types";
import { extractFailure, type ExtractFailureCode } from "@/lib/rosters/extractErrors";
import { readJsonBody } from "@/lib/usage/body";
import { beginUsage, finishUsage, type UsageOutcome } from "@/lib/server/usage";

// One model call with a 90 second budget (HALFTIME_TIMEOUT_MS), and the sign-in check before it.
export const maxDuration = 100;

const NO_STORE = { "Cache-Control": "no-store" };

/** A whole first half of transcript, both rosters and every play counted: a few hundred kilobytes at most. */
const MAX_BODY_BYTES = 1024 * 1024;

/**
 * The halftime checkup (Oct 11, Part 8; docs/V3_DEFINITION.md 8): reads the
 * whole first half again with Claude Sonnet 5.5 and returns corrections only,
 * in the same shape as POST /api/livestats/extract. Applying them is the
 * browser's job. The body is the same as the extract route's, with look set
 * to "halftime"; anything else is a bad request.
 *
 * PRIVACY: the transcript names minors. Nothing in the request or the reply is
 * stored, and nothing from either is logged: a failure logs its code and HTTP
 * status and nothing else. The same zero-retention routing as every call; if
 * no such provider serves the model, the call fails closed.
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return fail("cross_origin");

  const gate = await requireVerifiedUser();
  if (!gate.ok) return gate.response;

  // The same ledger and the same caps as the per-window reads.
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

  const body = await readJsonBody(request, MAX_BODY_BYTES);
  if (body.kind !== "ok") return { code: "bad_play_request" };

  const parsed = readRequest(body.value);
  if (parsed === "too_long") return { code: "play_window_too_long" };
  if (parsed === null || parsed.look !== "halftime") return { code: "bad_play_request" };

  if (parsed.utterances.length === 0 || parsed.rosters.length === 0) {
    return { reply: { plays: [], usage: NO_USAGE } };
  }

  try {
    const reply = await extractHalftimeOpenRouter(apiKey, parsed, AbortSignal.timeout(HALFTIME_TIMEOUT_MS));
    // Which model read it (Oct 26), for the browser log.
    return { reply: { ...reply, readBy: readByOf(HALFTIME_SETTING) } };
  } catch (error) {
    const code = error instanceof Error && "code" in error ? (error as { code: ExtractFailureCode }).code : "unknown";
    return { code };
  }
}

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
  console.error(`[Spotter] Halftime check rejected at the "${failure.code}" check (HTTP ${failure.status}).`);
  return Response.json({ error: failure.message, code: failure.code }, { status: failure.status, headers: NO_STORE });
}
