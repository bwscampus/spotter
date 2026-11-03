import { api } from "@/lib/apiClient";
import type { DraftFields } from "@/lib/game/drafts";

// =============================================================================
// Draft games from the browser (Nov 3): create, change and delete, through
// the same-origin routes under /api/drafts. Never throws; a failure is null or
// false, and the page says so.
// =============================================================================

/** A new draft's id, or null when it could not be saved. */
export async function createDraft(fields: DraftFields & { game_date: string }): Promise<string | null> {
  const result = await api<{ id: string }>("POST", "/api/drafts", fields);
  return result.ok && typeof result.data.id === "string" ? result.data.id : null;
}

export async function saveDraft(id: string, fields: DraftFields): Promise<boolean> {
  return (await api("PATCH", `/api/drafts/${encodeURIComponent(id)}`, fields)).ok;
}

export async function deleteDraft(id: string): Promise<boolean> {
  return (await api("DELETE", `/api/drafts/${encodeURIComponent(id)}`)).ok;
}
