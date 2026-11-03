import { deleteRoster, getRoster } from "@/lib/server/repo/rosters";
import { forUser, json, notFound, UUID } from "@/lib/server/route";

type Context = { params: Promise<{ id: string }> };

// GET: one of this account's teams with its players, as the team page loads it.
// The team page reads it when a new team matches one already saved, so the
// saved players' pronunciations, heard-as forms, storylines and spotting carry
// over instead of being wiped (audit, Nov 1). Another account's id is a 404.
export function GET(request: Request, { params }: Context) {
  return forUser(request, async ({ user }) => {
    const { id } = await params;
    if (!UUID.test(id)) return notFound();
    const roster = await getRoster(user.id, id);
    return roster ? json(roster) : notFound();
  });
}

// DELETE: removes a team and its players. Its past games keep their school names.
export function DELETE(request: Request, { params }: Context) {
  return forUser(request, async ({ user }) => {
    const { id } = await params;
    if (!UUID.test(id) || !(await deleteRoster(user.id, id))) return notFound();
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  });
}
