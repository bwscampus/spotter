import { isBlocker, RATING_MAX, RATING_MIN } from "@/lib/game/feedback";
import { readShareId } from "@/lib/log/sharedLogWire";
import { rateSharedLog } from "@/lib/server/repo/account";
import { badRequest, forUser, notFound, readJson } from "@/lib/server/route";
import { collectsLogs, notCollected, shareResponse } from "@/lib/server/sharedLogRoutes";

type Context = { params: Promise<{ shareId: string }> };

// PUT: the end-of-game card's rating and chips, laid on this game's shared log
// so a log can be read beside how the announcer said it went. Never the note,
// the one place a player's name could be typed: it is not read here. Another
// account's share, or one that is not there, is a 404. Only production keeps it.
export function PUT(request: Request, { params }: Context) {
  return forUser(request, async ({ user }) => {
    if (!collectsLogs()) return notCollected();
    const shareId = readShareId((await params).shareId);
    if (shareId === null) return notFound();
    const read = await readJson(request, 4 * 1024);
    if (!read.ok) return read.response;
    const body = (read.body ?? {}) as { rating?: unknown; blockers?: unknown };
    const rating = body.rating;
    if (typeof rating !== "number" || !Number.isInteger(rating) || rating < RATING_MIN || rating > RATING_MAX) return badRequest();
    if (!Array.isArray(body.blockers) || !body.blockers.every(isBlocker)) return badRequest();
    return shareResponse(await rateSharedLog(user.id, shareId, rating, [...new Set(body.blockers)]));
  });
}
