import { deleteRoster } from "@/lib/server/repo/rosters";
import { forUser, notFound, UUID } from "@/lib/server/route";

type Context = { params: Promise<{ id: string }> };

// DELETE: removes a team and its players. Its past games keep their school names.
export function DELETE(request: Request, { params }: Context) {
  return forUser(request, async ({ user }) => {
    const { id } = await params;
    if (!UUID.test(id) || !(await deleteRoster(user.id, id))) return notFound();
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  });
}
