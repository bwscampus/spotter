"use client";

import { useMemo, useState, type KeyboardEvent } from "react";
import { FOOTBALL_STAT_KEYS, type FootballStatKey } from "@/lib/cards/statKeys";
import type { StatChange } from "@/lib/cards/tonight";
import type { StatsLoopState, StatsView } from "@/lib/livestats/controller";
import { amountText, header, playerLabel, playText, STRIP_LABELS } from "@/lib/livestats/describe";
import { counted, waiting, type Correction, type SessionPlay } from "@/lib/livestats/session";
import type { StatsRosterPlayer } from "@/lib/livestats/types";
import { gapLabel, withGaps } from "@/lib/log/gaps";

// =============================================================================
// Live stats on the live screen (docs/V3_DEFINITION.md 8.6, as Jed set it on
// Oct 2, and laid out as he set it on Oct 3).
//
// The latest stat is one line on the right of the bottom bar (LatestStat).
// Everything else is the Stats panel, behind a button in the top bar
// (StatsPanel): every play Spotter has read and is waiting on, front of the
// line first, each as one comma-separated item per change: "LANGAN #22 +1
// CAR, LANGAN #22 +8 RUSH YDS, OSSUETTA #17 +1 TKL". Enter or OK counts the
// front one, Backspace or Discard throws it away, and any name, amount or
// stat can be clicked and corrected first. Beside it, the counted plays,
// newest first, still correctable, and U takes back the newest.
//
// Neither can resize the stage the cards are on (G3): the bottom bar's line
// is one line, and the panel floats over the cards.
// =============================================================================

// =============================================================================
// TUNING
// =============================================================================

/** Counted plays shown, newest first (spec 8.6). */
const COUNTED_SHOWN = 5;

/** With every play counted as it is read (AUTO_OK, unattended test games), the counted list is the strip, so it shows more. */
const COUNTED_SHOWN_AUTO = 30;

/** Players offered when correcting a name, after the search. Both college rosters fit (was 120). */
const PLAYERS_LISTED = 400;

// =============================================================================

const LABEL = "text-[11px] font-semibold uppercase tracking-widest text-neutral-500";
const SMALL_BUTTON =
  "cursor-pointer rounded border px-2 py-0.5 text-xs font-semibold disabled:cursor-not-allowed disabled:text-neutral-400";

/** Why a call failed, in words for the strip. Codes stay codes everywhere else. */
function failureWords(code: string): string {
  switch (code) {
    case "missing_key":
      return "the server has no OPENROUTER_API_KEY for the stats reader";
    case "not_approved":
      return "this account is switched off";
    case "signed_out":
      return "you are signed out";
    case "claude_timeout":
      return "the reader took too long";
    case "claude_rate_limited":
    case "claude_overloaded":
      return "the reader is busy";
    case "network":
      return "no connection";
    // The spend guard's 429s and 503 (lib/usage/limits.ts).
    case "rate_limited":
      return "asked too soon after the last read";
    case "daily_cap":
      return "you've hit today's limit, which resets at midnight UTC";
    case "global_cap":
      return "Spotter has hit its daily limit for everyone, until midnight UTC";
    case "usage_unavailable":
      return "the usage check is unreachable";
    default:
      return "the reader could not read the plays";
  }
}

export function loopWords(loop: StatsLoopState): { text: string; warn: boolean } {
  switch (loop.kind) {
    case "loading":
      return { text: "Picking up where this game left off...", warn: false };
    case "off":
      return { text: "Stats off. Names work as normal.", warn: false };
    case "no_roster":
      return { text: "This game was built before live stats. Refresh rosters to turn them on.", warn: true };
    case "listening":
      return { text: "Listening for plays", warn: false };
    case "reading":
      return { text: "Reading the last plays...", warn: false };
    case "paused":
      return { text: `Stats paused: ${failureWords(loop.code)}. Trying again at the next down and distance.`, warn: true };
    case "stopped":
      return {
        text: loop.retrying
          ? `Stats failed 5 times in a row: ${failureWords(loop.code)}. Trying again every minute.`
          : `Stats stopped after 5 failures in a row: ${failureWords(loop.code)}. Turn stats off and on to try again.`,
        warn: true,
      };
  }
}

/** What a click opened: one word of one item, or a new item being added. */
interface Editing {
  playId: string;
  index: number;
  field: "player" | "stat" | "amount";
}

/** What the Stats button says: how many plays wait, and a dot when something needs a look. */
export function statsButton(view: StatsView): { label: string; warn: boolean } {
  const line = waiting(view.session).length;
  return { label: line > 0 ? `Stats · ${line}` : "Stats", warn: loopWords(view.loop).warn || line > 0 };
}

/**
 * The latest stat, one line on the right of the bottom bar: the play you
 * counted most recently, said as such ("Last counted"), or, when stats have
 * stopped or paused, why. A play still waiting for its OK is not here. Nothing to click:
 * U takes it back, and the Stats panel corrects it.
 */
export function LatestStat({ view }: { view: StatsView }) {
  const players = useMemo(() => new Map(view.roster.map((player) => [player.playerId, player])), [view.roster]);
  const status = loopWords(view.loop);
  const latest = counted(view.session)[0];
  const where = latest ? header(latest.play) : "";
  const text = status.warn
    ? status.text
    : latest
      ? `Last counted${where ? ` (${where})` : ""}: ${latest.changes.length > 0 ? playText(latest.changes, players) : "no stats on this play"}`
      : status.text;
  return (
    <p
      role="status"
      data-testid="latest-stat"
      title={text}
      className={`max-w-[45%] shrink-0 truncate text-sm ${status.warn ? "font-semibold text-amber-700" : latest ? "font-semibold text-neutral-900" : "text-neutral-500"}`}
    >
      {text}
    </p>
  );
}

export interface StatsStripProps {
  view: StatsView;
  onOk: (playId: string) => void;
  onDiscard: (playId: string) => void;
  onUndo: () => void;
  onCorrect: (playId: string, correction: Correction) => void;
  onSwitch: (on: boolean) => void;
}

/** Everything live stats has, for the panel behind the top bar's Stats button. */
export function StatsPanel({ view, onOk, onDiscard, onUndo, onCorrect, onSwitch }: StatsStripProps) {
  const [editing, setEditing] = useState<Editing | null>(null);
  const players = useMemo(() => new Map(view.roster.map((player) => [player.playerId, player])), [view.roster]);
  const line = waiting(view.session);
  const recent = counted(view.session).slice(0, view.autoOk ? COUNTED_SHOWN_AUTO : COUNTED_SHOWN);
  const status = loopWords(view.loop);

  const editedPlay = editing ? view.session.plays.find((play) => play.playId === editing.playId) : undefined;
  const editedChange = editing && editedPlay ? editedPlay.changes[editing.index] : undefined;

  const correct = (correction: Correction) => {
    if (!editing) return;
    onCorrect(editing.playId, correction);
    setEditing(null);
  };

  const add = (play: SessionPlay) => {
    const change: StatChange = {
      playerId: play.changes[0]?.playerId ?? view.roster[0]?.playerId ?? "",
      key: "tkl",
      amount: 1,
      estimated: false,
    };
    if (!change.playerId) return;
    onCorrect(play.playId, { type: "add", change });
    // Straight to the name: whoever Spotter missed is the point of adding.
    setEditing({ playId: play.playId, index: play.changes.length, field: "player" });
  };

  return (
    <section aria-label="Live stats" className="flex min-h-0 flex-col gap-2 overflow-y-auto">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
        <span className={LABEL}>Live stats</span>
        <p
          role="status"
          className={`max-w-xl truncate text-sm ${status.warn ? "font-semibold text-amber-700" : "text-neutral-600"}`}
          title={status.text}
        >
          {status.text}
        </p>
        <button
          type="button"
          onClick={(event) => {
            event.currentTarget.blur();
            onSwitch(!view.on);
          }}
          className={`${SMALL_BUTTON} border-neutral-300 text-neutral-800 hover:border-neutral-600`}
        >
          {view.on ? "Stats off" : "Stats on"}
        </button>
        {/* On every width: the keys are the whole of how a play counts. */}
        {view.autoOk ? (
          <p className="ml-auto text-xs text-neutral-500" data-testid="stats-keys">
            Every play counts as soon as it is read ·{" "}
            <kbd className="font-mono font-bold text-neutral-700">U</kbd> takes back the last one · click a name, number or
            stat to fix it
          </p>
        ) : (
          <p className="ml-auto text-xs text-neutral-500" data-testid="stats-keys">
            Nothing counts until you OK it ·{" "}
            <kbd className="font-mono font-bold text-neutral-700">Enter</kbd> or OK keeps the front play ·{" "}
            <kbd className="font-mono font-bold text-neutral-700">Backspace</kbd> or Discard drops it ·{" "}
            <kbd className="font-mono font-bold text-neutral-700">U</kbd> takes back the last one · click a name, number or
            stat to fix it
          </p>
        )}
      </div>

      {editing && editedPlay && (editedChange || editing.field === "player") && (
        <Editor
          editing={editing}
          change={editedChange}
          roster={view.roster}
          onCorrect={correct}
          onRemove={() => correct({ type: "remove", index: editing.index })}
          onClose={() => setEditing(null)}
        />
      )}

      <div
        className={`grid min-h-0 flex-1 grid-cols-1 gap-4 ${view.autoOk ? "md:grid-cols-[2fr_3fr]" : "md:grid-cols-[3fr_2fr]"}`}
      >
        <div className="flex min-h-0 flex-col">
          <span className={LABEL}>
            {view.autoOk ? "Taken back, waiting for your OK" : "Waiting for your OK"}
            {line.length > 0 ? ` · ${line.length}` : ""}
          </span>
          <ol className="mt-1 flex min-h-0 flex-col gap-1 overflow-y-auto" data-testid="stats-waiting">
            {line.length === 0 && <li className="text-sm text-neutral-400">Nothing waiting.</li>}
            {line.map((play, index) => (
              <PlayRow
                key={play.playId}
                play={play}
                players={players}
                front={index === 0}
                onEdit={(change, field) => setEditing({ playId: play.playId, index: change, field })}
                onAdd={() => add(play)}
                actions={
                  <>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.currentTarget.blur();
                        onOk(play.playId);
                      }}
                      className={`${SMALL_BUTTON} border-neutral-900 bg-neutral-900 text-white hover:bg-neutral-700`}
                    >
                      OK
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.currentTarget.blur();
                        onDiscard(play.playId);
                      }}
                      className={`${SMALL_BUTTON} border-neutral-300 text-neutral-700 hover:border-red-700 hover:text-red-700`}
                    >
                      Discard
                    </button>
                  </>
                }
              />
            ))}
          </ol>
        </div>

        <div className="flex min-h-0 flex-col">
          <span className={LABEL}>
            Counted{view.autoOk ? ` · ${counted(view.session).length}` : ""}
          </span>
          <ol className="mt-1 flex min-h-0 flex-col gap-1 overflow-y-auto" data-testid="stats-counted">
            {recent.length === 0 && <li className="text-sm text-neutral-400">Nothing counted yet.</li>}
            {/* A stretch with nothing heard sits where it fell, so the totals are visibly incomplete (Oct 4). */}
            {withGaps(recent, (play) => play.readAt, view.gaps ?? []).map((entry) =>
              entry.kind === "gap" ? (
                <li key={`gap-${entry.gap.from}`} className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800" data-testid="heard-gap">
                  {gapLabel(entry.gap)}
                </li>
              ) : (
                <PlayRow
                  key={entry.item.playId}
                  play={entry.item}
                  players={players}
                  front={false}
                  dim
                  onEdit={(change, field) => setEditing({ playId: entry.item.playId, index: change, field })}
                  onAdd={() => add(entry.item)}
                  actions={
                    entry.item === recent[0] ? (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.currentTarget.blur();
                          onUndo();
                        }}
                        className={`${SMALL_BUTTON} border-neutral-300 text-neutral-700 hover:border-neutral-600`}
                      >
                        Take back
                      </button>
                    ) : null
                  }
                />
              ),
            )}
          </ol>
        </div>
      </div>

    </section>
  );
}

/** One play: where it was, its items, what was heard, and its buttons. */
function PlayRow({
  play,
  players,
  front,
  dim = false,
  onEdit,
  onAdd,
  actions,
}: {
  play: SessionPlay;
  players: ReadonlyMap<string, StatsRosterPlayer>;
  front: boolean;
  dim?: boolean;
  onEdit: (index: number, field: Editing["field"]) => void;
  onAdd: () => void;
  actions: React.ReactNode;
}) {
  const where = header(play.play) || play.play.playType.replace(/_/g, " ");
  const rules = [...new Set(play.dropped.map((drop) => drop.rule))];
  const reasons = play.dropped
    .map((drop) => `${drop.rule}: ${drop.action} by ${drop.playerId || "nobody"}${drop.to ? ` → ${drop.to}` : ""}, ${drop.reason}`)
    .join("\n");

  return (
    <li
      className={`rounded border bg-white px-2 py-1 ${front ? "border-2 border-black" : "border-neutral-300"} ${dim ? "opacity-80" : ""}`}
      data-play={play.playId}
    >
      <div className="flex flex-wrap items-baseline gap-x-2">
        {front && <span className="text-[11px] font-black uppercase tracking-widest text-black">Next</span>}
        <span className="text-xs font-semibold text-neutral-500">{where}:</span>
        {play.play.nullified && <span className="text-xs font-semibold text-amber-700">flag, wiped out</span>}
        {rules.length > 0 && (
          <span className="text-xs font-black text-amber-700" title={reasons}>
            ! {rules.join(" ")}
          </span>
        )}
        {play.edited && <span className="text-xs text-neutral-500">corrected</span>}
        {play.updated > 0 && <span className="text-xs text-neutral-500">updated</span>}
        <span className="ml-auto flex gap-1">{actions}</span>
      </div>
      <p className="text-sm leading-6">
        {play.changes.length === 0 && <span className="text-neutral-500">No stats on this play. </span>}
        {unknownOn(play).length > 0 && (
          <span className="font-semibold text-amber-700" title="The runner or catcher could not be read; nobody is credited">
            {unknownOn(play).join(", ")} (nobody credited){" "}
          </span>
        )}
        {play.changes.map((change, index) => (
          <span key={index}>
            <Word onClick={() => onEdit(index, "player")} className="font-black uppercase">
              {playerLabel(change.playerId, players.get(change.playerId))}
            </Word>{" "}
            <Word
              onClick={() => onEdit(index, "amount")}
              className={`tabular-nums ${change.amount === null ? "font-black text-amber-700" : "font-semibold"}`}
            >
              {amountText(change)}
            </Word>{" "}
            <Word onClick={() => onEdit(index, "stat")} className="font-semibold">
              {STRIP_LABELS[change.key]}
            </Word>
            {index < play.changes.length - 1 ? ", " : " "}
          </span>
        ))}
        <button
          type="button"
          onClick={(event) => {
            event.currentTarget.blur();
            onAdd();
          }}
          className="cursor-pointer rounded px-1 text-xs font-semibold text-neutral-500 hover:bg-neutral-200 hover:text-neutral-800"
          title="Add a change Spotter missed"
        >
          + add
        </button>
      </p>
      {play.play.evidence && (
        <p className="truncate text-xs text-neutral-500" title={play.play.evidence}>
          heard: &quot;{play.play.evidence}&quot;
        </p>
      )}
    </li>
  );
}

/** "unknown carry", "unknown catch": a runner or catcher nobody could read (playerId ""). */
function unknownOn(play: SessionPlay): string[] {
  return play.play.events
    .filter((event) => event.playerId === "" && (event.action === "rush" || event.action === "reception"))
    .map((event) => (event.action === "rush" ? "unknown carry" : "unknown catch"));
}

/** One clickable word of an item. */
function Word({ onClick, className, children }: { onClick: () => void; className: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.currentTarget.blur();
        onClick();
      }}
      className={`cursor-pointer rounded px-0.5 underline decoration-neutral-300 decoration-dotted underline-offset-2 hover:bg-yellow-200 ${className}`}
    >
      {children}
    </button>
  );
}

/**
 * The correction for one word: pick the right player, pick the right stat, or
 * type the right number. At the top of the panel. Keys pressed in it stay in
 * it, so Enter saves here rather than OKing a play, and Escape closes it
 * rather than the panel.
 */
function Editor({
  editing,
  change,
  roster,
  onCorrect,
  onRemove,
  onClose,
}: {
  editing: Editing;
  change: StatChange | undefined;
  roster: readonly StatsRosterPlayer[];
  onCorrect: (correction: Correction) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [amount, setAmount] = useState(change?.amount === null || change?.amount === undefined ? "" : String(change.amount));

  const keys = (event: KeyboardEvent) => {
    // Nothing typed or pressed here reaches the live screen's keys.
    event.stopPropagation();
    if (event.key === "Escape") onClose();
  };

  const matches = useMemo(() => {
    const term = search.trim().toLowerCase().replace(/^#/, "");
    const sorted = [...roster].sort(
      (a, b) =>
        (a.side === b.side ? 0 : a.side === "away" ? -1 : 1) ||
        Number(a.jersey ?? 999) - Number(b.jersey ?? 999) ||
        a.last.localeCompare(b.last),
    );
    if (!term) return sorted.slice(0, PLAYERS_LISTED);
    return sorted
      .filter((player) => player.last.toLowerCase().includes(term) || (player.jersey ?? "") === term || (player.first ?? "").toLowerCase().includes(term))
      .slice(0, PLAYERS_LISTED);
  }, [roster, search]);

  const saveAmount = () => {
    const trimmed = amount.trim();
    if (trimmed === "" || trimmed === "?") {
      onCorrect({ type: "amount", index: editing.index, amount: null });
      return;
    }
    const value = Number(trimmed);
    if (!Number.isFinite(value)) return;
    onCorrect({ type: "amount", index: editing.index, amount: value });
  };

  const title =
    editing.field === "player" ? "Who was it?" : editing.field === "stat" ? "Which stat?" : "How many?";

  return (
    <div
      role="dialog"
      aria-label={title}
      onKeyDown={keys}
      className="flex max-h-80 w-full max-w-[28rem] flex-col gap-2 rounded-lg border-2 border-black bg-white p-3"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-black">{title}</span>
        <button type="button" onClick={onClose} className="cursor-pointer text-xs font-semibold text-neutral-500 hover:text-neutral-800">
          Close
        </button>
      </div>

      {editing.field === "player" && (
        <>
          <input
            autoFocus
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Name or number"
            className="h-8 rounded border border-neutral-300 px-2 text-sm focus:border-neutral-700 focus:outline-none"
          />
          <ul className="flex min-h-0 flex-col overflow-y-auto">
            {matches.map((player) => (
              <li key={player.playerId}>
                <button
                  type="button"
                  onClick={() => onCorrect({ type: "player", index: editing.index, playerId: player.playerId })}
                  className={`flex w-full cursor-pointer items-baseline gap-2 rounded px-2 py-0.5 text-left text-sm hover:bg-yellow-200 ${
                    change?.playerId === player.playerId ? "bg-neutral-100 font-black" : ""
                  }`}
                >
                  <span className="w-10 shrink-0 text-xs text-neutral-500">{player.side === "away" ? "Away" : "Home"}</span>
                  <span className="w-10 shrink-0 tabular-nums">#{player.jersey ?? "?"}</span>
                  <span className="font-semibold uppercase">{player.last}</span>
                  <span className="text-neutral-500">{player.first ?? ""}</span>
                  {player.position && <span className="ml-auto text-xs text-neutral-500">{player.position}</span>}
                </button>
              </li>
            ))}
            {matches.length === 0 && <li className="px-2 text-sm text-neutral-500">Nobody on either roster matches.</li>}
          </ul>
        </>
      )}

      {editing.field === "stat" && (
        <div className="grid grid-cols-3 gap-1 overflow-y-auto">
          {FOOTBALL_STAT_KEYS.filter((key): key is FootballStatKey => key !== "gp").map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => onCorrect({ type: "stat", index: editing.index, key })}
              className={`cursor-pointer rounded border px-1 py-0.5 text-xs font-semibold hover:bg-yellow-200 ${
                change?.key === key ? "border-black bg-neutral-100" : "border-neutral-300"
              }`}
            >
              {STRIP_LABELS[key]}
            </button>
          ))}
        </div>
      )}

      {editing.field === "amount" && (
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            saveAmount();
          }}
        >
          <input
            autoFocus
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="8"
            className="h-8 w-24 rounded border border-neutral-300 px-2 text-sm tabular-nums focus:border-neutral-700 focus:outline-none"
          />
          <button type="submit" className={`${SMALL_BUTTON} border-neutral-900 bg-neutral-900 text-white hover:bg-neutral-700`}>
            Save
          </button>
          <button
            type="button"
            onClick={() => onCorrect({ type: "amount", index: editing.index, amount: null })}
            className={`${SMALL_BUTTON} border-neutral-300 text-neutral-700 hover:border-neutral-600`}
            title="The yards were not said"
          >
            Not known
          </button>
        </form>
      )}

      {change && (
        <button
          type="button"
          onClick={onRemove}
          className="self-start cursor-pointer text-xs font-semibold text-red-700 hover:underline"
        >
          Remove this change
        </button>
      )}
    </div>
  );
}
