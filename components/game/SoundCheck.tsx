"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, TextLink } from "@/components/ui/Button";
import { ErrorRow } from "@/components/ui/Rows";
import { Toolbar, ToolbarMeta } from "@/components/ui/Toolbar";
import { track } from "@/lib/analytics/track";
import { useMicrophone } from "@/lib/audio/useMicrophone";
import { useDeepgramStream } from "@/lib/deepgram/useDeepgramStream";
import { keytermsFor, loadGame, type LoadedGame } from "@/lib/game/buildGame";
import { decideHeard, pickSoundCheck, SOUND_CHECK_WAIT_MS, type Heard, type SoundCheckName } from "@/lib/game/soundCheck";
import { checkHeardAs, withHeardAs } from "@/lib/rosters/heardAs";
import { playerIdentity } from "@/lib/rosters/identity";
import { setupHref } from "@/lib/game/setupReturn";
import { speechFailureMessage } from "@/lib/messages";
import { api } from "@/lib/apiClient";
import type { HeardAsPlayerRow } from "@/lib/server/repo/rosters";

/** A heard form stays on screen this long before the next name, so Skip can be pressed. */
const CONFIRM_MS = 2500;

/** "Heard right" stays this long. */
const RIGHT_MS = 900;

type Phase = "loading" | "failed" | "ready" | "running" | "done";

/** What happened with one name. A skipped form is one Deepgram wrote differently that the announcer threw away. */
type Outcome = { kind: "saved"; form: string } | { kind: "skipped"; form: string | null } | { kind: "right" } | { kind: "nothing" };

interface SaveResult {
  written: number;
  refused: string[];
}

/**
 * The name sound check (Part 5, Oct 4): each team's most called names, one at
 * a time, large. The announcer says the name; Spotter listens with the game's
 * own Deepgram settings and keyterms. A word that is one of the player's forms
 * is "heard right". Anything else Deepgram wrote for the surname is kept as a
 * "heard as" form unless Skip is pressed, and written onto the saved roster at
 * the end. The decisions are lib/game/soundCheck.ts; the mic and the socket are
 * the live screen's own hooks. Space is next, Backspace is again, S is skip.
 */
export function SoundCheck({ awayId, homeId }: { awayId: string; homeId: string }) {
  const [loaded, setLoaded] = useState<LoadedGame | null>(null);
  const [names, setNames] = useState<SoundCheckName[]>([]);
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [heard, setHeard] = useState<Heard | null>(null);
  // Bumped by "again", so the wait for words starts over.
  const [attempt, setAttempt] = useState(0);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [saved, setSaved] = useState<SaveResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadGame(homeId, awayId).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setError(result.error);
        setPhase("failed");
        return;
      }
      setLoaded(result.loaded);
      setNames(pickSoundCheck(result.loaded.watchlist.entries));
      setPhase("ready");
    });
    return () => {
      cancelled = true;
    };
  }, [homeId, awayId]);

  const mic = useMicrophone();
  const connection = useDeepgramStream({
    graph: mic.graph,
    enabled: phase === "running",
    keyterms: loaded ? keytermsFor(loaded, true) : [],
    boost: mic.source === "room",
    onResults: (results) => {
      if (phase !== "running" || heard !== null || !results.is_final) return;
      const text = results.channel.alternatives[0]?.transcript ?? "";
      const name = names[index];
      if (!name || text.trim().length === 0) return;
      setHeard(decideHeard(text, name));
    },
  });
  const listening = connection.status === "open";
  // Past the last name is the saving step; no state change needed to get there.
  const saving = phase === "running" && index >= names.length;

  const advance = useCallback((outcome: Outcome) => {
    setOutcomes((before) => [...before, outcome]);
    setHeard(null);
    setIndex((before) => before + 1);
  }, []);

  // The clock on each name: wait for words, show what was heard, move on.
  useEffect(() => {
    if (phase !== "running" || index >= names.length) return;
    if (!listening) return;
    if (heard === null) {
      const timer = setTimeout(() => advance({ kind: "nothing" }), SOUND_CHECK_WAIT_MS);
      return () => clearTimeout(timer);
    }
    if (heard.kind === "nothing") {
      const timer = setTimeout(() => advance({ kind: "nothing" }), 0);
      return () => clearTimeout(timer);
    }
    const timer = setTimeout(
      () => advance(heard.kind === "right" ? { kind: "right" } : { kind: "saved", form: heard.form }),
      heard.kind === "right" ? RIGHT_MS : CONFIRM_MS,
    );
    return () => clearTimeout(timer);
  }, [phase, index, heard, attempt, listening, names.length, advance]);

  const next = useCallback(() => {
    if (heard?.kind === "different") advance({ kind: "saved", form: heard.form });
    else if (heard?.kind === "right") advance({ kind: "right" });
    else advance({ kind: "nothing" });
  }, [heard, advance]);
  const skip = useCallback(() => advance({ kind: "skipped", form: heard?.kind === "different" ? heard.form : null }), [heard, advance]);
  const again = useCallback(() => {
    setHeard(null);
    setAttempt((before) => before + 1);
  }, []);

  useEffect(() => {
    if (phase !== "running" || saving) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        next();
      } else if (event.key === "Backspace") {
        event.preventDefault();
        again();
      } else if (event.key === "Escape" || event.key.toLowerCase() === "s") {
        event.preventDefault();
        skip();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, saving, next, skip, again]);

  // The end: the forms kept go onto the saved rosters, one update per player.
  useEffect(() => {
    if (!saving) return;
    let cancelled = false;
    void saveForms(names, outcomes, { home: homeId, away: awayId }).then((result) => {
      if (cancelled) return;
      const suggested = outcomes.filter((outcome) => outcome.kind === "saved" || (outcome.kind === "skipped" && outcome.form !== null)).length;
      const skipped = suggested - result.written;
      if (suggested > 0) track("prep.heard_as_suggested", { forms: suggested });
      if (result.written > 0) track("prep.heard_as_accepted", { forms: result.written });
      if (skipped > 0) track("prep.heard_as_skipped", { forms: skipped });
      setSaved(result);
      setPhase("done");
    });
    return () => {
      cancelled = true;
    };
  }, [saving, names, outcomes, homeId, awayId]);

  // Done listening: let the mic go.
  const micOn = mic.status === "on";
  useEffect(() => {
    if (phase === "done" && micOn) mic.toggle();
    // mic.toggle is stable for the hook's lifetime; the mic object is not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, micOn]);

  const backHref = setupHref({ side: "away", away: awayId, home: homeId });
  const matchup = loaded ? `${loaded.away.school} at ${loaded.home.school}` : null;

  // The toolbar is the same in every phase: where this is, the matchup, the way back.
  const frame = (children: React.ReactNode) => (
    <>
      <Toolbar crumbs={[{ label: "New game", href: backHref }]} title="Sound check" actions={<TextLink href={backHref}>Back to setup</TextLink>}>
        {matchup && <ToolbarMeta>{matchup}</ToolbarMeta>}
      </Toolbar>
      <div className="flex flex-col gap-4 p-4">{children}</div>
    </>
  );

  if (phase === "loading") return frame(<p className="text-muted">Loading the rosters...</p>);
  if (phase === "failed") return frame(<ErrorRow className="px-0" text={error ?? "Could not load the rosters."} />);

  if (phase === "ready") {
    return frame(
      <>
        <p className="max-w-[720px] text-muted">
          {names.length} names, {loaded?.away.school} first. Each goes up large; say it the way you will on air. A name speech
          recognition writes some other way is kept as a &quot;heard as&quot; form for that player unless you skip it. Space is next, Backspace
          says it again, S skips. About two minutes.
        </p>
        {names.length === 0 && <p className="text-muted">Nobody on these rosters can be spotted, so there is nothing to check.</p>}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="primary"
            disabled={names.length === 0 || mic.status === "starting"}
            onClick={() => {
              if (mic.status !== "on") mic.toggle();
              setPhase("running");
            }}
          >
            Start the sound check
          </Button>
        </div>
        {mic.error && <ErrorRow className="px-0" text={mic.error} />}
      </>,
    );
  }

  if (saving) return frame(<p className="text-muted">Saving the heard-as forms...</p>);

  if (phase === "done") {
    const skipped = outcomes.filter((outcome) => outcome.kind === "skipped" && outcome.form !== null).length;
    const right = outcomes.filter((outcome) => outcome.kind === "right").length;
    const nothing = outcomes.filter((outcome) => outcome.kind === "nothing" || (outcome.kind === "skipped" && outcome.form === null)).length;
    return frame(
      <div className="flex flex-col gap-3" data-testid="sound-check-done">
        <p className="text-[15px] font-semibold">Done.</p>
        <ul className="flex flex-col gap-1">
          <li>
            <span className="font-num text-[12px]">{right}</span> heard right.
          </li>
          <li>
            <span className="font-num text-[12px]">{saved?.written ?? 0}</span> heard-as forms saved.
          </li>
          <li>
            <span className="font-num text-[12px]">{skipped}</span> skipped.
          </li>
          <li>
            <span className="font-num text-[12px]">{nothing}</span> with nothing heard.
          </li>
        </ul>
        {saved && saved.refused.length > 0 && (
          <div role="alert" className="flex flex-col gap-1">
            <p className="font-semibold text-amber-text">Not saved:</p>
            {saved.refused.map((reason, position) => (
              <p key={`${position}-${reason}`} className="flex items-center gap-2">
                <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-amber-dot" />
                {reason}
              </p>
            ))}
          </div>
        )}
        <TextLink href={backHref} className="self-start">
          Back to setup
        </TextLink>
      </div>,
    );
  }

  const name = names[index];
  // The note the announcer typed for how it is said, from the card the name puts up.
  const note = name
    ? (loaded?.watchlist.entries
        .find((entry) => entry.name === name.entry)
        ?.players?.find((player) => player.side === name.side && player.jersey === name.jersey)?.pronunciation ?? null)
    : null;
  const result: { tone: "green" | "amber" | "none"; text: string } = !listening
    ? { tone: "none", text: "Waiting for the connection..." }
    : heard === null
      ? { tone: "none", text: "Listening..." }
      : heard.kind === "right"
        ? { tone: "green", text: `Heard "${heard.word}". Matched.` }
        : heard.kind === "nothing"
          ? { tone: "amber", text: "Nothing heard. Say it again, or skip it." }
          : { tone: "amber", text: `Heard "${heard.form}". Kept as a heard-as form unless you skip it.` };
  const micState =
    mic.status === "on" ? (mic.activeLabel || "Mic on") : mic.status === "starting" ? "Mic starting" : mic.status === "error" ? "Mic error" : "Mic off";
  const connectionState =
    connection.status === "open"
      ? "Listening"
      : connection.status === "failed"
        ? `Speech recognition failed. ${speechFailureMessage(connection.reason)}`
        : connection.status === "reconnecting"
          ? "Reconnecting"
          : "Connecting";

  return (
    <>
      <Toolbar crumbs={[{ label: "New game", href: backHref }]} title="Sound check" actions={<TextLink href={backHref}>Back to setup</TextLink>}>
        {matchup && <ToolbarMeta>{matchup}</ToolbarMeta>}
      </Toolbar>
      <div className="flex min-h-[calc(100dvh-40px-46px)] flex-col" data-testid="sound-check">
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-8 text-center">
          <p className="text-muted">Say this name the way you will on air.</p>
          {name && (
            <>
              <p className="max-w-full break-words text-[120px] font-bold leading-none">{name.last_name}</p>
              <p className="font-num text-[13px] text-ink-2">
                {[
                  name.jersey ? `#${name.jersey}` : null,
                  name.first_name,
                  name.side === "H" ? loaded?.home.school : loaded?.away.school,
                  note,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </>
          )}
          <p className="flex items-center gap-2" aria-live="polite">
            {result.tone !== "none" && (
              <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${result.tone === "green" ? "bg-green" : "bg-amber-dot"}`} />
            )}
            <span className={result.tone === "green" ? "font-semibold text-green" : result.tone === "amber" ? "text-amber-text" : "text-muted"}>
              {result.text}
            </span>
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button variant="primary" onClick={next}>
              Next
            </Button>
            <Button onClick={again}>Again</Button>
            <Button onClick={skip}>Skip</Button>
          </div>
          <p className="text-[12px] text-muted">Space is next, Backspace says it again, S skips.</p>
          {mic.error && <ErrorRow text={mic.error} />}
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-2 text-[12px] text-muted">
          <span className="min-w-0 truncate">{micState}</span>
          <span>{connectionState}</span>
          <span className="ml-auto font-num">
            {Math.min(index + 1, names.length)} of {names.length}
          </span>
        </div>
      </div>
    </>
  );
}

/**
 * The forms kept, onto the saved rosters: each is checked against both rosters
 * the way the review screen checks a typed form (another player's name and
 * everyday words are refused, and said), then written once per player.
 */
async function saveForms(names: SoundCheckName[], outcomes: Outcome[], rosterIds: { home: string; away: string }): Promise<SaveResult> {
  const wanted: Array<{ name: SoundCheckName; form: string }> = [];
  outcomes.forEach((outcome, position) => {
    const name = names[position];
    if (outcome.kind === "saved" && name) wanted.push({ name, form: outcome.form });
  });
  if (wanted.length === 0) return { written: 0, refused: [] };

  const read = await api<{ players: HeardAsPlayerRow[] }>("GET", `/api/rosters/players?ids=${rosterIds.home},${rosterIds.away}`);
  const rows = read.ok ? read.data.players : null;
  if (!rows) return { written: 0, refused: wanted.map((each) => `"${each.form}": could not read the saved rosters.`) };

  const refused: string[] = [];
  const perRow = new Map<string, { row: (typeof rows)[number]; forms: string[] }>();
  for (const { name, form } of wanted) {
    const row = rows.find((each) => (each.roster_id === rosterIds.home ? "H" : "A") === name.side && playerIdentity(each) === playerIdentity(name));
    if (!row) {
      refused.push(`"${form}": ${name.last_name} is no longer on the saved roster.`);
      continue;
    }
    const pending = perRow.get(row.id)?.forms ?? [];
    const check = checkHeardAs(form, { ...row, heard_as: [...row.heard_as, ...pending] }, rows.filter((each) => each.id !== row.id));
    if (!check.ok) {
      refused.push(check.reason);
      continue;
    }
    perRow.set(row.id, { row, forms: [...pending, check.form] });
  }

  let written = 0;
  await Promise.all(
    [...perRow.values()].map(async ({ row, forms }) => {
      const next = forms.reduce<string[]>((list, form) => withHeardAs(list, form), row.heard_as);
      const update = await api("PATCH", `/api/players/${row.id}`, { heard_as: next });
      if (!update.ok) refused.push(`${row.last_name}: the write failed. Check the connection and run the sound check again.`);
      else written += forms.length;
    }),
  );
  return { written, refused };
}
