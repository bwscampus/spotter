import { deleteDraft, updateDraft } from "@/lib/server/repo/games";
import { badRequest, forUser, json, notFound, readJson, UUID } from "@/lib/server/route";
import { isDraftBody } from "@/lib/server/validate";

type Context = { params: Promise<{ id: string }> };

// PATCH: changes a draft's date, sport, teams, what each side wears, or the
// share switch. Only this account's drafts; anything else is a 404.
export function PATCH(request: Request, { params }: Context) {
  return forUser(request, async ({ user }) => {
    const { id } = await params;
    if (!UUID.test(id)) return notFound();
    const read = await readJson(request, 4 * 1024);
    if (!read.ok) return read.response;
    if (!isDraftBody(read.body, "update")) return badRequest();
    if (!(await updateDraft(user.id, id, read.body))) return notFound();
    return json({ ok: true });
  });
}

// DELETE: deletes a draft that was never started.
export function DELETE(request: Request, { params }: Context) {
  return forUser(request, async ({ user }) => {
    const { id } = await params;
    if (!UUID.test(id) || !(await deleteDraft(user.id, id))) return notFound();
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  });
}
