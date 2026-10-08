import { deleteGame, endGame } from "@/lib/server/repo/games";
import { badRequest, forUser, json, notFound, readJson, UUID } from "@/lib/server/route";
import { isEndedGameBody } from "@/lib/server/validate";

type Context = { params: Promise<{ id: string }> };

// PATCH: End game's counts (lib/game/calledGames.ts endGame). Counts only.
export function PATCH(request: Request, { params }: Context) {
  return forUser(request, async ({ user }) => {
    const { id } = await params;
    if (!UUID.test(id)) return notFound();
    const read = await readJson(request, 8 * 1024);
    if (!read.ok) return read.response;
    if (!isEndedGameBody(read.body)) return badRequest();
    if (!(await endGame(user.id, id, read.body))) return notFound();
    return json({ ok: true });
  });
}

// DELETE: removes a game from Past games, and its feedback by cascade.
export function DELETE(request: Request, { params }: Context) {
  return forUser(request, async ({ user }) => {
    const { id } = await params;
    if (!UUID.test(id) || !(await deleteGame(user.id, id))) return notFound();
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  });
}
