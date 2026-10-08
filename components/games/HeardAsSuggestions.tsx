"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { track } from "@/lib/analytics/track";
import { suggestHeardAs, type HeardAsSuggestion } from "@/lib/game/heardAsSuggestions";
import { readGameLog } from "@/lib/log/gameLog";
import { checkHeardAs, withHeardAs } from "@/lib/rosters/heardAs";
import { playerIdentity } from "@/lib/rosters/identity";
import { api } from "@/lib/apiClient";
import type { HeardAsPlayerRow } from "@/lib/server/repo/rosters";

type Loaded = {
  suggestions: HeardAsSuggestion[];
  /** The saved rosters the game was built from, where an accepted form is written. */
  rosterIds: { home: string; away: string };
};

export type HeardAsState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "none" }
  | { kind: "failed" }
  | ({ kind: "ready" } & Loaded);

export type Decision =
  | { kind: "added"; to: string }
  | { kind: "skipped" }
  | { kind: "refused"; reason: string }
  | { kind: "failed" }
  | { kind: "writing" };

/**
 * Learning from the last game (docs: Part 5, Oct 4). For a game whose log is
 * still in this browser: the words Deepgram wrote three or more times that are
 * on neither roster, are not everyday words, and sound close to one roster
 * name, each with one click to add it to that player as a "heard as" form.
 *
 * The log is read only when asked, because it is thousands of records. Nothing
 * leaves the browser except the forms accepted, which go onto the saved roster
 * rows through the browser's own session; analytics get the three counts.
 */
export function useHeardAsSuggestions(gameId: string) {
  const [state, setState] = useState<HeardAsState>({ kind: "idle" });
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const load = async () => {
    setState({ kind: "loading" });
    try {
      const records = await readGameLog(gameId);
      const game = [...records].reverse().find((record) => record.kind === "game");
      const suggestions = suggestHeardAs(records);
      if (!game || game.kind !== "game" || suggestions.length === 0) {
        setState({ kind: "none" });
        return;
      }
      track("prep.heard_as_suggested", { forms: suggestions.length });
      setState({
        kind: "ready",
        suggestions,
        rosterIds: { home: game.snapshot.home.id, away: game.snapshot.away.id },
      });
    } catch {
      setState({ kind: "failed" });
    }
  };

  const decide = (word: string, decision: Decision) => setDecisions((before) => ({ ...before, [word]: decision }));

  const skip = (suggestion: HeardAsSuggestion) => {
    decide(suggestion.word, { kind: "skipped" });
    track("prep.heard_as_skipped", { forms: 1 });
  };

  const add = async (suggestion: HeardAsSuggestion, rosterIds: Loaded["rosterIds"]) => {
    decide(suggestion.word, { kind: "writing" });
    const read = await api<{ players: HeardAsPlayerRow[] }>("GET", `/api/rosters/players?ids=${rosterIds.home},${rosterIds.away}`);
    const rows = read.ok ? read.data.players : null;
    if (!rows) {
      decide(suggestion.word, { kind: "failed" });
      return;
    }
    const wanted = new Set(suggestion.players.map((player) => `${player.side}|${playerIdentity(player)}`));
    const targets = rows.filter((row) =>
      wanted.has(`${row.roster_id === rosterIds.home ? "H" : "A"}|${playerIdentity(row)}`),
    );
    if (targets.length === 0) {
      decide(suggestion.word, {
        kind: "refused",
        reason: "That player is no longer on the saved roster.",
      });
      return;
    }
    for (const target of targets) {
      const check = checkHeardAs(
        suggestion.word,
        target,
        rows.filter((row) => row.id !== target.id),
      );
      if (!check.ok) {
        decide(suggestion.word, { kind: "refused", reason: check.reason });
        track("prep.heard_as_skipped", { forms: 1 });
        return;
      }
    }
    const results = await Promise.all(
      targets.map(async (target) => {
        const written = await api("PATCH", `/api/players/${target.id}`, { heard_as: withHeardAs(target.heard_as, suggestion.word) });
        return written.ok;
      }),
    );
    if (results.every(Boolean)) {
      decide(suggestion.word, { kind: "added", to: suggestion.label });
      track("prep.heard_as_accepted", { forms: 1 });
    } else {
      decide(suggestion.word, { kind: "failed" });
    }
  };

  return { state, decisions, load, add, skip };
}

/** "Names it heard wrong", with how many once the log has been read. */
export function heardAsLabel(state: HeardAsState): string {
  if (state.kind === "ready") return `Names it heard wrong (${state.suggestions.length})`;
  if (state.kind === "none") return "Names it heard wrong (0)";
  return "Names it heard wrong";
}

/**
 * The words, one 36px line each, opened under the game's row: the word, how
 * often, who it would go to, then Add and Skip.
 */
export function HeardAsList({ suggestions }: { suggestions: ReturnType<typeof useHeardAsSuggestions> }) {
  const { state, decisions, add, skip } = suggestions;
  if (state.kind === "idle" || state.kind === "loading")
    return <p className="text-muted">Reading this game&apos;s log...</p>;
  if (state.kind === "failed") return <p className="text-red">Could not read this game&apos;s log.</p>;
  if (state.kind === "none") {
    return (
      <p className="text-muted">
        No word came up three or more times that sounds like one roster name and nothing else.
      </p>
    );
  }

  return (
    <div className="flex flex-col" data-testid="heard-as-suggestions">
      <p className="pb-1 text-[12px] text-muted">
        Words speech recognition wrote that are on neither roster and sound like one player. Add saves the word onto that player
        as a &quot;heard as&quot; form; nothing else leaves this browser.
      </p>
      <ul className="flex flex-col">
        {state.suggestions.map((suggestion) => {
          const decision = decisions[suggestion.word];
          return (
            <li key={suggestion.word} className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-num font-semibold">&quot;{suggestion.word}&quot;</span>
              <span className="font-num text-[12px]">{suggestion.times} times:</span>
              <span>add to {suggestion.label}?</span>
              {decision === undefined || decision.kind === "writing" ? (
                <>
                  <Button disabled={decision?.kind === "writing"} onClick={() => void add(suggestion, state.rosterIds)}>
                    Add
                  </Button>
                  <Button disabled={decision?.kind === "writing"} onClick={() => skip(suggestion)}>
                    Skip
                  </Button>
                </>
              ) : decision.kind === "added" ? (
                <span className="text-green">Added to {decision.to}.</span>
              ) : decision.kind === "skipped" ? (
                <span className="text-muted">Skipped.</span>
              ) : decision.kind === "refused" ? (
                <span className="text-amber-text">Not added: {decision.reason}</span>
              ) : (
                <span className="text-red">Could not write it. Check the connection and try again.</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
