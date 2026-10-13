import { flatValues, readShareId } from "@/lib/log/sharedLogWire";
import { finishSharedLog } from "@/lib/server/repo/account";
import { badRequest, forUser, notFound, readJson } from "@/lib/server/route";
import { collectsLogs, notCollected, shareResponse } from "@/lib/server/sharedLogRoutes";

type Context = { params: Promise<{ shareId: string }> };

// POST: End game reached this share. Marks it complete and keeps the game's
// counts (the numbers game.ended carries; lib/game/liveCounts.ts), so a share
// that never completes reads as a closed tab or a crash. Another account's
// share, or one that is not there, is a 404. Only production keeps it.
export function POST(request: Request, { params }: Context) {
  return forUser(request, async ({ user }) => {
    if (!collectsLogs()) return notCollected();
    const shareId = readShareId((await params).shareId);
    if (shareId === null) return notFound();
    const read = await readJson(request, 16 * 1024);
    if (!read.ok) return read.response;
    const raw = (read.body as { counts?: unknown } | null)?.counts ?? null;
    const counts = raw === null ? null : flatValues(raw);
    if (raw !== null && counts === null) return badRequest();
    return shareResponse(await finishSharedLog(user.id, shareId, counts));
  });
}
