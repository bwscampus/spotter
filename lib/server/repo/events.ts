import { query } from "../db";

// Analytics events (docs/V3_DEFINITION.md section 10). Codes and counts only:
// props were filtered by lib/analytics/events.ts parseBatch before they get here.

export type EventRow = { name: string; at: string; game_id: string | null; props: Record<string, unknown> };

/**
 * Records a batch for one account in one statement. A repeat
 * account.signed_up meets the unique index that keeps it to one per account
 * and is skipped, without taking the rest of the batch with it.
 */
export async function insertEvents(
  ownerId: string,
  meta: { env: "production" | "preview"; appVersion: string; sessionId: string },
  events: EventRow[],
): Promise<void> {
  await query(
    `insert into app_events (owner_id, name, at, env, app_version, session_id, game_id, props)
     select $1, e.name, e.at, $2, $3, $4, e.game_id, coalesce(e.props, '{}'::jsonb)
       from jsonb_to_recordset($5::jsonb) as e(name text, at timestamptz, game_id uuid, props jsonb)
     on conflict do nothing`,
    [ownerId, meta.env, meta.appVersion, meta.sessionId, JSON.stringify(events)],
  );
}
