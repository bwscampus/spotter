import { announceMembers } from "@/lib/server/boothAnnounce";
import { publish } from "@/lib/server/boothBus";
import { forgetRole } from "@/lib/server/boothRoles";
import { removeGuest } from "@/lib/server/repo/booth";
import { forUser, notFound, UUID } from "@/lib/server/route";

type Context = { params: Promise<{ gameId: string; slot: string }> };

// DELETE: the host takes a guest out of the booth (Nov 15). The guest's screen
// hears "removed" and carries on alone; he cannot come back by the code or
// the link, and a draft of his for this game is deleted. Host only.
export function DELETE(request: Request, { params }: Context) {
  return forUser(request, async ({ user }) => {
    const { gameId, slot } = await params;
    const which = Number(slot);
    if (!UUID.test(gameId) || (which !== 1 && which !== 2)) return notFound();
    if (!(await removeGuest(user.id, gameId, which))) return notFound();
    forgetRole(gameId);
    publish(gameId, { type: "removed" }, { to: which });
    await announceMembers(gameId);
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  });
}
