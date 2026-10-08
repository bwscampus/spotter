import { listPlayersForHeardAs } from "@/lib/server/repo/rosters";
import { badRequest, forUser, json, UUID } from "@/lib/server/route";

// GET ?ids=home,away : the players on up to two of this account's rosters, as
// the sound check and Past games' heard-as suggestions read them.
export function GET(request: Request) {
  return forUser(request, async ({ user }) => {
    const ids = (new URL(request.url).searchParams.get("ids") ?? "").split(",").filter(Boolean);
    if (ids.length < 1 || ids.length > 2 || !ids.every((id) => UUID.test(id))) return badRequest();
    return json({ players: await listPlayersForHeardAs(user.id, ids) });
  });
}
