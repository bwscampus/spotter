import { getRosterForStats, setSeasonStats } from "@/lib/server/repo/rosters";
import { badRequest, forUser, json, notFound, readJson, UUID } from "@/lib/server/route";
import { isSeasonStatsBody } from "@/lib/server/validate";

type Context = { params: Promise<{ id: string }> };

const MAX_BODY_BYTES = 512 * 1024;

// PUT: replaces a team's season stats (set_season_stats). The body is
// lib/stats/review.ts toSetSeasonStatsArgs's p_stats.
export function PUT(request: Request, { params }: Context) {
  return forUser(request, async ({ user }) => {
    const { id } = await params;
    if (!UUID.test(id)) return notFound();
    const read = await readJson(request, MAX_BODY_BYTES);
    if (!read.ok) return read.response;
    if (!isSeasonStatsBody(read.body)) return badRequest();
    // A clear 404 for another account's team, before the function's own check.
    if (!(await getRosterForStats(user.id, id))) return notFound();
    return json({ matched: await setSeasonStats(user.id, id, read.body as never) });
  });
}
