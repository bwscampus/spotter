import { isSport } from "@/lib/rosters/types";
import { MAX_PIECE_CHARS, readPiece } from "@/lib/log/sharedLogWire";
import { shareGameLogPiece } from "@/lib/server/repo/account";
import { forUser, failure } from "@/lib/server/route";
import { collectsLogs, notCollected, shareResponse } from "@/lib/server/sharedLogRoutes";
import { readJsonBody } from "@/lib/usage/body";

// POST: one piece of a game's scrubbed log, sent as the game goes while the
// "Share game log" switch is on (lib/log/sharePieces.ts; scrubbing is
// lib/log/scrub.ts). Stored by public.share_game_log_piece(), which makes the
// share on its first piece, refuses another account's share id as a 404, and
// holds an account to 20 shares a day and a share to 300 pieces and 60 million
// characters. Sending a part again replaces it. Only production keeps them.

/** A piece's log, its numbers and a small header, as JSON. */
const MAX_BODY_BYTES = MAX_PIECE_CHARS + 16_384;

export function POST(request: Request) {
  return forUser(request, async ({ user }) => {
    if (!collectsLogs()) return notCollected();
    const body = await readJsonBody(request, MAX_BODY_BYTES);
    if (body.kind === "too_large") return failure(413, "too_large", "That game log is too large to share.");
    const piece = body.kind === "ok" ? readPiece(body.value, isSport) : null;
    if (piece === null) return failure(400, "bad_request", "That game log could not be read.");
    return shareResponse(await shareGameLogPiece(user.id, piece), true);
  });
}
