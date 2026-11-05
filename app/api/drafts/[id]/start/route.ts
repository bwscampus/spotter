import { startDraft } from "@/lib/server/repo/games";
import { badRequest, failure, forUser, json, notFound, readJson, UUID } from "@/lib/server/route";
import { isStartedGameBody } from "@/lib/server/validate";

type Context = { params: Promise<{ id: string }> };

// POST: starts a draft. The same row becomes the live game, its id the game's
// id, with the schools, sport and roster ids Start read (lib/game/calledGames.ts
// startedRow). Never inserts a second row: a draft of this account that was
// started already is a 409 (the browser then records its game under a new
// id, never this one), and anything else not this account's is a 404.
export function POST(request: Request, { params }: Context) {
  return forUser(request, async ({ user }) => {
    const { id } = await params;
    if (!UUID.test(id)) return notFound();
    const read = await readJson(request, 8 * 1024);
    if (!read.ok) return read.response;
    if (!isStartedGameBody(read.body) || read.body.id !== id) return badRequest();
    const { home_roster_id, away_roster_id, home_school, away_school, sport, stats_enabled } = read.body;
    const result = await startDraft(user.id, id, { home_roster_id, away_roster_id, home_school, away_school, sport, stats_enabled });
    if (result === "started") return failure(409, "already_started", "This game was started already.");
    if (result === "missing") return notFound();
    return json({ ok: true });
  });
}
