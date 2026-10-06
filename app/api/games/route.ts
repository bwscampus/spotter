import { insertGame } from "@/lib/server/repo/games";
import { badRequest, forUser, json, readJson } from "@/lib/server/route";
import { isStartedGameBody } from "@/lib/server/validate";

// POST: records a game on Start (lib/game/calledGames.ts beginGame). The id is
// made in the browser. Both rosters must be this account's, or it is a 404.
export function POST(request: Request) {
  return forUser(request, async ({ user }) => {
    const read = await readJson(request, 8 * 1024);
    if (!read.ok) return read.response;
    if (!isStartedGameBody(read.body)) return badRequest();
    await insertGame(user.id, read.body);
    return json({ ok: true }, 201);
  });
}
