import { announceMembers } from "@/lib/server/boothAnnounce";
import { publish } from "@/lib/server/boothBus";
import { hostBooth, resetCode, resetLink, setPartnersOnGame } from "@/lib/server/repo/booth";
import { badRequest, forUser, json, notFound, readJson, UUID } from "@/lib/server/route";

type Context = { params: Promise<{ gameId: string }> };

// Booth partners (Nov 15): the host's side of his game's booth. Only the host
// of a draft or live game; anyone else, a guest included, gets a 404.

// GET: the join code (made the first time), whether a link exists, who is in.
export function GET(request: Request, { params }: Context) {
  return forUser(request, async ({ user }) => {
    const { gameId } = await params;
    if (!UUID.test(gameId)) return notFound();
    const booth = await hostBooth(user.id, gameId);
    return booth ? json(booth) : notFound();
  });
}

// POST { reset: "link" }: a new invite link, the old one dead. The token is in
// this answer and nowhere else; only its hash is kept. { reset: "code" }: a new code.
export function POST(request: Request, { params }: Context) {
  return forUser(request, async ({ user }) => {
    const { gameId } = await params;
    if (!UUID.test(gameId)) return notFound();
    const read = await readJson(request, 1024);
    if (!read.ok) return read.response;
    const body = read.body as { reset?: unknown };
    if (typeof body !== "object" || body === null || Object.keys(body).length !== 1) return badRequest();
    if (body.reset === "link") {
      const token = await resetLink(user.id, gameId);
      return token ? json({ token }) : notFound();
    }
    if (body.reset === "code") {
      const code = await resetCode(user.id, gameId);
      return code ? json({ code }) : notFound();
    }
    return badRequest();
  });
}

// PATCH { partners: boolean }: this game with or without the host's saved partners.
export function PATCH(request: Request, { params }: Context) {
  return forUser(request, async ({ user }) => {
    const { gameId } = await params;
    if (!UUID.test(gameId)) return notFound();
    const read = await readJson(request, 1024);
    if (!read.ok) return read.response;
    const body = read.body as { partners?: unknown };
    if (typeof body !== "object" || body === null || Object.keys(body).length !== 1 || typeof body.partners !== "boolean") return badRequest();
    const changed = await setPartnersOnGame(user.id, gameId, body.partners);
    if (!changed) return notFound();
    for (const slot of changed.removed) publish(gameId, { type: "removed" }, { to: slot });
    await announceMembers(gameId);
    return json({ ok: true });
  });
}
