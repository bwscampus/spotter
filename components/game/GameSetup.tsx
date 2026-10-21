"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { BrowserCheck } from "@/components/live/BrowserCheck";
import { Button, TextLink } from "@/components/ui/Button";
import { Input, LABEL, Select } from "@/components/ui/Field";
import { Panel } from "@/components/ui/Panel";
import { ErrorRow, RowList, WarningRow } from "@/components/ui/Rows";
import { Switch } from "@/components/ui/Switch";
import { SHARE_NOTE, setShareChoice } from "@/lib/log/shareLog";
import { Toolbar, ToolbarMeta } from "@/components/ui/Toolbar";
import { setGameId, track } from "@/lib/analytics/track";
import { buildSnapshot, loadGame, type LoadedGame, type Wearing } from "@/lib/game/buildGame";
import { beginGame, endGame } from "@/lib/game/calledGames";
import { namesHref, soundCheckHref, stepHref, type GameSport } from "@/lib/game/setupReturn";
import { namesSummary, setupWarnings } from "@/lib/game/setupWarnings";
import { SOUND_CHECK_PER_TEAM } from "@/lib/game/soundCheck";
import {
  gameTitle,
  getGameSnapshot,
  getServerGameSnapshot,
  subscribeGameSnapshot,
  writeGameSnapshot,
} from "@/lib/game/snapshot";
import { describeTeam, isSport, type TeamSummary } from "@/lib/rosters/types";
import { todayIso } from "@/lib/stats/review";
import { api } from "@/lib/apiClient";
import { dayLabel, plural } from "@/lib/ui/format";

type Side = "away" | "home";
/** Away first, which is the order a scoreboard reads and the order the live screen splits in. */
const SIDES: Side[] = ["away", "home"];
const SIDE_LABEL: Record<Side, string> = { away: "Away", home: "Home" };

/**
 * The teams a game of this sport can pick (Jed, Oct 21): volleyball's are its
 * own; football's are every other team, so the list a football game offers is
 * the one it always offered.
 */
export function teamsFor(rosters: TeamSummary[], sport: GameSport): TeamSummary[] {
  return rosters.filter((roster) => (roster.sport === "volleyball") === (sport === "volleyball"));
}

/** The sport setup opens on: the URL's, else a picked volleyball team's, else football, the default. */
export function openingSport(
  rosters: TeamSummary[],
  initial: Record<Side, string | null>,
  asked: GameSport | null,
): GameSport {
  if (asked === "volleyball") return asked;
  const picked = rosters.filter((roster) => roster.id === initial.away || roster.id === initial.home);
  return picked.some((roster) => roster.sport === "volleyball") ? "volleyball" : "football";
}

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
 * No live stats on main (Jed, Oct 20: "no live stats at all. Like not even an
 * option. Live stats stays on testrun2."): there is no switch, every game is
 * names only, and testrun2 keeps the switch, the Out tonight panel and the
 * stats loop.
 *
 * `initialPicks` comes from the URL, which is how adding a team or updating
 * stats comes back here with the teams already picked (lib/game/setupReturn.ts).
 */
export function GameSetup({
  rosters: saved,
  initialPicks = { away: null, home: null },
  initialSport = null,
}: {
  rosters: TeamSummary[];
  initialPicks?: Record<Side, string | null>;
  /** "volleyball" when the URL said so (?sport=volleyball); football otherwise. */
  initialSport?: GameSport | null;
}) {
  const router = useRouter();
  const [sport, setSport] = useState<GameSport>(() => openingSport(saved, initialPicks, initialSport));
  const rosters = teamsFor(saved, sport);
  const [picked, setPicked] = useState<Record<Side, string>>(() => openingPicks(rosters, initialPicks));
  const [loaded, setLoaded] = useState<LoadedGame | null>(null);
  // Both teams already picked on arrival means a load starts straight away.
  const [loading, setLoading] = useState(() => Boolean(picked.away && picked.home));
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  // Kept here rather than on the roster: which side wears white is a fact about
  // tonight, not about the school.
  const [wearing, setWearing] = useState<Wearing>({ home: "", away: "" });
  // Share a scrubbed copy of the game's log at the end (lib/log/shareLog.ts).
  // On by default, every game (Jed, Oct 5): the announcer can turn it off here
  // or in the live screen's menu until the game ends.
  const [share, setShare] = useState(true);
  // Only the newest pick's load may land, or a slow first answer could
  // overwrite the second.
  const loadSeq = useRef(0);

  const current = useSyncExternalStore(subscribeGameSnapshot, getGameSnapshot, getServerGameSnapshot);

  // Another sport offers other teams, so the picks and whatever they loaded go.
  const chooseSport = (next: GameSport) => {
    if (next === sport) return;
    setSport(next);
    setPicked({ away: "", home: "" });
    setLoaded(null);
    setError(null);
    loadSeq.current++;
    setLoading(false);
  };

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

  // One click on a bench name that sounds like a star's: spotting off on the
  // saved roster, the way the team page sets it, then the game is built again
  // from the rosters, which is what Refresh rosters does during a game.
  const [spottingOff, setSpottingOff] = useState<string | null>(null);
  const spotOff = async (playerId: string) => {
    if (!picked.home || !picked.away) return;
    setSpottingOff(playerId);
    setError(null);
    const written = await api("PATCH", `/api/players/${encodeURIComponent(playerId)}`, { spot_mode: "off" });
    if (!written.ok) {
      setSpottingOff(null);
      setError("Could not change that player's spotting. Check the connection and try again, or set it on the team page.");
      return;
    }
    setLoading(true);
    await load(picked.home, picked.away);
    setSpottingOff(null);
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
    if (current) await endGame(current, undefined, { shareInBackground: true });

    // Made here rather than by the database, so the browser log has a game to
    // belong to even if the row cannot be written.
    const gameId = crypto.randomUUID();
    // Names only: main has no live stats.
    const statsEnabled = false;
    setShareChoice(gameId, share);
    const recorded = await beginGame(loaded, gameId, statsEnabled);
    const snapshot = buildSnapshot(loaded, { wearing, keytermBoost, gameId, recorded, statsEnabled });

    if (!writeGameSnapshot(snapshot)) {
      setStarting(false);
      setError("Could not save the game in this browser. Check that site storage is allowed, then try again.");
      return;
    }

    setGameId(gameId);
    track("game.started", {
      sport: isSport(snapshot.sport) ? snapshot.sport : null,
      stats: snapshot.statsEnabled,
      stats_auto: snapshot.statsEnabled && snapshot.statsAuto === true,
      setup_warnings: loaded.teamSounds.length,
      keyterms: snapshot.keyterms.length,
    });
    router.push("/live");
  };

  return (
    <SetupScreen
      rosters={rosters}
      sport={sport}
      onSport={chooseSport}
      picked={picked}
      onPick={pick}
      loaded={loading ? null : loaded}
      loading={loading}
      error={error}
      current={current ? gameTitle(current) : null}
      wearing={wearing}
      onWearing={setWearing}
      share={share}
      onShare={setShare}
      starting={starting}
      onSpotOff={(id) => void spotOff(id)}
      spottingOff={spottingOff}
      onStart={(boost) => void start(boost)}
    />
  );
}

/** A loaded side as the picker lists it, for the Summary a test renders. */
function sideSummary(side: LoadedGame["home"]): TeamSummary {
  return {
    id: side.id,
    school: side.school,
    mascot: side.mascot,
    sport: side.sport,
    gender: null,
    level: null,
    season: null,
    updated_at: "",
    playerCount: side.playerCount,
    statsAsOf: side.statsAsOf,
  };
}

/**
 * Setup for two loaded rosters: the warnings, the share switch and Start. Exported
 * so a test can read what the announcer is shown; it is the setup screen with
 * those two teams picked.
 */
export function Summary({
  loaded,
  wearing,
  onWearing,
  share = true,
  onShare = () => undefined,
  starting,
  onStart,
  onSpotOff,
  spottingOff = null,
  today = todayIso(),
}: {
  loaded: LoadedGame;
  wearing: Wearing;
  onWearing: (next: Wearing) => void;
  share?: boolean;
  onShare?: (next: boolean) => void;
  starting: boolean;
  onStart: (keytermBoost: boolean) => void;
  /** Turns a player's spotting off on the saved roster and loads the game again. Absent where there is no roster to write to. */
  onSpotOff?: (playerId: string) => void;
  /** The player whose spotting is being turned off right now. */
  spottingOff?: string | null;
  /** "YYYY-MM-DD" in the announcer's time zone. A prop so a test can fix the day. */
  today?: string;
}) {
  return (
    <SetupScreen
      rosters={[sideSummary(loaded.away), sideSummary(loaded.home)]}
      sport={loaded.sport === "volleyball" ? "volleyball" : "football"}
      onSport={() => undefined}
      picked={{ away: loaded.away.id, home: loaded.home.id }}
      onPick={() => undefined}
      loaded={loaded}
      loading={false}
      error={null}
      current={null}
      wearing={wearing}
      onWearing={onWearing}
      share={share}
      onShare={onShare}
      starting={starting}
      onStart={onStart}
      onSpotOff={onSpotOff}
      spottingOff={spottingOff}
      today={today}
    />
  );
}

/**
 * The setup screen (docs/UI_STYLE.md, A6): the toolbar with Start, the away
 * team's panel left and the home team's right with their own warnings, the
 * warnings about both, the link to the names, what each side wears tonight,
 * and the share switch and sound check.
 */
function SetupScreen({
  rosters,
  sport,
  onSport,
  picked,
  onPick,
  loaded,
  loading,
  error,
  current,
  wearing,
  onWearing,
  share,
  onShare,
  starting,
  onStart,
  onSpotOff,
  spottingOff = null,
  today = todayIso(),
}: {
  rosters: TeamSummary[];
  sport: GameSport;
  onSport: (sport: GameSport) => void;
  picked: Record<Side, string>;
  onPick: (side: Side, id: string) => void;
  loaded: LoadedGame | null;
  loading: boolean;
  error: string | null;
  /** The title of the game still open in this browser, or null. */
  current: string | null;
  wearing: Wearing;
  onWearing: (next: Wearing) => void;
  share: boolean;
  onShare: (next: boolean) => void;
  starting: boolean;
  onStart: (keytermBoost: boolean) => void;
  onSpotOff?: (playerId: string) => void;
  spottingOff?: string | null;
  today?: string;
}) {
  const team = (side: Side) => rosters.find((roster) => roster.id === picked[side]) ?? null;
  const away = team("away");
  const home = team("home");
  const names = namesHref({ away: picked.away || null, home: picked.home || null });
  const drops = loaded?.lookAlikeDrops ?? [];
  const warnings = loaded ? setupWarnings(loaded, today, names) : [];
  const warningCount = warnings.length + drops.length;
  const both = warnings.filter((warning) => warning.side === "both");
  const tooMany = loaded?.keyterm.kind === "too_many";
  const volleyball = sport === "volleyball";
  const kind = volleyball ? "volleyball " : "";
  const schoolOf = (side: Side) => (side === "home" ? loaded?.home.school : loaded?.away.school) ?? team(side)?.school ?? SIDE_LABEL[side];

  return (
    <>
      <Toolbar
        title="New game"
        actions={
          <>
            {warningCount > 0 && (
              <span className="text-[12px] text-amber-text">
                {warningCount} {warningCount === 1 ? "warning" : "warnings"}. None of them stop you starting.
              </span>
            )}
            <Button variant="primary" disabled={!loaded || starting} onClick={() => onStart(!tooMany)}>
              {starting ? "Starting..." : tooMany ? "Start without the name boost" : "Start"}
            </Button>
          </>
        }
      >
        {away && home && (
          <ToolbarMeta>
            {away.school} at {home.school}
          </ToolbarMeta>
        )}
      </Toolbar>

      <div className="flex flex-col gap-4 p-4">
        <BrowserCheck look="dash" />
        {current && (
          <RowList className="rounded-[3px] border border-line">
            <WarningRow
              text={`${current} is still open. Starting a new game ends it and saves its counts.`}
              fix={<TextLink href="/live">Back to it</TextLink>}
            />
          </RowList>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <label className="flex items-center gap-2">
            <span className={LABEL}>Sport</span>
            <Select className="w-40 font-semibold" value={sport} onChange={(event) => onSport(event.target.value === "volleyball" ? "volleyball" : "football")}>
              <option value="football">Football</option>
              <option value="volleyball">Volleyball</option>
            </Select>
          </label>
          {volleyball && (
            <span className="text-muted">
              Names and the season stats you uploaded. The cards stay as they are all match; nothing updates during play.
            </span>
          )}
        </div>

        {rosters.length < 2 && (
          <p className="text-muted">
            A game needs two saved {kind}teams. Add {rosters.length === 0 ? "them" : "the other one"} here:{" "}
            {volleyball
              ? "the roster with its season stats, and StatCast brings you back with the team picked."
              : "the roster, then its season stats, and StatCast brings you back with the team picked."}
          </p>
        )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {SIDES.map((side) => {
            const picks = team(side);
            const loadedSide = loaded ? (side === "home" ? loaded.home : loaded.away) : null;
            const players = loadedSide?.playerCount ?? picks?.playerCount ?? null;
            const asOf = loadedSide ? loadedSide.statsAsOf : (picks?.statsAsOf ?? null);
            const own = warnings.filter((warning) => warning.side === side);
            return (
              <Panel key={side} heading={`${SIDE_LABEL[side]} team`}>
                <div className="flex flex-col gap-2 p-3">
                  <label className="flex flex-col gap-1">
                    <span className="sr-only">{SIDE_LABEL[side]} team</span>
                    <Select className="w-full font-semibold" value={picked[side]} onChange={(event) => onPick(side, event.target.value)}>
                      <option value="">{rosters.length === 0 ? `No saved ${kind}teams yet` : `Pick the ${side} team`}</option>
                      {rosters.map((roster) => (
                        <option key={roster.id} value={roster.id}>
                          {describeTeam(roster)} ({roster.playerCount})
                        </option>
                      ))}
                    </Select>
                  </label>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <TextLink href={stepHref("/teams/new", { side, away: picked.away || null, home: picked.home || null, sport })}>
                      + Add a team
                    </TextLink>
                    {picks && players !== null && (
                      <span className="text-muted">
                        {plural(players, "player")}. {asOf ? `Stats as of ${dayLabel(asOf)}.` : "No season stats."}
                      </span>
                    )}
                    {picks && <TextLink href={`/teams/${picks.id}`}>Open team</TextLink>}
                  </div>
                </div>
                {own.length > 0 && (
                  <RowList className="border-t border-line">
                    {own.map((warning) => (
                      <WarningRow
                        key={warning.text}
                        text={warning.text}
                        fix={warning.fix && <TextLink href={warning.fix.href}>{warning.fix.label}</TextLink>}
                      />
                    ))}
                  </RowList>
                )}
              </Panel>
            );
          })}
        </div>

        {loading && <p className="text-muted">Reading both rosters and checking the names...</p>}
        {error && <ErrorRow className="px-0" text={error} />}

        {loaded && (
          <>
            {(both.length > 0 || drops.length > 0 || loaded.keyterm.kind === "trimmed") && (
              <RowList className="rounded-[3px] border border-line">
                {both.map((warning) => (
                  <WarningRow
                    key={warning.text}
                    text={warning.text}
                    fix={warning.fix && <TextLink href={warning.fix.href}>{warning.fix.label}</TextLink>}
                  />
                ))}
                {/* Bench names that sound like a star's: left out of the boost tonight, with spotting off one click away. */}
                {drops.map((drop) => (
                  <WarningRow
                    key={drop.low}
                    text={`Bench name that sounds like a star: ${drop.low} sounds like ${drop.high} (called ${drop.highRate} ${drop.highRate === 1 ? "time" : "times"} a game${
                      drop.lowRate > 0 ? `, against ${drop.lowRate}` : ", against none"
                    }), so it is left out of the name boost tonight. If ${drop.low} will not play, turn spotting off and the card cannot go up by mistake.`}
                    fix={
                      onSpotOff && (
                        <span className="flex gap-2">
                          {drop.players.map((player) => (
                            <Button
                              key={`${player.side}-${player.jersey ?? ""}-${player.last_name}`}
                              disabled={!player.id || spottingOff !== null}
                              onClick={() => player.id && onSpotOff(player.id)}
                            >
                              {spottingOff === player.id
                                ? "Turning off..."
                                : `Spotting off${drop.players.length > 1 ? ` #${player.jersey ?? "?"}` : ""}`}
                            </Button>
                          ))}
                        </span>
                      )
                    }
                  />
                ))}
                {loaded.keyterm.kind === "trimmed" && (
                  <p className="flex min-h-8 items-center gap-2 px-3">
                    <span className="font-semibold">
                      The name boost holds {loaded.keyterm.keyterms.length} of these {loaded.keyterm.total} names.
                    </span>
                    <span className="min-w-0 truncate text-muted">
                      It goes to the players called most on each team, from their season stats. StatCast still listens for
                      every name; the rest are just heard without the boost.
                    </span>
                  </p>
                )}
              </RowList>
            )}

            <p className="flex flex-wrap items-baseline gap-x-2">
              <TextLink href={names}>Names StatCast is listening for, and ones that sound alike</TextLink>
              <span className="text-[12px] text-muted">{namesSummary(loaded)}</span>
            </p>
          </>
        )}

        <Panel heading="Wearing tonight">
          <div className="flex flex-col gap-2 p-3">
            <p className="text-muted">
              Optional. Say the colour and a number, and StatCast knows the side: &quot;white 5&quot; shows that team&apos;s
              number 5. The school name and the mascot already work this way.
            </p>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {SIDES.map((side) => (
                <label key={side} className="flex items-center gap-2">
                  <span className={`${LABEL} w-[88px] shrink-0 truncate`}>{schoolOf(side)}</span>
                  <Input
                    className="w-40"
                    placeholder="white"
                    value={wearing[side] ?? ""}
                    onChange={(event) => onWearing({ ...wearing, [side]: event.target.value })}
                  />
                </label>
              ))}
            </div>
          </div>
        </Panel>

        {loaded && (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <span className="flex items-center gap-3">
                <span className={LABEL}>Share game log</span>
                <Switch checked={share} onChange={onShare} label="Share a copy of this game's log, last names kept" />
              </span>
              <TextLink href={soundCheckHref({ away: loaded.away.id, home: loaded.home.id })}>Sound check</TextLink>
            </div>
            <p className="text-muted">{SHARE_NOTE}</p>
            <p className="text-muted">
              Sound check: say each team&apos;s {SOUND_CHECK_PER_TEAM} most called names once into the mic, with
              tonight&apos;s settings. What speech recognition writes instead of a surname is saved as a &quot;heard as&quot;
              form, so the card finds the player anyway. About two minutes.
            </p>
          </div>
        )}

      </div>
    </>
  );
}
