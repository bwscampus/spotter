import { boothRole, type BoothRole } from "./repo/booth";

// Booth partners (Nov 15): who an account is in a booth, remembered for a few
// seconds, so the card events a laptop posts during a game do not each read
// the database. A removal or the end of the game forgets the booth at once in
// this process; another process (a deploy overlap) waits out the few seconds.

const KEEP_MS = 10_000;
const MAX_KEPT = 2_000;
const kept = new Map<string, { role: BoothRole | null; at: number }>();

export async function cachedRole(userId: string, gameId: string, now = Date.now()): Promise<BoothRole | null> {
  const key = `${gameId}:${userId}`;
  const hit = kept.get(key);
  if (hit && now - hit.at < KEEP_MS) return hit.role;
  const role = await boothRole(userId, gameId);
  if (kept.size >= MAX_KEPT) kept.clear();
  kept.set(key, { role, at: now });
  return role;
}

/** Forgets every account's role in this booth. */
export function forgetRole(gameId: string): void {
  for (const key of kept.keys()) if (key.startsWith(`${gameId}:`)) kept.delete(key);
}
