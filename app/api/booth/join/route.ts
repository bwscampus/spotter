import { announceMembers } from "@/lib/server/boothAnnounce";
import { forgetRole } from "@/lib/server/boothRoles";
import { hasToken, takeToken, tooManyRequests } from "@/lib/server/rateLimit";
import { joinByCode, joinByToken, type JoinStatus } from "@/lib/server/repo/booth";
import { clientIp } from "@/lib/server/request";
import { badRequest, failure, forUser, json, readJson } from "@/lib/server/route";

// POST { code } or { token }: joins a booth (Nov 15) as a guest. The guest gets
// his own draft of the host's game; the answer says where it is and whether
// the host's game is already under way, so the page can go straight to it.
//
// A wrong code costs a token, by account and by network, so the 4-character
// codes cannot be walked. A link's token is 32 random bytes and is limited
// only so a script cannot hammer it.

const SAID: Record<Exclude<JoinStatus, "ok">, [number, string]> = {
  missing: [404, "That code or link isn't for a game. Check it with the host."],
  own_game: [409, "That's your own game. Send the code to your partner instead."],
  over: [410, "That game has ended."],
  full: [409, "That booth already has two partners. Ask the host to take one out first."],
  removed: [403, "The host took you out of that game."],
};

export function POST(request: Request) {
  return forUser(request, async ({ user }) => {
    const read = await readJson(request, 1024);
    if (!read.ok) return read.response;
    const body = read.body as { code?: unknown; token?: unknown };
    if (typeof body !== "object" || body === null || Object.keys(body).length !== 1) return badRequest();

    let result;
    if ("code" in body) {
      const ip = clientIp(request);
      if (!hasToken("boothCodeUser", user.id) || !hasToken("boothCodeIp", ip)) return tooManyRequests();
      result = await joinByCode(user.id, body.code);
      if (result.status === "missing") {
        takeToken("boothCodeUser", user.id);
        takeToken("boothCodeIp", ip);
      }
    } else if ("token" in body) {
      if (!takeToken("boothJoinUser", user.id)) return tooManyRequests();
      result = await joinByToken(user.id, body.token);
    } else {
      return badRequest();
    }

    if (result.status !== "ok") {
      const [status, error] = SAID[result.status];
      return failure(status, result.status, error);
    }
    if (result.gameId) {
      forgetRole(result.gameId);
      await announceMembers(result.gameId);
    }
    return json({ gameId: result.gameId, guestGameId: result.guestGameId, live: result.live });
  });
}
