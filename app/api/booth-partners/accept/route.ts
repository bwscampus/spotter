import { acceptPartnerById, acceptPartnerByToken } from "@/lib/server/repo/booth";
import { takeToken, tooManyRequests } from "@/lib/server/rateLimit";
import { badRequest, failure, forUser, json, readJson, UUID } from "@/lib/server/route";

// POST { token } (the emailed link) or { id } (an invite shown in Settings,
// which only the account with that confirmed email sees): becomes the host's
// saved partner, so his new games show up here as drafts.
export function POST(request: Request) {
  return forUser(request, async ({ user }) => {
    if (!takeToken("boothJoinUser", user.id)) return tooManyRequests();
    const read = await readJson(request, 1024);
    if (!read.ok) return read.response;
    const body = read.body as { token?: unknown; id?: unknown };
    if (typeof body !== "object" || body === null || Object.keys(body).length !== 1) return badRequest();
    let result;
    if ("token" in body) result = await acceptPartnerByToken(user.id, body.token);
    else if (typeof body.id === "string" && UUID.test(body.id)) result = await acceptPartnerById(user, body.id);
    else return badRequest();
    if (result === "missing") return failure(404, "missing", "That invite isn't open any more. Ask for a new one.");
    if (result === "self") return failure(400, "self", "That's your own invite.");
    return json({ ok: true, already: result === "already" });
  });
}
