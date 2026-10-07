import { rosterIdForKey, saveRoster } from "@/lib/server/repo/rosters";
import { badRequest, forUser, json, readJson } from "@/lib/server/route";
import { isSaveRosterBody } from "@/lib/server/validate";

// GET ?key=… : the id of this account's team with that roster key, or null, so
// the editor can warn before an import replaces a saved team.
// PUT: saves a whole roster (save_roster), new or renamed in place.
// Open to accounts still waiting for approval: typing a roster costs nothing.

const MAX_BODY_BYTES = 512 * 1024;

export function GET(request: Request) {
  return forUser(request, async ({ user }) => {
    const key = new URL(request.url).searchParams.get("key");
    if (!key || key.length > 600) return badRequest();
    return json({ id: await rosterIdForKey(user.id, key) });
  });
}

export function PUT(request: Request) {
  return forUser(request, async ({ user }) => {
    const read = await readJson(request, MAX_BODY_BYTES);
    if (!read.ok) return read.response;
    if (!isSaveRosterBody(read.body)) return badRequest();
    return json({ id: await saveRoster(user.id, read.body.p_roster as never, read.body.p_players as never) });
  });
}
