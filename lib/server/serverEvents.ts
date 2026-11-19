import { randomUUID } from "node:crypto";
import type { EventName } from "@/lib/analytics/events";
import { insertEvents } from "./repo/events";

/**
 * An analytics event the server records itself, for a fact only the server
 * knows (Nov 19: an email sign-up that really made an account, which the
 * browser cannot tell from one that did not, AUTH-7). Production only, like
 * POST /api/events, and never fatal: a failed write is logged by its code and
 * the request carries on. Props are codes and counts, as everywhere.
 */
export async function recordServerEvent(ownerId: string, name: EventName, props: Record<string, string | number | boolean>): Promise<void> {
  if (process.env.RAILWAY_ENVIRONMENT_NAME !== "production") return;
  try {
    const appVersion = (process.env.NEXT_PUBLIC_GIT_COMMIT || "server").slice(0, 40);
    await insertEvents(ownerId, { env: "production", appVersion, sessionId: randomUUID() }, [
      { name, at: new Date().toISOString(), game_id: null, props },
    ]);
  } catch (err) {
    console.error(`events.server: ${name} not recorded (${(err as { code?: string })?.code ?? "unknown"})`);
  }
}
