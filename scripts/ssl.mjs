// TLS for a Postgres URL (Production Standard DB-4), shared by the migration
// scripts and lib/server/db.ts.
//
// Railway's private network (*.railway.internal) and a local database need no
// TLS. Anything else must present a certificate that verifies: we never turn
// verification off, because TLS without it does not stop an impostor.
export function sslFor(url) {
  const host = new URL(url).hostname;
  const isPrivate = host.endsWith(".railway.internal") || host === "localhost" || host === "127.0.0.1";
  return isPrivate ? undefined : { rejectUnauthorized: true };
}
