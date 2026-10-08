"use client";

import { useMemo, useState } from "react";
import { ImportPanel } from "@/components/rosters/ImportPanel";
import { Button } from "@/components/ui/Button";
import { INPUT } from "@/components/ui/Field";
import { Panel } from "@/components/ui/Panel";
import { RowList, WarningRow } from "@/components/ui/Rows";
import { MAX_STORYLINE_CHARS } from "@/lib/cards/cardFace";
import type { EditorRow } from "@/lib/rosters/editor";
import { isStorylinesResponse, storylinePlayers, type StorylinesResponse } from "@/lib/rosters/storylines";
import { plural } from "@/lib/ui/format";

/** One suggestion as the review holds it: ticked or not, and the text as edited. */
export interface StorylinePick {
  id: string;
  storyline: string;
  keep: boolean;
}

/**
 * "Other info" (Jed, Oct 8): drop in anything about the team (an article, a
 * box score, a coach's notes, last week's stats) and the model writes a storyline
 * for each player it says something about. The suggestions are shown beside
 * each player's current storyline; the ticked ones go into the table, and the
 * team's own Save keeps them.
 */
export function StorylineImport({
  rows,
  teamName,
  onApply,
}: {
  rows: readonly EditorRow[];
  /** "Estancia Eagles", for the model's context. */
  teamName: string;
  /** The ticked storylines by row key. */
  onApply: (picks: ReadonlyMap<string, string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [picks, setPicks] = useState<StorylinePick[] | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [source, setSource] = useState("");

  const players = useMemo(() => storylinePlayers(rows), [rows]);

  const read = (body: StorylinesResponse, from: string) => {
    setPicks(body.suggestions.map((suggestion) => ({ ...suggestion, keep: true })));
    setNotes(body.notes);
    setSource(from);
  };

  const change = (id: string, update: Partial<StorylinePick>) =>
    setPicks((current) => current?.map((pick) => (pick.id === id ? { ...pick, ...update } : pick)) ?? null);

  const apply = (kept: ReadonlyMap<string, string>) => {
    onApply(kept);
    setPicks(null);
    setNotes([]);
  };

  return (
    <div className="flex flex-col gap-2">
      <ImportPanel
        kind="storylines"
        endpoint="/api/storylines/extract"
        title="Other info"
        noun="file"
        layout="bar"
        open={open}
        onOpenChange={setOpen}
        barHint="Drop an article, box score or notes. Spotter writes storylines for the players it mentions."
        pastePlaceholder="Paste anything about the team: a game story, last week's box score, a coach's notes, awards, commitments."
        fields={{ players: JSON.stringify(players), team: teamName }}
        blockedBy={players.length === 0 ? "Add the roster first. Storylines are written for the players in the table." : null}
        isResult={isStorylinesResponse}
        finishedProps={(body) => ({ players_found: body.suggestions.length, warnings: body.notes.length, ...(body.pages ? { pages: body.pages } : {}) })}
        onResult={read}
      />

      {picks && (
        <StorylineReview
          source={source}
          picks={picks}
          notes={notes}
          rows={rows}
          onChange={change}
          onApply={apply}
          onDismiss={() => setPicks(null)}
        />
      )}
    </div>
  );
}

/**
 * The suggestions, each beside the player's current storyline, ticked by
 * default and editable, with the model's notes under them.
 */
export function StorylineReview({
  source,
  picks,
  notes,
  rows,
  onChange,
  onApply,
  onDismiss,
}: {
  source: string;
  picks: readonly StorylinePick[];
  notes: readonly string[];
  rows: readonly EditorRow[];
  onChange: (id: string, update: Partial<StorylinePick>) => void;
  onApply: (kept: ReadonlyMap<string, string>) => void;
  onDismiss: () => void;
}) {
  const byKey = new Map(rows.map((row) => [row.key, row]));
  // A row deleted while the file was being read has nothing to write to.
  const shown = picks.filter((pick) => byKey.has(pick.id));
  const kept = shown.filter((pick) => pick.keep && pick.storyline.trim().length > 0);

  return (
    <Panel
      heading={`Storylines from ${source || "other info"}`}
      link={<span className="text-muted">{plural(shown.length, "player")}</span>}
      bodyClassName="flex flex-col"
    >
      {shown.length === 0 && <p className="px-3 py-2 text-muted">None of these players are in the table any more.</p>}
      {shown.map((pick) => {
        const row = byKey.get(pick.id);
        if (!row) return null;
        const name = `#${row.player.jersey?.trim() || "?"} ${[row.player.first_name, row.player.last_name].filter(Boolean).join(" ")}`;
        const current = (row.player.storyline ?? "").trim();
        return (
          <label key={pick.id} className="flex items-start gap-3 border-b border-line px-3 py-2 last:border-b-0">
            <input
              type="checkbox"
              className="mt-[7px] h-4 w-4 shrink-0 accent-accent"
              checked={pick.keep}
              onChange={(event) => onChange(pick.id, { keep: event.target.checked })}
            />
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-[13px] font-semibold text-ink">{name}</span>
              <input
                className={`${INPUT} w-full`}
                aria-label={`Storyline for ${name}`}
                maxLength={MAX_STORYLINE_CHARS}
                value={pick.storyline}
                onChange={(event) => onChange(pick.id, { storyline: event.target.value })}
              />
              {current && <span className="text-[12px] text-muted">Now: {current}</span>}
            </span>
          </label>
        );
      })}
      {notes.length > 0 && (
        <RowList className="border-t border-line">
          {notes.map((note) => (
            <WarningRow key={note} text={note} />
          ))}
        </RowList>
      )}
      <div className="flex flex-wrap items-center gap-2 border-t border-line px-3 py-2">
        <Button variant="primary" disabled={kept.length === 0} onClick={() => onApply(new Map(kept.map((pick) => [pick.id, pick.storyline])))}>
          Add {plural(kept.length, "storyline")} to the table
        </Button>
        <Button onClick={onDismiss}>Dismiss</Button>
        <span className="text-[12px] text-muted">A ticked one replaces the player&apos;s current storyline. Save the team to keep them.</span>
      </div>
    </Panel>
  );
}
