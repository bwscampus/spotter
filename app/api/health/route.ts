// Railway's healthcheck (.railway/railway.ts). Says nothing about the environment or
// versions (API-9). It does not touch the database yet: that arrives with the
// database in security/db-auth, which makes it ping Postgres and answer 503
// when it is down.
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
