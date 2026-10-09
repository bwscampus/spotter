// Verifies the least-privilege app role against a migrated database (DB-6).
// Adapted from papaspuzzles. Run after `npm run migrate` with APP_DB_PASSWORD set:
//
//   MIGRATION_DATABASE_URL=postgresql://postgres:...@host/db \
//   APP_DATABASE_URL=postgresql://app_rw_login:...@host/db \
//   node scripts/check-app-role.mjs
//
// Local/CI only: everything it writes is rolled back, except a probe table it
// creates and drops to test default privileges.
import pg from "pg";

const ownerUrl = process.env.MIGRATION_DATABASE_URL;
const appUrl = process.env.APP_DATABASE_URL;
if (!ownerUrl || !appUrl) {
  console.error("Set MIGRATION_DATABASE_URL (owner) and APP_DATABASE_URL (app_rw_login).");
  process.exit(1);
}

let failures = 0;
function expect(condition, okMsg, badMsg) {
  if (condition) {
    console.log(`  ✓ ${okMsg}`);
  } else {
    console.log(`  ✗ ${badMsg}`);
    failures += 1;
  }
}

/** Runs sql inside a savepoint and expects it to fail with one of the given SQLSTATE codes. */
async function expectRefused(client, label, sql, params, codes) {
  await client.query("savepoint probe");
  try {
    await client.query(sql, params);
    expect(false, "", `${label} should be refused`);
  } catch (err) {
    expect(codes.includes(err.code), `${label} refused`, `${label} failed with unexpected ${err.code}: ${err.message}`);
  }
  await client.query("rollback to savepoint probe");
}

const owner = new pg.Client({ connectionString: ownerUrl });
const app = new pg.Client({ connectionString: appUrl });
await owner.connect();
await app.connect();

try {
  console.log("• role attributes");
  const { rows: me } = await app.query(
    `select current_user as name, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole,
            pg_has_role(current_user, 'app_rw', 'member') as in_app_rw
     from pg_roles where rolname = current_user`,
  );
  const r = me[0];
  expect(r.name === "app_rw_login", "connected as app_rw_login", `connected as ${r.name}`);
  expect(
    !r.rolsuper && !r.rolbypassrls && !r.rolcreatedb && !r.rolcreaterole,
    "not superuser, no BYPASSRLS/CREATEDB/CREATEROLE",
    `unexpected attributes: ${JSON.stringify(r)}`,
  );
  expect(r.in_app_rw, "member of app_rw", "not a member of app_rw");

  console.log("• runtime query paths (rolled back)");
  await app.query("begin");
  let userId = null;
  let otherId = null;
  try {
    const stamp = Date.now();
    ({
      rows: [{ id: userId }],
    } = await app.query(`insert into users (google_sub, email, name) values ($1, $2, 'Probe') returning id`, [
      `probe-${stamp}`,
      `probe-${stamp}@example.com`,
    ]));
    ({
      rows: [{ id: otherId }],
    } = await app.query(`insert into users (google_sub, email) values ($1, $2) returning id`, [
      `probe-other-${stamp}`,
      `probe-other-${stamp}@example.com`,
    ]));
    expect(true, "insert users");

    const {
      rows: [approved],
    } = await app.query("update users set approved = true where id = $1 returning approved_at", [userId]);
    expect(approved.approved_at !== null, "approve a user (approved_at stamped)", "approved_at not stamped");

    await app.query(
      `insert into sessions (token_hash, user_id, expires_at) values ($1, $2, now() + interval '30 days')`,
      ["a".repeat(64), userId],
    );
    await app.query("delete from sessions where user_id = $1", [userId]);
    expect(true, "insert/delete sessions");

    const {
      rows: [{ id: rosterId }],
    } = await app.query(
      `select public.save_roster($1, $2::jsonb, $3::jsonb) as id`,
      [
        userId,
        JSON.stringify({ school: "Probe High", sport: "football" }),
        JSON.stringify([{ jersey: "22", last_name: "Langan", season_stats: { rush_att: 3, junk: "x" } }]),
      ],
    );
    expect(Boolean(rosterId), "save_roster()", "save_roster() returned nothing");

    const {
      rows: [player],
    } = await app.query("select id, season_stats from roster_players where roster_id = $1", [rosterId]);
    expect(
      JSON.stringify(player.season_stats) === JSON.stringify({ rush_att: 3 }),
      "clean_season_stats() keeps only football keys",
      `season_stats saved as ${JSON.stringify(player.season_stats)}`,
    );

    const {
      rows: [{ matched }],
    } = await app.query(`select public.set_season_stats($1, $2, $3::jsonb) as matched`, [
      userId,
      rosterId,
      JSON.stringify({ as_of: "2026-10-06", players: [{ id: player.id, stats: { rush_att: 5 } }] }),
    ]);
    expect(matched === 1, "set_season_stats()", `set_season_stats() matched ${matched}`);

    const {
      rows: [{ id: gameId }],
    } = await app.query(
      `insert into called_games (owner_id, home_roster_id, home_school, away_school, sport)
       values ($1, $2, 'Probe High', 'Other High', 'football') returning id`,
      [userId, rosterId],
    );
    await app.query("insert into game_feedback (game_id, owner_id, rating, blockers) values ($1, $2, 4, '{slow}')", [
      gameId,
      userId,
    ]);
    await app.query(
      `insert into app_events (owner_id, name, env, app_version, session_id, props)
       values ($1, 'game.started', 'preview', 'abc1234', gen_random_uuid(), '{}')`,
      [userId],
    );
    expect(true, "insert called_games, game_feedback, app_events");

    console.log("• ownership and admin guards");
    await expectRefused(
      app,
      "save_roster() for another owner's roster id",
      `select public.save_roster($1, $2::jsonb, '[]'::jsonb)`,
      [otherId, JSON.stringify({ id: rosterId, school: "Probe High", sport: "football" })],
      ["P0001"],
    );
    await expectRefused(
      app,
      "a player under another owner's roster",
      `insert into roster_players (roster_id, owner_id, sort_order, last_name) values ($1, $2, 0, 'X')`,
      [rosterId, otherId],
      ["23503"],
    );
    await expectRefused(
      app,
      "a game naming another owner's roster",
      `insert into called_games (owner_id, home_roster_id, home_school, away_school) values ($1, $2, 'A', 'B')`,
      [otherId, rosterId],
      ["23503"],
    );
    const {
      rows: [{ id: quietGameId }],
    } = await app.query(
      `insert into called_games (owner_id, home_school, away_school) values ($1, 'Probe High', 'Other High') returning id`,
      [userId],
    );
    await expectRefused(
      app,
      "feedback on another owner's game",
      `insert into game_feedback (game_id, owner_id, rating) values ($1, $2, 3)`,
      [quietGameId, otherId],
      ["23503"],
    );
    await expectRefused(app, "the app making a user admin", "update users set is_admin = true where id = $1", [userId], [
      "P0001",
    ]);
    await expectRefused(
      app,
      "the app creating an admin",
      `insert into users (google_sub, email, is_admin) values ('probe-admin', 'a@example.com', true)`,
      [],
      ["P0001"],
    );
    await expectRefused(app, "reading the admin metric views", "select * from admin.metrics_activation", [], ["42501"]);
    for (const view of ["usage_by_user", "pending_approvals", "recent_client_errors"]) {
      await expectRefused(app, `reading admin.${view}`, `select * from admin.${view}`, [], ["42501"]);
    }

    console.log("• rosters: colour, heard-as, storyline, caps (0006, 0012)");
    const {
      rows: [{ approved: newApproved }],
    } = await app.query("select approved from users where id = $1", [otherId]);
    expect(newApproved === true, "a new user starts approved (0013)", "a new user starts unapproved");

    const {
      rows: [{ id: wholeId }],
    } = await app.query(`select public.save_roster($1, $2::jsonb, $3::jsonb) as id`, [
      userId,
      JSON.stringify({ school: "Whole High", sport: "football", primary_color: "#1A2B3C" }),
      JSON.stringify([
        {
          jersey: "7",
          last_name: "Fifita",
          heard_as: ["fafitaga"],
          storyline: "  Two picks last week  ",
          season_stats: { int_td: 1, fr_td: 2 },
        },
      ]),
    ]);
    // An older client: no colour, heard_as or storyline keys. All three are kept.
    await app.query(`select public.save_roster($1, $2::jsonb, $3::jsonb)`, [
      userId,
      JSON.stringify({ id: wholeId, school: "Whole High", sport: "football" }),
      JSON.stringify([{ jersey: "#7", last_name: "Fifita" }]),
    ]);
    const {
      rows: [whole],
    } = await app.query(
      `select r.primary_color, p.heard_as, p.storyline
       from rosters r join roster_players p on p.roster_id = r.id where r.id = $1`,
      [wholeId],
    );
    expect(
      whole.primary_color === "#1a2b3c" && whole.heard_as.join() === "fafitaga" && whole.storyline === "Two picks last week",
      "save_roster() writes and keeps colour, heard_as and storyline",
      `save_roster() left ${JSON.stringify(whole)}`,
    );
    const {
      rows: [{ stats }],
    } = await app.query(`select public.clean_season_stats('{"int_td": 1, "fr_td": 2, "x": 3}'::jsonb) as stats`);
    expect(
      JSON.stringify(stats) === JSON.stringify({ fr_td: 2, int_td: 1 }),
      "clean_season_stats() keeps int_td and fr_td",
      `clean_season_stats() gave ${JSON.stringify(stats)}`,
    );
    const {
      rows: [{ identity }],
    } = await app.query(`select public.roster_player_identity('O''Neal''s Jr', '#22') as identity`);
    expect(identity === "onealjr|22", "roster_player_identity()", `roster_player_identity() gave ${identity}`);
    await expectRefused(
      app,
      "save_roster() with a storyline over 80 characters",
      `select public.save_roster($1, $2::jsonb, $3::jsonb)`,
      [userId, JSON.stringify({ school: "Whole High", sport: "football" }), JSON.stringify([{ last_name: "A", storyline: "x".repeat(81) }])],
      ["P0001"],
    );
    await expectRefused(
      app,
      "save_roster() with a bad team colour",
      `select public.save_roster($1, $2::jsonb, '[]'::jsonb)`,
      [userId, JSON.stringify({ school: "Whole High", sport: "football", primary_color: "red" })],
      ["P0001"],
    );
    await expectRefused(
      app,
      "save_roster() with 9 heard-as forms",
      `select public.save_roster($1, $2::jsonb, $3::jsonb)`,
      [userId, JSON.stringify({ school: "Whole High", sport: "football" }), JSON.stringify([{ last_name: "A", heard_as: Array(9).fill("a") }])],
      ["P0001"],
    );
    await expectRefused(
      app,
      "save_roster() renaming another owner's team",
      `select public.save_roster($1, $2::jsonb, '[]'::jsonb)`,
      [otherId, JSON.stringify({ id: wholeId, school: "Taken", sport: "football" })],
      ["P0001"],
    );

    console.log("• app_events: new names and the daily cap stamp (0007, 0009)");
    const {
      rows: [{ received_at: receivedAt }],
    } = await app.query(
      `insert into app_events (owner_id, name, env, app_version, session_id, props)
       values ($1, 'stats.play_discarded', 'preview', 'abc1234', gen_random_uuid(), '{}') returning received_at`,
      [userId],
    );
    await app.query(
      `insert into app_events (owner_id, name, env, app_version, session_id)
       values ($1, 'prep.heard_as_accepted', 'preview', 'abc1234', gen_random_uuid())`,
      [userId],
    );
    expect(receivedAt !== null, "insert the new event names (received_at stamped)", "received_at not stamped");

    console.log("• usage_begin / usage_finish (0009, 0017)");
    const begin = async (owner, route) =>
      (await app.query("select public.usage_begin($1, $2) as reply", [owner, route])).rows[0].reply;
    const reserved = await begin(userId, "roster_import");
    expect(
      reserved.ok === true && typeof reserved.id === "string" && typeof reserved.nonce === "string",
      "usage_begin() reserves a row",
      `usage_begin() said ${JSON.stringify(reserved)}`,
    );
    // 0017: no wait between two calls.
    const again = await begin(userId, "roster_import");
    expect(
      again.ok === true && again.id !== reserved.id,
      "usage_begin() takes a second call straight away (0017)",
      `second usage_begin() said ${JSON.stringify(again)}`,
    );
    const signedOut = await begin(null, "livestats");
    const unknown = await begin(userId, "nope");
    expect(
      signedOut.code === "signed_out" && unknown.code === "unknown_route",
      "usage_begin() answers signed_out and unknown_route",
      `usage_begin() said ${JSON.stringify(signedOut)} / ${JSON.stringify(unknown)}`,
    );
    const finish = (owner, id, nonce, cost) =>
      app.query("select public.usage_finish($1, $2, $3, true, 'anthropic', 100, 20, 0, $4, 900)", [owner, id, nonce, cost]);
    await finish(otherId, reserved.id, reserved.nonce, 1);
    await finish(userId, reserved.id, otherId, 1);
    const {
      rows: [untouched],
    } = await app.query("select finished_at from usage where id = $1", [reserved.id]);
    expect(
      untouched.finished_at === null,
      "usage_finish() by another owner, or with a wrong nonce, changes nothing",
      "usage_finish() finished someone else's row",
    );
    await finish(userId, reserved.id, reserved.nonce, 99);
    const {
      rows: [finished],
    } = await app.query("select finished_at, cost_usd, ok from usage where id = $1", [reserved.id]);
    expect(
      finished.finished_at !== null && Number(finished.cost_usd) === 5 && finished.ok === true,
      "usage_finish() records the call, cost held to the route's ceiling",
      `usage_finish() left ${JSON.stringify(finished)}`,
    );
    // 0017: $8 a day per account. $5 so far; a second $5 call puts it over.
    await finish(userId, again.id, again.nonce, 5);
    const capped = await begin(userId, "roster_import");
    const cards = await begin(userId, "deepgram_token");
    expect(
      capped.ok === false && capped.code === "daily_cap" && capped.retry_after_s >= 1 && cards.ok === true,
      "usage_begin() stops an account at $8 a day, never its Deepgram token (0017)",
      `usage_begin() said ${JSON.stringify(capped)} / ${JSON.stringify(cards)}`,
    );
    await app.query("insert into usage (owner_id, route) values ($1, 'livestats')", [userId]);
    expect(true, "insert usage");

    console.log("• shared game logs (0008)");
    const share = (owner) =>
      app.query("select public.share_game_log($1, 'football', true, 2, 10, 1, false, 'H4sI') as id", [owner]);
    const {
      rows: [{ id: sharedId }],
    } = await share(userId);
    const {
      rows: [hashed],
    } = await app.query(
      "select owner_hash = public.shared_log_owner_hash($2) as mine, owner_hash = public.shared_log_owner_hash($3) as theirs from shared_game_logs where id = $1",
      [sharedId, userId, otherId],
    );
    expect(hashed.mine && !hashed.theirs, "share_game_log() stamps the sharer's owner_hash", "owner_hash is wrong");
    for (let i = 0; i < 4; i += 1) await share(userId);
    await expectRefused(app, "a 6th shared log in 24 hours", "select public.share_game_log($1, null, false, 2, 1, 0, false, 'x')", [userId], ["P0001"]);
    await expectRefused(app, "share_game_log() signed out", "select public.share_game_log(null, null, false, 2, 1, 0, false, 'x')", [], ["42501"]);
    await expectRefused(
      app,
      "a shared log over 6 million characters",
      "select public.share_game_log($1, null, false, 2, 1, 0, false, repeat('x', 6000001))",
      [otherId],
      ["23514"],
    );
    await app.query(
      "insert into shared_game_logs (scrub_version, records, log_gz_b64, owner_hash) values (2, 1, 'x', public.shared_log_owner_hash($1))",
      [otherId],
    );
    await app.query("select public.delete_expired_shared_logs()");
    expect(true, "insert shared_game_logs; delete_expired_shared_logs()");

    console.log("• upload consent and client errors (0010)");
    const {
      rows: [{ at: consentAt }],
    } = await app.query("select public.accept_upload_terms($1) as at", [userId]);
    const {
      rows: [{ at: consentAgain }],
    } = await app.query("select public.accept_upload_terms($1) as at", [userId]);
    const {
      rows: [{ accepted_upload_terms_at: otherConsent }],
    } = await app.query("select accepted_upload_terms_at from users where id = $1", [otherId]);
    expect(
      consentAt !== null && consentAgain.getTime() === consentAt.getTime() && otherConsent === null,
      "accept_upload_terms() stamps only its owner, once",
      `accept_upload_terms() gave ${consentAt} / ${consentAgain}, other ${otherConsent}`,
    );
    await expectRefused(app, "accept_upload_terms() signed out", "select public.accept_upload_terms(null)", [], ["42501"]);
    const recordError = async (owner, env) =>
      (
        await app.query("select public.record_client_error($1, $2, 'abc1234', '/teams', 'TypeError', 'x is undefined', 'd1') as ok", [
          owner,
          env,
        ])
      ).rows[0].ok;
    expect(
      (await recordError(userId, "production")) === true &&
        (await recordError(userId, "staging")) === false &&
        (await recordError(null, "production")) === false,
      "record_client_error() writes for an owner and a known env only",
      "record_client_error() answered wrongly",
    );
    for (let i = 0; i < 19; i += 1) await recordError(userId, "preview");
    expect(
      (await recordError(userId, "preview")) === false && (await recordError(otherId, "preview")) === true,
      "record_client_error() stops at 20 an hour per account",
      "record_client_error() hourly limit not per account",
    );
    await app.query("insert into client_errors (owner_id, env) values ($1, 'preview')", [userId]);
    await app.query("select public.delete_old_client_errors()");
    expect(true, "insert client_errors; delete_old_client_errors()");

    console.log("• email/password accounts and their tokens (0016)");
    const passwordEmail = `probe-pw-${Date.now()}@example.com`;
    const {
      rows: [{ id: passwordUser }],
    } = await app.query(`insert into users (email, password_hash) values ($1, 'scrypt$probe') returning id`, [passwordEmail]);
    await app.query(
      `insert into email_tokens (token_hash, user_id, purpose, expires_at) values ($1, $2, 'reset', now() + interval '1 hour')`,
      ["b".repeat(64), passwordUser],
    );
    const {
      rows: [used],
    } = await app.query("update email_tokens set used_at = now() where token_hash = $1 and used_at is null returning user_id", ["b".repeat(64)]);
    expect(used?.user_id === passwordUser, "insert and consume email_tokens", "email_tokens consume failed");
    await expectRefused(app, "a user with neither Google nor a password", "insert into users (email) values ('nobody@example.com')", [], ["23514"]);
    await expectRefused(
      app,
      "a second account on the same address, in other case",
      "insert into users (email, password_hash) values (upper($1), 'scrypt$probe')",
      [passwordEmail],
      ["23505"],
    );

    console.log("• the off switch and delete_my_account (0011, 0013)");
    await app.query("update users set approved = false where id = $1", [otherId]);
    const off = await begin(otherId, "deepgram_token");
    expect(off.code === "not_approved", "usage_begin() refuses a switched-off account", `usage_begin() said ${JSON.stringify(off)}`);
    await expectRefused(app, "share_game_log() for a switched-off account", "select public.share_game_log($1, null, false, 2, 1, 0, false, 'x')", [otherId], ["42501"]);
    await app.query("update users set approved = true where id = $1", [otherId]);
    await begin(otherId, "livestats");
    await share(otherId);
    await app.query(`select public.save_roster($1, '{"school": "Other High", "sport": "football"}'::jsonb, '[]'::jsonb)`, [otherId]);
    await app.query("select public.delete_my_account($1)", [otherId]);
    const {
      rows: [left],
    } = await app.query(
      `select
         (select count(*)::int from users where id = $1) as other_users,
         (select count(*)::int from rosters where owner_id = $1) as other_rosters,
         (select count(*)::int from usage where owner_id = $1) as other_usage,
         (select count(*)::int from client_errors where owner_id = $1) as other_errors,
         (select count(*)::int from shared_game_logs where owner_hash = public.shared_log_owner_hash($1)) as other_logs,
         (select count(*)::int from shared_game_logs where owner_hash = public.shared_log_owner_hash($2)) as my_logs,
         (select count(*)::int from rosters where owner_id = $2) as my_rosters`,
      [otherId, userId],
    );
    expect(
      left.other_users + left.other_rosters + left.other_usage + left.other_errors + left.other_logs === 0 &&
        left.my_logs === 5 &&
        left.my_rosters === 2,
      "delete_my_account() removes that account and its shared logs, and nobody else's",
      `after delete_my_account(): ${JSON.stringify(left)}`,
    );
    await expectRefused(app, "delete_my_account() signed out", "select public.delete_my_account(null)", [], ["42501"]);
  } catch (err) {
    expect(false, "", `runtime query failed: ${err.code} ${err.message}`);
  }
  await app.query("rollback");

  console.log("• DDL and owner-only objects");
  await app.query("begin");
  await expectRefused(app, "create table", "create table probe_ddl (id int)", [], ["42501"]);
  await expectRefused(app, "alter table users", "alter table users add column probe int", [], ["42501"]);
  await expectRefused(app, "drop table rosters", "drop table rosters", [], ["42501"]);
  await expectRefused(app, "truncate app_events", "truncate app_events", [], ["42501"]);
  await expectRefused(app, "read schema_migrations", "select * from schema_migrations", [], ["42501"]);
  await expectRefused(app, "create role", "create role probe_role", [], ["42501"]);
  await app.query("rollback");

  console.log("• default privileges cover tables added by later migrations");
  await owner.query("create table if not exists probe_default_privs (id serial primary key, v text)");
  try {
    await app.query(`insert into probe_default_privs (v) values ('x')`);
    const { rowCount } = await app.query("select 1 from probe_default_privs");
    expect(rowCount === 1, "app can read/write a newly created table", "new table row not visible");
  } catch (err) {
    expect(false, "", `new table not accessible: ${err.code} ${err.message}`);
  } finally {
    await owner.query("drop table if exists probe_default_privs");
  }
} finally {
  await app.end();
  await owner.end();
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall app-role checks passed");
process.exit(failures ? 1 : 0);
