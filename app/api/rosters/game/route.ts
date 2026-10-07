import { getGameRosters } from "@/lib/server/repo/rosters";
import { badRequest, forUser, json, UUID } from "@/lib/server/route";

// GET ?ids=home,away : both teams of a game and their players, for
// lib/game/buildGame.ts (Start and Refresh rosters). Only this account's.

export function GET(request: Request) {
  return forUser(request, async ({ user }) => {
    const ids = (new URL(request.url).searchParams.get("ids") ?? "").split(",").filter(Boolean);
    if (ids.length < 1 || ids.length > 2 || !ids.every((id) => UUID.test(id))) return badRequest();
    return json(await getGameRosters(user.id, ids));
  });
}
