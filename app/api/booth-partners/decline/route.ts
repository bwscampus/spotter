import { declinePartner } from "@/lib/server/repo/booth";
import { badRequest, forUser, notFound, readJson, UUID } from "@/lib/server/route";

// POST { id }: turns down an invite shown in Settings.
export function POST(request: Request) {
  return forUser(request, async ({ user }) => {
    const read = await readJson(request, 512);
    if (!read.ok) return read.response;
    const body = read.body as { id?: unknown };
    if (typeof body !== "object" || body === null || typeof body.id !== "string" || !UUID.test(body.id)) return badRequest();
    return (await declinePartner(user, body.id)) ? new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } }) : notFound();
  });
}
