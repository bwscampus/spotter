import {
  accountRefusalResponse,
  limitResponse,
  readBeginReply,
  usageUnavailableResponse,
  type UsageRoute,
} from "@/lib/usage/limits";
import { queryOne } from "./db";

// =============================================================================
// The spend guard every paid route runs right after its sign-in check. V3's
// lib/usage/server.ts, calling the same database functions with the owner
// passed explicitly (db/migrations: public.usage_begin(p_owner, p_route) and
// public.usage_finish(p_owner, ...)) instead of through a Supabase session:
//
//   const usage = await beginUsage(gate.user.id, "livestats");
//   if (!usage.ok) return usage.response;
//   ... the paid call ...
//   await finishUsage(gate.user.id, usage.ticket, { ok, provider, ...tokens });
//
// The limits and caps are usage_begin's TUNING block. Logs carry codes only,
// never anything from the request.
// =============================================================================

/**
 * When usage_begin itself cannot be reached (the database is down, a timeout),
 * most routes fail closed: no check, no paid call. A Deepgram token is the
 * exception and fails open. The live screen asks for a token on every
 * reconnect, so failing closed would turn a database blip into cards that stop
 * mid-game; and a token is already behind the sign-in check.
 */
const FAIL_OPEN: ReadonlySet<UsageRoute> = new Set<UsageRoute>(["deepgram_token"]);

/** A reservation to finish. Null when a fail-open route went ahead unrecorded. */
export type UsageTicket = { id: string; nonce: string; route: UsageRoute; startedAt: number } | null;

export type UsageStart = { ok: true; ticket: UsageTicket } | { ok: false; response: Response };

export async function beginUsage(ownerId: string, route: UsageRoute, now: () => number = Date.now): Promise<UsageStart> {
  let reply;
  try {
    const row = await queryOne<{ reply: unknown }>("select public.usage_begin($1, $2) as reply", [ownerId, route]);
    reply = readBeginReply(row?.reply ?? null, null);
  } catch {
    reply = readBeginReply(null, "threw");
  }

  switch (reply.kind) {
    case "ok":
      return { ok: true, ticket: { id: reply.id, nonce: reply.nonce, route, startedAt: now() } };
    case "limited":
      console.info(`[Spotter] ${route} refused by the usage check: ${reply.code}.`);
      return { ok: false, response: limitResponse(reply.code, reply.retryAfterS) };
    case "refused":
      return { ok: false, response: accountRefusalResponse(reply.code) };
    case "unavailable":
      if (FAIL_OPEN.has(route)) {
        console.error(`[Spotter] Usage check unavailable; ${route} allowed without it.`);
        return { ok: true, ticket: null };
      }
      console.error(`[Spotter] Usage check unavailable; ${route} refused.`);
      return { ok: false, response: usageUnavailableResponse() };
  }
}

/** How a reserved call went. Counts and dollars only. */
export interface UsageOutcome {
  ok: boolean;
  /** "anthropic", "openrouter" or "deepgram". */
  provider: string | null;
  /** Every input token, cached or not. */
  inputTokens?: number;
  outputTokens?: number;
  /** The part of inputTokens read from a cache. */
  cachedTokens?: number;
  costUsd?: number;
}

/**
 * Records how the call went on its reservation. Never throws and never fails
 * the route: the call has already happened, and the row keeps counting
 * towards the rate limits even if this write is lost.
 */
export async function finishUsage(ownerId: string, ticket: UsageTicket, outcome: UsageOutcome, now: () => number = Date.now): Promise<void> {
  if (!ticket) return;
  try {
    await queryOne("select public.usage_finish($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)", [
      ownerId,
      ticket.id,
      ticket.nonce,
      outcome.ok,
      outcome.provider ?? "",
      whole(outcome.inputTokens),
      whole(outcome.outputTokens),
      whole(outcome.cachedTokens),
      dollars(outcome.costUsd),
      whole(now() - ticket.startedAt),
    ]);
  } catch (err) {
    console.error(`[Spotter] Could not record ${ticket.route} usage (${(err as { code?: string })?.code ?? "threw"}).`);
  }
}

/** Postgres int: whole, not negative, under 2^31. */
function whole(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 0;
  return Math.min(2_147_483_647, Math.round(value));
}

function dollars(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value * 1e5) / 1e5;
}
