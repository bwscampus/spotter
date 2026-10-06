import { validateFeedback } from "@/lib/game/feedback";
import { saveFeedback } from "@/lib/server/repo/games";
import { badRequest, forUser, json, notFound, readJson, UUID } from "@/lib/server/route";

type Context = { params: Promise<{ id: string }> };

// PUT: the end-of-game feedback card, one row per game. The same rules the card
// runs (lib/game/feedback.ts validateFeedback) run again here.
export function PUT(request: Request, { params }: Context) {
  return forUser(request, async ({ user }) => {
    const { id } = await params;
    if (!UUID.test(id)) return notFound();
    const read = await readJson(request, 8 * 1024);
    if (!read.ok) return read.response;
    const body = read.body as { rating?: unknown; blockers?: unknown; note?: unknown };
    if (typeof body !== "object" || body === null || !Array.isArray(body.blockers)) return badRequest();
    const check = validateFeedback(id, {
      rating: typeof body.rating === "number" ? body.rating : null,
      blockers: body.blockers.filter((b): b is string => typeof b === "string") as never,
      note: typeof body.note === "string" ? body.note : "",
    });
    if (!check.ok) return badRequest();
    if (!(await saveFeedback(user.id, check.row))) return notFound();
    return json({ ok: true });
  });
}
