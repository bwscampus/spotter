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
