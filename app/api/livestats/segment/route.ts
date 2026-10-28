import { requireVerifiedUser } from "@/lib/server/auth";
import { isSameOrigin } from "@/lib/server/request";
import { readSegmentRequest } from "@/lib/livestats/extract/request";
import type { SegmentReply } from "@/lib/livestats/extract/run";
import { extractSegmentOpenRouter } from "@/lib/livestats/openrouter";
import { liveStatsPipeline } from "@/lib/livestats/settings";
import { extractFailure, type ExtractFailureCode } from "@/lib/rosters/extractErrors";
import { readJsonBody } from "@/lib/usage/body";
import { beginUsage, finishUsage, type UsageOutcome } from "@/lib/server/usage";

// Two readers in parallel (12 s each) and a tie-break (12 s), with a retry inside each, and the sign-in check before them.
export const maxDuration = 45;

const NO_STORE = { "Cache-Control": "no-store" };

/** A segment is one play with a few lines each side and at most nine candidates. */
const MAX_BODY_BYTES = 64 * 1024;

/**
 * v7 (Oct 20, docs/LIVE_STATS_V7.md): reads one play's segment with reader A,
 * reader B and the tie-break (lib/livestats/reconcile.ts) and returns the
 * answer, how the readers agreed, and each call's usage. The body is
 * lib/livestats/extract/request.ts's SegmentRequest; applying the answer is
 * the browser's job (lib/livestats/v7.ts).
 *
 * PRIVACY: the lines name minors. Nothing in the request or the reply is
 * stored, and nothing from either is logged: a failure logs its code and HTTP
 * status and nothing else. Every call goes to providers that keep nothing
 * (lib/ai/openrouter.ts), and a reader with no such endpoint is never called.
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return fail("cross_origin");

  const gate = await requireVerifiedUser();
  if (!gate.ok) return gate.response;

  // Only a server running v7 reads segments (Oct 28, with live stats back on
  // main): under v6 the browser never asks, and v7's readers (Claude Haiku and
  // GPT-6 Luna by default) are not the models /privacy names for v6. Before the
  // spend guard, so a refusal costs nothing.
  if (liveStatsPipeline() !== "v7") return Response.json({ error: "Not found." }, { status: 404, headers: NO_STORE });

  // The same ledger and the same caps as the per-window reads.
  const usage = await beginUsage(gate.user.id, "livestats");
  if (!usage.ok) return usage.response;

  const outcome: UsageOutcome = { ok: false, provider: "openrouter" };
  try {
    const result = await read(request);
    if (result.reply) {
      if (result.reply.ok) {
        outcome.ok = true;
        Object.assign(outcome, recorded(result.reply));
        // Each reader's own answer is the replay harness's; the browser is sent the reconciled one only.
        return Response.json({ ...result.reply, answers: undefined }, { headers: NO_STORE });
      }
      return Response.json(result.reply, { headers: NO_STORE });
    }
    return fail(result.code);
  } finally {
    await finishUsage(gate.user.id, usage.ticket, outcome);
  }
}

type ReadResult = { reply: SegmentReply; code?: never } | { reply?: never; code: ExtractFailureCode };

async function read(request: Request): Promise<ReadResult> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) return { code: "missing_key" };

  const body = await readJsonBody(request, MAX_BODY_BYTES);
  if (body.kind !== "ok") return { code: "bad_play_request" };

  const parsed = readSegmentRequest(body.value);
  if (parsed === null) return { code: "bad_play_request" };

  return { reply: await extractSegmentOpenRouter(apiKey, parsed) };
}

/** The ledger's numbers for one segment: every reader's tokens and dollars added up. */
function recorded(reply: Extract<SegmentReply, { ok: true }>): Partial<UsageOutcome> {
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedTokens = 0;
  let costUsd = 0;
  for (const call of reply.calls) {
    inputTokens += call.promptTokens + call.cachedTokens + call.cacheWriteTokens;
    outputTokens += call.completionTokens;
    cachedTokens += call.cachedTokens;
    costUsd += call.costUsd;
  }
  return { inputTokens, outputTokens, cachedTokens, costUsd: Math.round(costUsd * 1e6) / 1e6 };
}

function fail(code: ExtractFailureCode) {
  const failure = extractFailure(code);
  // The code and the status only. Never the request or the reply.
  console.error(`[Spotter] Live stats segment rejected at the "${failure.code}" check (HTTP ${failure.status}).`);
  return Response.json({ error: failure.message, code: failure.code }, { status: failure.status, headers: NO_STORE });
}
