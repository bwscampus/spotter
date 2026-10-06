"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/apiClient";

/**
 * Deletes a saved team and its players, after a confirm. Row level security
 * means only the owner's delete does anything; the players go with it by
 * cascade, and a past game keeps its school names.
 */
export function DeleteTeamButton({ id, name, afterDelete }: { id: string; name: string; afterDelete?: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (!window.confirm(`Delete ${name || "this team"} and its roster? This cannot be undone.`)) return;
    setBusy(true);
    setError(null);
    const deleted = await api("DELETE", `/api/rosters/${encodeURIComponent(id)}`);
    setBusy(false);
    if (!deleted.ok) {
      setError("Could not delete. Try again.");
      return;
    }
    if (afterDelete) afterDelete();
    router.refresh();
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => void remove()}
        className="cursor-pointer text-sm text-neutral-500 hover:text-red-700 disabled:cursor-not-allowed"
      >
        {busy ? "Deleting..." : "Delete"}
      </button>
      {error && <span className="text-sm text-amber-700">{error}</span>}
    </span>
  );
}
