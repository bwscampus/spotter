import { boothStart } from "@/lib/server/repo/booth";
import { failure, forUser, json, notFound, UUID } from "@/lib/server/route";

type Context = { params: Promise<{ gameId: string }> };

// POST: a guest's Start (Nov 15). His own row turns live; the host's turns
// live too if it was still a draft, which is the one time the game counts,
// against the host. A started game started again is the same game.
export function POST(request: Request, { params }: Context) {
  return forUser(request, async ({ user }) => {
    const { gameId } = await params;
    if (!UUID.test(gameId)) return notFound();
    const result = await boothStart(user.id, gameId);
    if (result.status === "ok") return json({ guestGameId: result.guestGameId });
    if (result.status === "teams") return failure(409, "teams_missing", "The host hasn't picked both teams yet.");
    return notFound();
  });
}
