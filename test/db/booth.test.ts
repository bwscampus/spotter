import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Booth partners (Nov 15), against a real database: who may read what, who
// may write nothing, the two-guest limit, the code and the link, counting a
// booth game once against its host, the end of the game, and saved partners.
// The session is stubbed; routes, repo SQL, triggers and Postgres are real.
// Made-up schools and players.

if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL to the app_rw_login role of a migrated database.");

type User = { id: string; email: string; name: string | null; approved: boolean; isAdmin: boolean; emailVerified: boolean; signedInAt: Date; onboarded?: boolean };
let current: User | null = null;
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/server/session", async (original) => ({ ...(await original<object>()), readSession: async () => current }));

import { GET as boothGet, PATCH as boothPatch, POST as boothPost } from "@/app/api/booth/[gameId]/route";
import { POST as cardsPost } from "@/app/api/booth/[gameId]/cards/route";
import { GET as eventsGet } from "@/app/api/booth/[gameId]/events/route";
import { DELETE as removeMember } from "@/app/api/booth/[gameId]/members/[slot]/route";
import { GET as boothRosters } from "@/app/api/booth/[gameId]/rosters/route";
import { POST as boothStartRoute } from "@/app/api/booth/[gameId]/start/route";
import { POST as joinRoute } from "@/app/api/booth/join/route";
import { POST as acceptRoute } from "@/app/api/booth-partners/accept/route";
import { GET as partnersGet, POST as partnersPost } from "@/app/api/booth-partners/route";
import { POST as createDraftRoute } from "@/app/api/drafts/route";
import { DELETE as deleteDraftRoute, PATCH as patchDraftRoute } from "@/app/api/drafts/[id]/route";
import { POST as startDraftRoute } from "@/app/api/drafts/[id]/start/route";
import { PATCH as endGameRoute } from "@/app/api/games/[id]/route";
import { PATCH as patchPlayer } from "@/app/api/players/[id]/route";
import { GET as gameRosters } from "@/app/api/rosters/game/route";
import { GET as rosterGet } from "@/app/api/rosters/[id]/route";
import { PUT as putSchedule } from "@/app/api/rosters/[id]/schedule/route";
import { PUT as putStats } from "@/app/api/rosters/[id]/stats/route";
import { PUT as saveRoster } from "@/app/api/rosters/route";
import { BOOTH_CODE_ALPHABET } from "@/lib/booth/code";
import { resetBoothBus } from "@/lib/server/boothBus";
import { getPool, query, queryOne } from "@/lib/server/db";
import { resetRateLimits } from "@/lib/server/rateLimit";
import { endStaleBoothGames } from "@/lib/server/repo/booth";
import { listDrafts, listPastGames } from "@/lib/server/repo/games";

const BASE = "https://spotter.test";
const HEADERS = { "sec-fetch-site": "same-origin", "content-type": "application/json" };
const call = (method: string, path: string, body?: unknown) =>
  new Request(`${BASE}${path}`, { method, headers: HEADERS, body: body === undefined ? undefined : JSON.stringify(body) });
const game = (gameId: string) => ({ params: Promise.resolve({ gameId }) });
const byId = (id: string) => ({ params: Promise.resolve({ id }) });
const as = (user: User) => {
  current = user;
};
const json = async <T>(response: Response) => (await response.json()) as T;

const users: User[] = [];
async function makeUser(label: string, extra: Partial<User> = {}): Promise<User> {
  const email = `${label}-${randomUUID()}@example.com`;
  const row = await queryOne<{ id: string }>("insert into users (google_sub, email, name, approved, onboarded_at) values ($1, $2, $3, true, now()) returning id", [
    `${label}-${randomUUID()}`,
    email,
    label,
  ]);
  const user = { id: row!.id, email, name: label, approved: true, isAdmin: false, emailVerified: true, signedInAt: new Date(), onboarded: true, ...extra };
  users.push(user);
  return user;
}

const team = (school: string) => ({
  p_roster: { school, mascot: null, sport: "football", gender: "boys", level: "varsity", season: "2026" },
  p_players: [
    { jersey: "22", first_name: "Sam", last_name: "Quillon", pronunciations: ["KWILL-un"], heard_as: ["quillan"], spoken_forms: ["quillon"], spot_mode: "normal", facts: ["Three-year starter"] },
  ],
});
const saved = async (school: string) => (await json<{ id: string }>(await saveRoster(call("PUT", "/api/rosters", team(school))))).id;
const draft = async (body: unknown) => (await json<{ id: string }>(await createDraftRoute(call("POST", "/api/drafts", body)))).id;
const code = async (gameId: string) => (await json<{ code: string }>(await boothGet(call("GET", `/api/booth/${gameId}`), game(gameId)))).code;
const join = (body: unknown) => joinRoute(call("POST", "/api/booth/join", body));
const startedBody = (id: string, rosters: { away: string; home: string }) => ({
  id,
  home_roster_id: rosters.home,
  away_roster_id: rosters.away,
  home_school: "Harborview",
  away_school: "Millbrook",
  sport: "football",
  stats_enabled: false,
});
const ended = { ended_at: new Date().toISOString(), mic_seconds: 60, reconnects: 0, cards_shown: 4, cards_removed: 0, stat_plays_added: 0, stat_plays_undone: 0, remote_cards_shown: 3, deduped_cards: 2 };
/** What a future live-game counter would count for an account: games that left draft and are not someone else's booth. */
const counted = async (user: User) =>
  (await queryOne<{ n: number }>("select count(*)::int as n from called_games where owner_id = $1 and status <> 'draft' and not booth_guest", [user.id]))!.n;

let host: User;
let guest: User;
let other: User;
let away: string;
let home: string;
let hostElse: string;

beforeAll(async () => {
  host = await makeUser("host");
  guest = await makeUser("guest");
  other = await makeUser("other");
  as(host);
  away = await saved("Millbrook");
  home = await saved("Harborview");
  hostElse = await saved("Eastgate");
});

beforeEach(() => resetRateLimits());

afterAll(async () => {
  await resetBoothBus();
  await query("delete from users where id = any($1::uuid[])", [users.map((user) => user.id)]);
  await getPool().end();
});

describe("joining a host's game", () => {
  it("by code: the game shows up in the guest's drafts, hosted by the host, with the host's schools", async () => {
    as(host);
    const id = await draft({ game_date: "2026-11-20", sport: "football", away_roster_id: away, home_roster_id: home });
    const theCode = await code(id);
    expect(theCode).toMatch(new RegExp(`^[${BOOTH_CODE_ALPHABET}]{4}$`));
    as(guest);
    const joined = await join({ code: theCode.toLowerCase() });
    expect(joined.status).toBe(200);
    const body = await json<{ gameId: string; guestGameId: string; live: boolean }>(joined);
    expect(body).toMatchObject({ gameId: id, live: false });
    const drafts = await listDrafts(guest.id);
    expect(drafts.ok && drafts.drafts.find((each) => each.id === body.guestGameId)).toMatchObject({
      gameDate: "2026-11-20",
      awaySchool: "Millbrook",
      homeSchool: "Harborview",
      booth: { gameId: id, hostLabel: "host", hostLive: false },
    });
    // Joining twice is the same membership.
    expect((await json<{ guestGameId: string }>(await join({ code: theCode }))).guestGameId).toBe(body.guestGameId);
  });

  it("the guest reads the host's two rosters for that game, live, and cannot write a thing", async () => {
    as(host);
    const id = await draft({ game_date: "2026-11-20", away_roster_id: away, home_roster_id: home });
    const theCode = await code(id);
    as(guest);
    await join({ code: theCode });
    const read = await json<{ rosters: Array<{ id: string; school: string }>; players: Array<{ id: string; heard_as: string[]; pronunciations: string[]; facts: string[] }> }>(
      await boothRosters(call("GET", `/api/booth/${id}/rosters`), game(id)),
    );
    expect(read.rosters.map((roster) => roster.id).sort()).toEqual([away, home].sort());
    expect(read.players[0]).toMatchObject({ heard_as: ["quillan"], pronunciations: ["KWILL-un"], facts: ["Three-year starter"] });

    // The host's fix reaches the guest on his next read: it is the same row, not a copy.
    as(host);
    await saveRoster(call("PUT", "/api/rosters", { ...team("Millbrook"), p_roster: { ...team("Millbrook").p_roster, id: away }, p_players: [{ ...team("Millbrook").p_players[0], facts: ["Fixed fact"] }] }));
    as(guest);
    const again = await json<{ players: Array<{ roster_id: string; facts: string[] }> }>(await boothRosters(call("GET", `/api/booth/${id}/rosters`), game(id)));
    expect(again.players.find((player) => player.roster_id === away)?.facts).toEqual(["Fixed fact"]);

    // Every write route is still the owner's: the guest gets a 404, or saves a team of his own.
    const playerId = again.players[0] as unknown as { id: string };
    expect((await patchPlayer(call("PATCH", `/api/players/${playerId.id}`, { spot_mode: "off" }), byId(playerId.id))).status).toBe(404);
    expect((await putStats(call("PUT", `/api/rosters/${away}/stats`, { stats_as_of: "2026-11-01", entries: [] }), byId(away))).status).toBeGreaterThanOrEqual(400);
    expect((await putSchedule(call("PUT", `/api/rosters/${away}/schedule`, { games: [] }), byId(away))).status).toBeGreaterThanOrEqual(400);
    const overwrite = await saveRoster(call("PUT", "/api/rosters", { ...team("Hijacked"), p_roster: { ...team("Hijacked").p_roster, id: away } }));
    expect(overwrite.status).not.toBe(200);
    const hostRoster = await queryOne<{ school: string; owner_id: string }>("select school, owner_id from rosters where id = $1", [away]);
    expect(hostRoster).toEqual({ school: "Millbrook", owner_id: host.id });
    // Nor does he get them through his own routes.
    const mine = await json<{ rosters: unknown[] }>(await gameRosters(call("GET", `/api/rosters/game?ids=${away},${home}`)));
    expect(mine.rosters).toEqual([]);
  });

  it("the guest cannot read the host's other rosters or games, or the host's side of the booth", async () => {
    as(host);
    const id = await draft({ game_date: "2026-11-20", away_roster_id: away, home_roster_id: home });
    const elsewhere = await draft({ game_date: "2026-11-21", away_roster_id: hostElse, home_roster_id: home });
    const theCode = await code(id);
    as(guest);
    await join({ code: theCode });
    expect((await rosterGet(call("GET", `/api/rosters/${hostElse}`), byId(hostElse))).status).toBe(404);
    expect((await boothRosters(call("GET", `/api/booth/${elsewhere}/rosters`), game(elsewhere))).status).toBe(404);
    expect((await boothGet(call("GET", `/api/booth/${id}`), game(id))).status).toBe(404);
    expect((await boothPost(call("POST", `/api/booth/${id}`, { reset: "link" }), game(id))).status).toBe(404);
    expect((await removeMember(call("DELETE", `/api/booth/${id}/members/1`), { params: Promise.resolve({ gameId: id, slot: "1" }) })).status).toBe(404);
    const past = await listPastGames(guest.id);
    expect(past.ok && past.games.some((each) => each.id === id || each.id === elsewhere)).toBe(false);
    // His booth draft is the host's game: not his to change or start as a game of his own.
    const mine = (await listDrafts(guest.id)) as { ok: true; drafts: Array<{ id: string; booth?: { gameId: string } }> };
    const row = mine.drafts.find((each) => each.booth?.gameId === id)!;
    expect((await patchDraftRoute(call("PATCH", `/api/drafts/${row.id}`, { away_roster_id: null }), byId(row.id))).status).toBe(404);
    expect((await startDraftRoute(call("POST", `/api/drafts/${row.id}/start`, startedBody(row.id, { away, home })), byId(row.id))).status).toBe(404);
  });

  it("a third guest is refused", async () => {
    as(host);
    const id = await draft({ game_date: "2026-11-20", away_roster_id: away, home_roster_id: home });
    const theCode = await code(id);
    const second = await makeUser("second");
    const third = await makeUser("third");
    as(guest);
    expect((await join({ code: theCode })).status).toBe(200);
    as(second);
    expect((await join({ code: theCode })).status).toBe(200);
    as(third);
    const refused = await join({ code: theCode });
    expect(refused.status).toBe(409);
    expect((await json<{ code: string }>(refused)).code).toBe("full");
    // The database holds the line too, whoever asks.
    const slots = await query<{ slot: number }>("select slot from booth_members where host_game_id = $1 and state = 'active' order by slot", [id]);
    expect(slots.map((row) => row.slot)).toEqual([1, 2]);
  });

  it("the host can't join his own game, and a guest can't invite anyone", async () => {
    as(host);
    const id = await draft({ game_date: "2026-11-20", away_roster_id: away, home_roster_id: home });
    const theCode = await code(id);
    const refused = await join({ code: theCode });
    expect((await json<{ code: string }>(refused)).code).toBe("own_game");
    as(guest);
    await join({ code: theCode });
    expect((await boothPost(call("POST", `/api/booth/${id}`, { reset: "code" }), game(id))).status).toBe(404);
  });
});

describe("the code and the link", () => {
  it("wrong guesses are limited per account; a right code still costs nothing", async () => {
    as(host);
    const id = await draft({ game_date: "2026-11-20", away_roster_id: away, home_roster_id: home });
    const theCode = await code(id);
    as(other);
    const wrong = theCode === "ZZZZ" ? "YYYY" : "ZZZZ";
    for (let i = 0; i < 10; i++) expect((await join({ code: wrong })).status).toBe(404);
    expect((await join({ code: wrong })).status).toBe(429);
    // Even the right one waits now: no guessing past the limit.
    expect((await join({ code: theCode })).status).toBe(429);
  });

  it("dies when the host ends the game, and so does the guest's read of the rosters", async () => {
    as(host);
    const id = await draft({ game_date: "2026-11-20", away_roster_id: away, home_roster_id: home });
    const theCode = await code(id);
    const link = await json<{ token: string }>(await boothPost(call("POST", `/api/booth/${id}`, { reset: "link" }), game(id)));
    as(guest);
    const joined = await json<{ guestGameId: string }>(await join({ token: link.token }));
    expect((await boothStartRoute(call("POST", `/api/booth/${id}/start`), game(id))).status).toBe(200);
    as(host);
    expect((await startDraftRoute(call("POST", `/api/drafts/${id}/start`, startedBody(id, { away, home })), byId(id))).status).toBe(200);
    expect((await endGameRoute(call("PATCH", `/api/games/${id}`, ended), byId(id))).status).toBe(200);
    expect(await queryOne("select 1 from booth_invites where game_id = $1", [id])).toBeNull();

    as(guest);
    expect((await boothRosters(call("GET", `/api/booth/${id}/rosters`), game(id))).status).toBe(404);
    as(other);
    expect((await join({ code: theCode })).status).toBe(404);
    expect((await join({ token: link.token })).status).toBe(404);

    // The guest's own game stays his, in Past games, with his counts and who hosted it.
    as(guest);
    expect((await endGameRoute(call("PATCH", `/api/games/${joined.guestGameId}`, ended), byId(joined.guestGameId))).status).toBe(200);
    const past = await listPastGames(guest.id);
    expect(past.ok && past.games.find((each) => each.id === joined.guestGameId)).toMatchObject({
      awaySchool: "Millbrook",
      homeSchool: "Harborview",
      cardsShown: 4,
      hostedBy: "host",
    });
    const counts = await queryOne<{ remote_cards_shown: number; deduped_cards: number }>("select remote_cards_shown, deduped_cards from called_games where id = $1", [
      joined.guestGameId,
    ]);
    expect(counts).toEqual({ remote_cards_shown: 3, deduped_cards: 2 });
  });

  it("a removed guest loses the rosters at once and can't come back with the code", async () => {
    as(host);
    const id = await draft({ game_date: "2026-11-20", away_roster_id: away, home_roster_id: home });
    const theCode = await code(id);
    as(guest);
    await join({ code: theCode });
    as(host);
    expect((await removeMember(call("DELETE", `/api/booth/${id}/members/1`), { params: Promise.resolve({ gameId: id, slot: "1" }) })).status).toBe(204);
    as(guest);
    expect((await boothRosters(call("GET", `/api/booth/${id}/rosters`), game(id))).status).toBe(404);
    const again = await join({ code: theCode });
    expect(again.status).toBe(403);
    const drafts = await listDrafts(guest.id);
    expect(drafts.ok && drafts.drafts.some((each) => each.booth?.gameId === id)).toBe(false);
  });

  it("a guest who leaves (deletes his draft) may join again; a host who deletes his draft takes the guests' drafts with it", async () => {
    as(host);
    const id = await draft({ game_date: "2026-11-20", away_roster_id: away, home_roster_id: home });
    const theCode = await code(id);
    as(guest);
    const first = await json<{ guestGameId: string }>(await join({ code: theCode }));
    expect((await deleteDraftRoute(call("DELETE", `/api/drafts/${first.guestGameId}`), byId(first.guestGameId))).status).toBe(204);
    const second = await json<{ guestGameId: string }>(await join({ code: theCode }));
    expect(second.guestGameId).not.toBe(first.guestGameId);
    as(host);
    expect((await deleteDraftRoute(call("DELETE", `/api/drafts/${id}`), byId(id))).status).toBe(204);
    expect(await queryOne("select 1 from called_games where id = $1", [second.guestGameId])).toBeNull();
  });
});

describe("starting and counting", () => {
  it("counts once, against the host, when the guest starts first; the host's Start joins that same game", async () => {
    const before = { host: await counted(host), guest: await counted(guest) };
    as(host);
    const id = await draft({ game_date: "2026-11-20", away_roster_id: away, home_roster_id: home });
    const theCode = await code(id);
    as(guest);
    const joined = await json<{ guestGameId: string }>(await join({ code: theCode }));
    expect((await json<{ guestGameId: string }>(await boothStartRoute(call("POST", `/api/booth/${id}/start`), game(id)))).guestGameId).toBe(joined.guestGameId);
    expect(await counted(host)).toBe(before.host + 1);
    expect(await counted(guest)).toBe(before.guest);
    const hostRow = await queryOne<{ status: string; booth_guest: boolean; home_school: string }>("select status, booth_guest, home_school from called_games where id = $1", [id]);
    expect(hostRow).toEqual({ status: "live", booth_guest: false, home_school: "Harborview" });

    as(host);
    expect((await startDraftRoute(call("POST", `/api/drafts/${id}/start`, startedBody(id, { away, home })), byId(id))).status).toBe(200);
    // Once: a second Start of the host's (another computer) is refused as before.
    expect((await startDraftRoute(call("POST", `/api/drafts/${id}/start`, startedBody(id, { away, home })), byId(id))).status).toBe(409);
    expect(await counted(host)).toBe(before.host + 1);
    // A guest joining once it is under way is told so.
    const late = await makeUser("late");
    as(late);
    expect((await json<{ live: boolean }>(await join({ code: theCode }))).live).toBe(true);
  });

  it("counts once, against the host, when the host starts first", async () => {
    const before = { host: await counted(host), guest: await counted(guest) };
    as(host);
    const id = await draft({ game_date: "2026-11-20", away_roster_id: away, home_roster_id: home });
    const theCode = await code(id);
    expect((await startDraftRoute(call("POST", `/api/drafts/${id}/start`, startedBody(id, { away, home })), byId(id))).status).toBe(200);
    as(guest);
    await join({ code: theCode });
    expect((await boothStartRoute(call("POST", `/api/booth/${id}/start`), game(id))).status).toBe(200);
    expect(await counted(host)).toBe(before.host + 1);
    expect(await counted(guest)).toBe(before.guest);
  });

  it("a guest can't start before the host picked both teams", async () => {
    as(host);
    const id = await draft({ game_date: "2026-11-20", away_roster_id: away });
    const theCode = await code(id);
    as(guest);
    await join({ code: theCode });
    expect((await boothStartRoute(call("POST", `/api/booth/${id}/start`), game(id))).status).toBe(409);
  });
});

describe("the live connection's routes", () => {
  it("relays only for the booth, only ids, and opens only for its members", async () => {
    as(host);
    const id = await draft({ game_date: "2026-11-20", away_roster_id: away, home_roster_id: home });
    const theCode = await code(id);
    as(guest);
    await join({ code: theCode });
    await boothStartRoute(call("POST", `/api/booth/${id}/start`), game(id));
    const ID = "0f0e0d0c-0b0a-4908-8706-050403020100";
    expect((await cardsPost(call("POST", `/api/booth/${id}/cards`, { kind: "up", ids: [ID], views: ["facts"] }), game(id))).status).toBe(200);
    expect((await cardsPost(call("POST", `/api/booth/${id}/cards`, { kind: "up", ids: [ID], views: ["facts"], name: "Quillon" }), game(id))).status).toBe(400);
    // Refresh is the host's alone.
    expect((await cardsPost(call("POST", `/api/booth/${id}/cards`, { kind: "refresh" }), game(id))).status).toBe(404);
    as(other);
    expect((await cardsPost(call("POST", `/api/booth/${id}/cards`, { kind: "down", ids: [ID] }), game(id))).status).toBe(404);
    expect((await eventsGet(call("GET", `/api/booth/${id}/events`), game(id))).status).toBe(404);

    as(guest);
    const abort = new AbortController();
    const stream = await eventsGet(new Request(`${BASE}/api/booth/${id}/events`, { headers: HEADERS, signal: abort.signal }), game(id));
    expect(stream.status).toBe(200);
    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    expect(stream.headers.get("cache-control")).toContain("no-transform");
    const reader = stream.body!.getReader();
    let text = "";
    while (!text.includes('"type":"hello"')) text += new TextDecoder().decode((await reader.read()).value);
    expect(text).toContain('"you":1');
    // A card the host posts reaches this guest's stream at once.
    as(host);
    await cardsPost(call("POST", `/api/booth/${id}/cards`, { kind: "down", ids: [ID] }), game(id));
    while (!text.includes('"type":"card"')) text += new TextDecoder().decode((await reader.read()).value);
    expect(text).toContain(`"from":0`);
    expect(text).not.toMatch(/Quillon/i);
    abort.abort();
    await reader.cancel().catch(() => {});
  });
});

describe("saved booth partners", () => {
  it("a partner added by email accepts once, then every new game the host makes is a draft in his games", async () => {
    const partner = await makeUser("partner");
    as(host);
    const added = await json<{ sent: boolean; link?: string }>(await partnersPost(call("POST", "/api/booth-partners", { email: partner.email })));
    // No email provider in a test: the link comes back for the host to copy.
    expect(added.sent).toBe(false);
    expect(added.link).toMatch(/\/booth-partner\/[A-Za-z0-9_-]{43}$/);
    const token = added.link!.split("/").pop()!;

    as(partner);
    // Invites shown in Settings by his confirmed email.
    const waiting = await json<{ invites: Array<{ id: string; hostLabel: string }> }>(await partnersGet(call("GET", "/api/booth-partners")));
    expect(waiting.invites.map((invite) => invite.hostLabel)).toContain("host");
    expect((await acceptRoute(call("POST", "/api/booth-partners/accept", { token }))).status).toBe(200);

    as(host);
    const id = await draft({ game_date: "2026-11-27", away_roster_id: away, home_roster_id: home });
    const drafts = await listDrafts(partner.id);
    expect(drafts.ok && drafts.drafts.find((each) => each.booth?.gameId === id)).toMatchObject({ booth: { hostLabel: "host" }, awaySchool: "Millbrook" });
    const booth = await json<{ guests: Array<{ method: string }>; partnersOn: boolean }>(await boothGet(call("GET", `/api/booth/${id}`), game(id)));
    expect(booth.guests.map((guestRow) => guestRow.method)).toEqual(["partner"]);
    expect(booth.partnersOn).toBe(true);

    // Off for this game takes the partner out of it, and his draft with it.
    expect((await boothPatch(call("PATCH", `/api/booth/${id}`, { partners: false }), game(id))).status).toBe(200);
    const after = await listDrafts(partner.id);
    expect(after.ok && after.drafts.some((each) => each.booth?.gameId === id)).toBe(false);
    // The token worked once.
    as(other);
    expect((await acceptRoute(call("POST", "/api/booth-partners/accept", { token }))).status).toBe(404);
  });

  it("an invite with an unconfirmed email is not shown in Settings", async () => {
    const unconfirmed = await makeUser("unconfirmed", { emailVerified: false });
    as(host);
    await partnersPost(call("POST", "/api/booth-partners", { email: unconfirmed.email }));
    as(unconfirmed);
    const waiting = await json<{ invites: unknown[] }>(await partnersGet(call("GET", "/api/booth-partners")));
    expect(waiting.invites).toEqual([]);
  });
});

describe("deleting an account", () => {
  it("works for a guest and for a host in a booth, and takes the memberships with them", async () => {
    const leaving = await makeUser("leaving-guest");
    const leavingHost = await makeUser("leaving-host");
    as(leavingHost);
    const a = await saved("Westlake");
    const b = await saved("Northfield");
    const id = await draft({ game_date: "2026-11-20", away_roster_id: a, home_roster_id: b });
    const theCode = await code(id);
    as(leaving);
    await join({ code: theCode });
    await boothStartRoute(call("POST", `/api/booth/${id}/start`), game(id));
    as(guest);
    await join({ code: theCode });
    await query("select public.delete_my_account($1)", [leaving.id]);
    expect(await queryOne("select 1 from booth_members where guest_id = $1", [leaving.id])).toBeNull();
    await query("select public.delete_my_account($1)", [leavingHost.id]);
    expect(await queryOne("select 1 from booth_members where host_game_id = $1", [id])).toBeNull();
    // The other guest's draft of it went with the host's game.
    const drafts = await listDrafts(guest.id);
    expect(drafts.ok && drafts.drafts.some((each) => each.booth?.gameId === id)).toBe(false);
  });
});

describe("the hourly cleanup", () => {
  it("ends a host's booth game nobody ended, 12 hours after it started, and with it the guests' access", async () => {
    as(host);
    const id = await draft({ game_date: "2026-11-20", away_roster_id: away, home_roster_id: home });
    const theCode = await code(id);
    as(guest);
    await join({ code: theCode });
    await boothStartRoute(call("POST", `/api/booth/${id}/start`), game(id));
    await query("update called_games set started_at = now() - interval '13 hours' where id = $1", [id]);
    await endStaleBoothGames();
    expect((await queryOne<{ status: string }>("select status from called_games where id = $1", [id]))?.status).toBe("ended");
    expect((await boothRosters(call("GET", `/api/booth/${id}/rosters`), game(id))).status).toBe(404);
  });
});
