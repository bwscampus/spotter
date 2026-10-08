"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { Button, LinkButton } from "@/components/ui/Button";
import { InlineConfirm } from "@/components/ui/Confirm";
import { api } from "@/lib/apiClient";
import { plural } from "@/lib/ui/format";

/**
 * Deletes a saved team and its players. The server deletes only the caller's
 * own team; the players go with it by cascade, and a past game keeps its
 * school names. True when it went.
 */
export async function deleteTeam(id: string): Promise<boolean> {
  return (await api("DELETE", `/api/rosters/${encodeURIComponent(id)}`)).ok;
}

/** "Delete Brentwood Eagles and its 52 players? This cannot be undone." */
export function deleteQuestion(name: string, players: number): string {
  return `Delete ${name.trim() || "this team"} and its ${plural(players, "player")}? This cannot be undone.`;
}

/**
 * Delete, confirmed in place: the button is replaced by the question, Delete
 * team and Cancel. Escape cancels. `look` is a red text link in a table row,
 * or the destructive button in a toolbar.
 */
export function DeleteTeamButton({
  id,
  name,
  players,
  afterDelete,
  look = "link",
  onAsking,
}: {
  id: string;
  name: string;
  players: number;
  afterDelete?: () => void;
  look?: "link" | "button";
  /** Told when the confirm opens and closes, so a toolbar can hide its other actions. */
  onAsking?: (asking: boolean) => void;
}) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const ask = (next: boolean) => {
    setAsking(next);
    setNote(null);
    onAsking?.(next);
  };
  const cancel = useCallback(() => {
    setAsking(false);
    setNote(null);
    onAsking?.(false);
  }, [onAsking]);

  async function remove() {
    setBusy(true);
    setNote(null);
    const ok = await deleteTeam(id);
    setBusy(false);
    if (!ok) {
      setNote("Could not delete. Check the connection and try again.");
      return;
    }
    onAsking?.(false);
    if (afterDelete) afterDelete();
    router.refresh();
  }

  if (asking) {
    return (
      <InlineConfirm
        question={deleteQuestion(name, players)}
        confirmLabel="Delete team"
        busy={busy}
        note={note}
        onConfirm={() => void remove()}
        onCancel={cancel}
      />
    );
  }

  return look === "button" ? (
    <Button variant="destructive" onClick={() => ask(true)}>
      Delete
    </Button>
  ) : (
    <LinkButton tone="red" onClick={(event) => (event.stopPropagation(), ask(true))}>
      Delete
    </LinkButton>
  );
}
