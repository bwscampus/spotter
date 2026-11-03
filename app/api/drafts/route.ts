import { takeToken, tooManyRequests } from "@/lib/server/rateLimit";
import { insertDraft, listDrafts } from "@/lib/server/repo/games";
import { badRequest, failure, forUser, json, readJson } from "@/lib/server/route";
import { isDraftBody } from "@/lib/server/validate";

// Draft games (Nov 3; db/migrations/0025_draft_games.sql): a game set up but
// not started, kept in the account. Every route is the signed-in account's
// own: the owner comes from the session, never the body, and a roster id that
// is not this account's is a 404 (the composite foreign key's 23503).

// GET: this account's drafts, soonest first.
export function GET(request: Request) {
  return forUser(request, async ({ user }) => {
    const result = await listDrafts(user.id);
    if (!result.ok) return failure(503, "unavailable", "Could not read your draft games just now. Try again.");
    return json({ drafts: result.drafts });
  });
}

// POST: a new draft, with its date and whatever else is known yet. Answers its id.
// There is no cap on how many drafts an account keeps (Jed, Nov 3); creating
// them is rate limited per account, so a loop cannot fill the table.
export function POST(request: Request) {
  return forUser(request, async ({ user }) => {
    if (!takeToken("createDraftUser", user.id)) return tooManyRequests();
    const read = await readJson(request, 4 * 1024);
    if (!read.ok) return read.response;
    if (!isDraftBody(read.body, "create") || read.body.game_date === undefined) return badRequest();
    const id = await insertDraft(user.id, { ...read.body, game_date: read.body.game_date });
    return json({ id }, 201);
  });
}
