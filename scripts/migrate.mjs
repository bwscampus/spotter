// Applies db/migrations/*.sql in filename order, once each, then makes sure the
// least-privilege app role exists (Production Standard DB-2, DB-6). Adapted from
// papaspuzzles. Runs before `next start` on Railway (npm start) and via
// `npm run migrate` locally.
//
// Connects as the database owner: MIGRATION_DATABASE_URL if set, else DATABASE_URL.
// On Railway the app's own DATABASE_URL points at the restricted app_rw_login
// role, which cannot run DDL, so migrations must use the owner URL.
import { readdir, readFile } from "node:fs/promises";
import pg from "pg";
import { sslFor } from "./ssl.mjs";

const connectionString = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
if (!connectionString) {
  console.error("MIGRATION_DATABASE_URL (or DATABASE_URL) is not set.");
  process.exit(1);
}

// Group role the app runs as: read/write rows, nothing else. No DDL, no superuser,
// no BYPASSRLS. Re-applied on every deploy so tables added by later migrations are
// covered (default privileges) and drift is corrected. Idempotent. It is granted
// the public schema only, so the admin schema of metric views stays closed to it.
const APP_ROLE_SQL = `
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_rw') then
    create role app_rw nologin;
  end if;
  execute format('grant connect on database %I to app_rw', current_database());
end
$$;
alter role app_rw nologin nosuperuser nocreatedb nocreaterole nobypassrls;
revoke create on schema public from public;
grant usage on schema public to app_rw;
grant select, insert, update, delete on all tables in schema public to app_rw;
grant usage, select on all sequences in schema public to app_rw;
grant execute on all functions in schema public to app_rw;
alter default privileges in schema public grant select, insert, update, delete on tables to app_rw;
alter default privileges in schema public grant usage, select on sequences to app_rw;
alter default privileges in schema public grant execute on functions to app_rw;
-- The migration bookkeeping table is owner-only.
revoke all on schema_migrations from app_rw;
`;

// The login the app connects as. Created only when APP_DB_PASSWORD is set (Railway);
// the password is re-applied on every run so rotating it is just changing the variable.
const APP_LOGIN_SQL = `
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_rw_login') then
    create role app_rw_login login;
  end if;
end
$$;
alter role app_rw_login login inherit nosuperuser nocreatedb nocreaterole nobypassrls;
grant app_rw to app_rw_login;
`;

async function ensureAppRole(client) {
  await client.query(APP_ROLE_SQL);
  const password = process.env.APP_DB_PASSWORD;
  if (!password) {
    console.log("App role app_rw up to date (APP_DB_PASSWORD not set; app_rw_login not managed).");
    return;
  }
  await client.query(APP_LOGIN_SQL);
  // Quote server-side with %L; the statement text is never logged here.
  const { rows } = await client.query("select format('alter role app_rw_login with login password %L', $1::text) as sql", [
    password,
  ]);
  await client.query(rows[0].sql);
  console.log("App roles app_rw and app_rw_login up to date.");
}

const dir = new URL("../db/migrations/", import.meta.url);
const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();

const client = new pg.Client({ connectionString, ssl: sslFor(connectionString) });
await client.connect();

try {
  // Serialize concurrent deploys.
  await client.query("select pg_advisory_lock(5770771)");
  await client.query(
    "create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())",
  );
  // The role has to exist before a migration's trigger can ask about it.
  await client.query(`do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'app_rw') then create role app_rw nologin; end if;
  end $$;`);

  for (const file of files) {
    const { rowCount } = await client.query("select 1 from schema_migrations where name = $1", [file]);
    if (rowCount) continue;

    const sql = await readFile(new URL(file, dir), "utf8");
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query("insert into schema_migrations (name) values ($1)", [file]);
      await client.query("commit");
      console.log(`Applied migration ${file}`);
    } catch (err) {
      await client.query("rollback");
      throw err;
    }
  }
  console.log("Migrations up to date.");

  await ensureAppRole(client);
} finally {
  await client.end();
}
