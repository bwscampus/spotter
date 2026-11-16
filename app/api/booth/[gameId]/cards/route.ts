import { isBoothPost } from "@/lib/booth/wire";
import { publish } from "@/lib/server/boothBus";
import { cachedRole } from "@/lib/server/boothRoles";
import { takeToken, tooManyRequests } from "@/lib/server/rateLimit";
import { badRequest, forUser, json, notFound, readJson, UUID } from "@/lib/server/route";

type Context = { params: Promise<{ gameId: string }> };

// POST: one thing a laptop's own engine did (lib/booth/wire.ts), relayed at
// once to the others in the booth and never stored (Nov 15). Who sent it is
// the session's slot in the booth, never a value from the body. Roster player
// ids only: no name, no word heard. "refresh" (the host pressed Refresh
// rosters) is the host's alone.
export function POST(request: Request, { params }: Context) {
  return forUser(request, async ({ user }) => {
    const { gameId } = await params;
    if (!UUID.test(gameId)) return notFound();
    if (!takeToken("boothCardsUser", user.id)) return tooManyRequests();
    const read = await readJson(request, 1024);
    if (!read.ok) return read.response;
    if (!isBoothPost(read.body)) return badRequest();
    const role = await cachedRole(user.id, gameId);
    if (!role || role.status !== "live") return notFound();
    const body = read.body;
    if (body.kind === "refresh") {
      if (role.role !== "host") return notFound();
      publish(gameId, { type: "refresh", from: 0 }, { except: 0 });
    } else {
      publish(gameId, { type: "card", from: role.slot, ...body }, { except: role.slot });
    }
    return json({ ok: true });
  });
}
