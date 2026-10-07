import { requireApprovedUser } from "@/lib/server/auth";
import { takeToken, tooManyRequests } from "@/lib/server/rateLimit";
import { isSameOrigin } from "@/lib/server/request";
import { MISSING_KEY_MESSAGE } from "@/lib/messages";

/*
 * Mints a short-lived Deepgram token so the browser can open its own
 * transcription socket without ever seeing the real API key.
 *
 * WHY TEMPORARY TOKENS INSTEAD OF A SERVER-SIDE SOCKET PROXY
 * Browsers cannot set an Authorization header on a WebSocket, and the raw key
 * must never reach the browser. The two options were:
 *   1. Proxy the socket through this server. App Router route handlers cannot
 *      accept WebSocket upgrades, so that needs a custom Node server, adds a
 *      network hop to every audio chunk and every result, and adds a second
 *      socket that can die mid-game.
 *   2. Temporary tokens (chosen). This route calls Deepgram's POST /v1/auth/grant
 *      with the real key and hands the browser a JWT that expires after
 *      TOKEN_TTL_SECONDS. The browser connects straight to Deepgram with it.
 *      Deepgram checks the token only when the socket opens; an open socket
 *      stays up after the token expires, and every reconnect fetches a new one.
 *      https://developers.deepgram.com/guides/fundamentals/token-based-authentication
 *      https://developers.deepgram.com/reference/auth/tokens/grant
 */

const GRANT_URL = "https://api.deepgram.com/v1/auth/grant";
const TOKEN_TTL_SECONDS = 30;
const NO_STORE = { "Cache-Control": "no-store" };

type TokenErrorCode = "missing_key" | "invalid_key" | "forbidden" | "unavailable";

function fail(status: number, code: TokenErrorCode, error: string) {
  console.error(`[Spotter] ${error}`);
  return Response.json({ code, error }, { status, headers: NO_STORE });
}

export async function POST(request: Request) {
  // Only Spotter's own page may mint tokens, not other sites open in the browser.
  if (!isSameOrigin(request)) {
    return Response.json({ error: "Forbidden" }, { status: 403, headers: NO_STORE });
  }

  // Every token is Deepgram time, so only approved accounts get one.
  const gate = await requireApprovedUser();
  if (!gate.ok) return gate.response;
  if (!takeToken("deepgramToken", gate.user.id)) return tooManyRequests();

  const apiKey = process.env.DEEPGRAM_API_KEY?.trim();
  if (!apiKey) return fail(503, "missing_key", MISSING_KEY_MESSAGE);

  let grant: Response;
  try {
    grant = await fetch(GRANT_URL, {
      method: "POST",
      headers: { Authorization: `Token ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ttl_seconds: TOKEN_TTL_SECONDS }),
      cache: "no-store",
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return fail(502, "unavailable", `Could not reach Deepgram for a token: ${reason}`);
  }

  if (grant.status === 401) {
    return fail(401, "invalid_key", "Deepgram rejected the API key (401). Check DEEPGRAM_API_KEY in .env.local and restart.");
  }
  if (grant.status === 403) {
    return fail(403, "forbidden", "This Deepgram API key cannot create temporary tokens (403). Create a key with Member permission or higher.");
  }
  if (!grant.ok) {
    return fail(502, "unavailable", `Deepgram token request failed (HTTP ${grant.status}).`);
  }

  const { access_token } = (await grant.json()) as { access_token: string };
  return Response.json({ accessToken: access_token }, { headers: NO_STORE });
}
