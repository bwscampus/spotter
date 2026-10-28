import { getScheduleTeam, setSchedule } from "@/lib/server/repo/schedule";
import { badRequest, forUser, json, notFound, readJson, UUID } from "@/lib/server/route";
import { isScheduleBody } from "@/lib/server/validate";

type Context = { params: Promise<{ id: string }> };

/** Eighty games at well under a kilobyte each. */
const MAX_BODY_BYTES = 64 * 1024;

// PUT: replaces a team's whole schedule (set_schedule), so saving the same
// schedule twice leaves one copy of it. The body is lib/schedule/review.ts
// toScheduleSaveBody's. No model call, so no spend guard: the import that read
// the schedule already went through it.
export function PUT(request: Request, { params }: Context) {
  return forUser(request, async ({ user }) => {
    const { id } = await params;
    if (!UUID.test(id)) return notFound();
    const read = await readJson(request, MAX_BODY_BYTES);
    if (!read.ok) return read.response;
    if (!isScheduleBody(read.body)) return badRequest();
    // A clear 404 for another account's team, before the function's own check.
    if (!(await getScheduleTeam(user.id, id))) return notFound();
    return json({ saved: await setSchedule(user.id, id, read.body.games) });
  });
}
