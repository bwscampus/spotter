import { leaveHost, removePartner, setPartnerAutoAdd } from "@/lib/server/repo/booth";
import { badRequest, forUser, json, notFound, readJson, UUID } from "@/lib/server/route";

type Context = { params: Promise<{ id: string }> };

// DELETE: the host removes a saved partner, or (?as=partner) the partner stops
// being one. Games already made keep their guests until the host takes them out.
export function DELETE(request: Request, { params }: Context) {
  return forUser(request, async ({ user }) => {
    const { id } = await params;
    if (!UUID.test(id)) return notFound();
    const asPartner = new URL(request.url).searchParams.get("as") === "partner";
    const done = asPartner ? await leaveHost(user.id, id) : await removePartner(user.id, id);
    return done ? new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } }) : notFound();
  });
}

// PATCH { autoAdd }: whether this partner joins every new game.
export function PATCH(request: Request, { params }: Context) {
  return forUser(request, async ({ user }) => {
    const { id } = await params;
    if (!UUID.test(id)) return notFound();
    const read = await readJson(request, 512);
    if (!read.ok) return read.response;
    const body = read.body as { autoAdd?: unknown };
    if (typeof body !== "object" || body === null || Object.keys(body).length !== 1 || typeof body.autoAdd !== "boolean") return badRequest();
    return (await setPartnerAutoAdd(user.id, id, body.autoAdd)) ? json({ ok: true }) : notFound();
  });
}
