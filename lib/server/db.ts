import pg, { Pool, type PoolClient, type QueryResultRow } from "pg";
import { sslFor } from "@/scripts/ssl.mjs";

// Server only. The app connects as app_rw_login, which can read and write rows
// and nothing else (scripts/migrate.mjs, DB-6). Every query is parameterised (DB-1).

// Return DATE columns as 'YYYY-MM-DD' strings instead of local-midnight Date objects.
pg.types.setTypeParser(1082, (value) => value);

let pool: Pool | null = null;

/** Lazily created connection pool. */
export function getPool(): Pool {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set.");
  pool = new Pool({ connectionString, max: 5, ssl: sslFor(connectionString) });
  return pool;
}

/** Anything that can run a query: the pool or a transaction client. */
export type Queryable = Pick<PoolClient, "query">;

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
  client: Queryable = getPool(),
): Promise<T[]> {
  const { rows } = await client.query<T>(text, params);
  return rows;
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
  client: Queryable = getPool(),
): Promise<T | null> {
  const rows = await query<T>(text, params, client);
  return rows[0] ?? null;
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}
