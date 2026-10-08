import { updatePlayer } from "@/lib/server/repo/rosters";
import { badRequest, forUser, json, notFound, readJson, UUID } from "@/lib/server/route";
import { isPlayerPatchBody } from "@/lib/server/validate";

type Context = { params: Promise<{ id: string }> };

// PATCH: one player's heard-as forms (the words Deepgram writes for their
// surname, from the sound check and Past games' suggestions) and/or spotting
// setting (game setup's one-click "spotting off"). The browser has already
// checked each form against both rosters (lib/rosters/heardAs.ts
// checkHeardAs); this only stores what it sends, for the caller's own player.
export function PATCH(request: Request, { params }: Context) {
  return forUser(request, async ({ user }) => {
    const { id } = await params;
    if (!UUID.test(id)) return notFound();
    const read = await readJson(request, 8 * 1024);
    if (!read.ok) return read.response;
    if (!isPlayerPatchBody(read.body)) return badRequest();
    if (!(await updatePlayer(user.id, id, read.body))) return notFound();
    return json({ ok: true });
  });
}
