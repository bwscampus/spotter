"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useApproved, WaitingNote } from "@/components/auth/Approval";
import { setGameId, track } from "@/lib/analytics/track";
import { buildSnapshot, loadGame, type LoadedGame, type Wearing } from "@/lib/game/buildGame";
import { beginGame, endGame } from "@/lib/game/calledGames";
import { stepHref } from "@/lib/game/setupReturn";
import {
  gameTitle,
  getGameSnapshot,
  getServerGameSnapshot,
  subscribeGameSnapshot,
  writeGameSnapshot,
} from "@/lib/game/snapshot";
import { staleStats } from "@/lib/game/staleStats";
import { asOfLabel } from "@/lib/cards/cardPlayer";
import { describeTeam, isSport, type TeamSummary } from "@/lib/rosters/types";
import { todayIso } from "@/lib/stats/review";

const LABEL = "text-[11px] font-semibold uppercase tracking-widest text-neutral-500";
const FIELD =
  "h-10 w-full rounded-md border border-neutral-300 bg-neutral-50 px-3 text-sm text-neutral-900 focus:border-neutral-600 focus:outline-none";
const BUTTON =
  "h-10 cursor-pointer rounded-md border border-neutral-800 bg-neutral-900 px-4 text-sm font-semibold text-white hover:bg-neutral-700 disabled:cursor-not-allowed disabled:border-neutral-300 disabled:bg-neutral-100 disabled:text-neutral-400";

type Side = "away" | "home";
/** Away first, which is the order a scoreboard reads and the order the live screen splits in. */
const SIDES: Side[] = ["away", "home"];
const SIDE_LABEL: Record<Side, string> = { away: "Away", home: "Home" };

/** Opening picks that are saved teams, and two different ones; anything else starts blank. */
function openingPicks(rosters: TeamSummary[], initial: Record<Side, string | null>): Record<Side, string> {
  const known = (id: string | null) => (id && rosters.some((roster) => roster.id === id) ? id : "");
  const away = known(initial.away);
  const home = known(initial.home);
  return away && away === home ? { away, home: "" } : { away, home };
}

/**
 * Game setup: the away roster on the left, the home roster on the right, each
 * with Add a team, the warnings, and Start. docs/V3_DEFINITION.md 7.1.
 *
 * No stats switch yet: every game is stored with stats off until item 13.
 *
 * `initialPicks` comes from the URL, which is how adding a team or updating
 * stats comes back here with the teams already picked (lib/game/setupReturn.ts).
 */
export function GameSetup({
  rosters,
  initialPicks = { away: null, home: null },
}: {
  rosters: TeamSummary[];
  initialPicks?: Record<Side, string | null>;
}) {
  const router = useRouter();
  const approved = useApproved();
  const [picked, setPicked] = useState<Record<Side, string>>(() => openingPicks(rosters, initialPicks));
  const [loaded, setLoaded] = useState<LoadedGame | null>(null);
  // Both teams already picked on arrival means a load starts straight away.
  const [loading, setLoading] = useState(() => Boolean(picked.away && picked.home));
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  // Kept here rather than on the roster: which side wears white is a fact about
  // tonight, not about the school.
  const [wearing, setWearing] = useState<Wearing>({ home: "", away: "" });
  // Only the newest pick's load may land, or a slow first answer could
  // overwrite the second.
  const loadSeq = useRef(0);

  const current = useSyncExternalStore(subscribeGameSnapshot, getGameSnapshot, getServerGameSnapshot);

  const pick = (side: Side, id: string) => {
    const next = { ...picked, [side]: id };
    setPicked(next);
    setLoaded(null);
    setError(null);
    // Whatever was loading is for the old pair now.
    loadSeq.current++;
    setLoading(false);
    if (!next.away || !next.home) return;
    if (next.away === next.home) {
      setError("Pick two different teams.");
      return;
    }
    setLoading(true);
    void load(next.home, next.away);
  };

  const load = async (homeId: string, awayId: string) => {
    const seq = ++loadSeq.current;
    const result = await loadGame(homeId, awayId);
    if (seq !== loadSeq.current) return;
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setLoaded(result.loaded);
  };

  // Back from adding a team or updating stats with both teams picked: load them.
  useEffect(() => {
    const opening = openingPicks(rosters, initialPicks);
    if (opening.away && opening.home) void load(opening.home, opening.away);
    // Once, for the picks the page opened with. Later picks load from pick().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = async (keytermBoost: boolean) => {
    if (!loaded) return;
    setStarting(true);
    setError(null);

    // One game at a time. Starting another ends the one still open, with the
    // counts it reached, so its row is not left without an end.
    if (current) await endGame(current);

    // Made here rather than by the database, so the browser log has a game to
    // belong to even if the row cannot be written.
    const gameId = crypto.randomUUID();
    const recorded = await beginGame(loaded, gameId, false);
    const snapshot = buildSnapshot(loaded, { wearing, keytermBoost, gameId, recorded });

    if (!writeGameSnapshot(snapshot)) {
      setStarting(false);
      setError("Could not save the game in this browser. Check that site storage is allowed, then try again.");
      return;
    }

    setGameId(gameId);
    track("game.started", {
      sport: isSport(snapshot.sport) ? snapshot.sport : null,
      stats: snapshot.statsEnabled,
      setup_warnings: loaded.teamSounds.length,
      keyterms: snapshot.keyterms.length,
    });
    router.push("/live");
  };

  return (
    <div className="flex flex-col gap-6">
      {current && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
          {gameTitle(current)} is still open. Starting a new game ends it and saves its counts.{" "}
          <Link href="/live" className="underline">
            Back to it
          </Link>
        </p>
      )}

      {rosters.length < 2 && (
        <p className="text-sm text-neutral-600">
          A game needs two saved teams. Add {rosters.length === 0 ? "them" : "the other one"} here: the roster, then its
          season stats, and Spotter brings you back with the team picked.
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {SIDES.map((side) => (
          <div key={side} className="flex flex-col gap-1">
            <label className="flex flex-col gap-1">
              <span className={LABEL}>{SIDE_LABEL[side]}</span>
              <select className={FIELD} value={picked[side]} onChange={(event) => pick(side, event.target.value)}>
                <option value="">{rosters.length === 0 ? "No saved teams yet" : `Pick the ${side} team`}</option>
                {rosters.map((roster) => (
                  <option key={roster.id} value={roster.id}>
                    {describeTeam(roster)} ({roster.playerCount})
                  </option>
                ))}
              </select>
            </label>
            <Link
              href={stepHref("/teams/new", { side, away: picked.away || null, home: picked.home || null })}
              className="self-start text-sm font-semibold text-neutral-700 underline decoration-neutral-300 underline-offset-2 hover:text-neutral-900"
            >
              + Add a team
            </Link>
          </div>
        ))}
      </div>

      {loading && <p className="text-sm text-neutral-500">Reading both rosters and checking the names with Deepgram...</p>}
      {error && (
        <p role="alert" className="text-sm font-semibold text-amber-700">
          {error}
        </p>
      )}

      {loaded && !loading && (
        <Summary
          loaded={loaded}
          wearing={wearing}
          onWearing={setWearing}
          starting={starting}
          approved={approved}
          onStart={(boost) => void start(boost)}
        />
      )}
    </div>
  );
}

/** The warnings and the Start button for two loaded rosters. Exported so a test can read what the announcer is shown. */
export function Summary({
  loaded,
  wearing,
  onWearing,
  starting,
  approved,
  onStart,
  today = todayIso(),
}: {
  loaded: LoadedGame;
  wearing: Wearing;
  onWearing: (next: Wearing) => void;
  starting: boolean;
  approved: boolean;
  onStart: (keytermBoost: boolean) => void;
  /** "YYYY-MM-DD" in the announcer's time zone. A prop so a test can fix the day. */
  today?: string;
}) {
  const { watchlist, collisions, keyterm, teamSounds } = loaded;
  const count = watchlist.entries.length;
  const off = loaded.home.offCount + loaded.away.offCount;
  const stale = staleStats(loaded, today);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline gap-4">
        <p className="text-2xl font-black">
          {loaded.away.school} <span className="font-normal text-neutral-400">at</span> {loaded.home.school}
        </p>
        <p className="text-sm text-neutral-500">
          {count} {count === 1 ? "name" : "names"} to listen for
          {off > 0 && ` · ${off} ${off === 1 ? "player" : "players"} with spotting off left out`}
        </p>
      </div>

      {stale.length > 0 && (
        <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {stale.map((team) => (
            <p key={team.side} className="py-0.5">
              <span className="font-semibold">
                {team.school}&apos;s season stats are {asOfLabel(team.asOf)}, {team.days} days old.
              </span>{" "}
              The cards will read those numbers on air.{" "}
              <Link
                href={stepHref(`/teams/${team.rosterId}/stats`, {
                  side: team.side,
                  away: loaded.away.id,
                  home: loaded.home.id,
                })}
                className="font-semibold underline"
              >
                Import this week&apos;s stats
              </Link>
            </p>
          ))}
        </div>
      )}

      {teamSounds.length > 0 && (
        <Section title="Names that sound like a team">
          <p className="text-neutral-500">
            Both schools and mascots are said all game. These names can go up when a team is named. Consider a
            pronunciation note or exact-only spotting for them on the team page.
          </p>
          {teamSounds.map((warning) => (
            <p key={warning.name} className={warning.verdict === "would_fire" ? "font-semibold text-amber-800" : ""}>
              <span className="font-black uppercase">{warning.name}</span>{" "}
              {warning.verdict === "would_fire" ? "goes up on" : "comes close on"}{" "}
              {warning.hits.map((hit) => `"${hit.word}"`).join(", ")}
            </p>
          ))}
        </Section>
      )}

      {loaded.sportMismatch && (
        <p className="text-sm font-semibold text-amber-700">
          These rosters are saved as different sports. The game uses the home team&apos;s.
        </p>
      )}

      {keyterm.kind === "too_many" && (
        <div role="alert" className="border-b border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-700">
          <p>Too many names for Deepgram&apos;s keyterm limit.</p>
          <p className="mt-1 font-normal">{keyterm.reason}</p>
          <p className="mt-1 font-normal">
            Spotter can still listen for every name. Only Deepgram&apos;s recognition boost is lost, so unusual
            surnames may be heard less accurately.
          </p>
        </div>
      )}
      {keyterm.kind === "unchecked" && <p className="text-sm font-semibold text-amber-700">{keyterm.message}</p>}

      <Section title="Wearing tonight">
        <p className="text-neutral-500">
          Optional. Say the colour and a number, and Spotter knows the side: &quot;white 5&quot; shows that team&apos;s
          number 5. The school name and the mascot already work this way.
        </p>
        <div className="mt-1 flex flex-wrap gap-4">
          {SIDES.map((side) => (
            <label key={side} className="flex items-center gap-2">
              <span className={LABEL}>{side === "home" ? loaded.home.school : loaded.away.school}</span>
              <input
                className="h-9 w-32 rounded-md border border-neutral-300 bg-neutral-50 px-3 text-sm text-neutral-900 focus:border-neutral-600 focus:outline-none"
                placeholder="white"
                value={wearing[side] ?? ""}
                onChange={(event) => onWearing({ ...wearing, [side]: event.target.value })}
              />
            </label>
          ))}
        </div>
      </Section>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={BUTTON}
          disabled={starting || !approved}
          onClick={() => onStart(keyterm.kind !== "too_many")}
        >
          {starting ? "Starting..." : keyterm.kind === "too_many" ? "Start without keyterm boost" : "Start"}
        </button>
        <WaitingNote />
      </div>

      {loaded.similarJerseys.length > 0 && (
        <Section title="Numbers that sound alike">
          {loaded.similarJerseys.map((pair) => (
            <p key={`${pair.a.side}${pair.a.jersey}-${pair.b.side}${pair.b.jersey}`}>
              #{pair.a.jersey} {pair.a.name} can be misheard as #{pair.b.jersey} {pair.b.name}. Spotter shows both cards
              when it hears either number.
            </p>
          ))}
        </Section>
      )}

      {watchlist.droppedParts.length > 0 && (
        <Section title="Dropped name parts">
          {watchlist.droppedParts.map((part) => (
            <p key={`${part.from}-${part.part}`}>
              {part.from} will not answer to &quot;{part.part}&quot; in this game, because {part.collidesWith} is another
              player in it.
            </p>
          ))}
        </Section>
      )}

      {collisions.length > 0 && (
        <Section title="Names that sound alike">
          {collisions.map((collision) => (
            <p key={`${collision.a}-${collision.b}`}>
              {collision.a} and {collision.b} can be heard as each other, so either can show the other. A
              pronunciation note, or exact-only spotting for one of them, on the team page can help.
            </p>
          ))}
        </Section>
      )}

      <Section title="Listening for">
        <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
          {watchlist.entries.map((entry) => (
            <li key={entry.name} className="flex flex-wrap items-baseline gap-2">
              <span className="font-black uppercase text-neutral-900">{entry.label || entry.name}</span>
              {entry.exactOnly && <span className="text-xs font-semibold text-neutral-500">exact only</span>}
              {entry.aliases.length > 0 && <span className="text-xs text-neutral-400">also {entry.aliases.join(", ")}</span>}
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className={LABEL}>{title}</p>
      <div className="mt-2 flex flex-col gap-1 text-sm text-neutral-600">{children}</div>
    </div>
  );
}
