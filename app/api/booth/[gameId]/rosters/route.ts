import { getBoothRosters } from "@/lib/server/repo/booth";
import { forUser, json, notFound, UUID } from "@/lib/server/route";

type Context = { params: Promise<{ gameId: string }> };

// GET: the host's two teams for this booth game, for a guest (Nov 15), in the
// shape GET /api/rosters/game answers, so lib/game/buildGame.ts builds his
// game exactly as the host's. Read live, so the host's fixes reach him; only
// while he is an active guest and the game is a draft or live. Nothing here
// lets him write them: every write route is still scoped to its owner.
export function GET(request: Request, { params }: Context) {
  return forUser(request, async ({ user }) => {
    const { gameId } = await params;
    if (!UUID.test(gameId)) return notFound();
    const read = await getBoothRosters(user.id, gameId);
    return read ? json(read) : notFound();
  });
}
