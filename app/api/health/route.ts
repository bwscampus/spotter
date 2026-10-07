import { queryOne } from "@/lib/server/db";

// Railway's healthcheck (.railway/railway.ts). It pings the database and answers
// 503 when it cannot, so a deploy that cannot reach Postgres never goes live
// (API-9). Says nothing about the environment or versions.
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET() {
  try {
    await queryOne("select 1");
    return Response.json({ status: "ok" }, { headers: NO_STORE });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503, headers: NO_STORE });
  }
}
