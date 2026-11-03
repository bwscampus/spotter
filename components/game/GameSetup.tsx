"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { BrowserCheck } from "@/components/live/BrowserCheck";
import { Button, ButtonLink, TextLink } from "@/components/ui/Button";
import { Input, LABEL, Select } from "@/components/ui/Field";
import { Panel } from "@/components/ui/Panel";
import { ErrorRow, RowList, WarningRow } from "@/components/ui/Rows";
import { SetupWarningList } from "@/components/game/SetupWarnings";
import { Switch } from "@/components/ui/Switch";
import { SHARE_NOTE } from "@/lib/log/shareLog";
import { Toolbar, ToolbarMeta, PAGE_COLUMN } from "@/components/ui/Toolbar";
import { track } from "@/lib/analytics/track";
import { loadGame, type LoadedGame, type Wearing } from "@/lib/game/buildGame";
import { createDraft, saveDraft } from "@/lib/game/draftApi";
import type { Draft, DraftFields } from "@/lib/game/drafts";
import { namesHref, setupHref, soundCheckHref, stepHref } from "@/lib/game/setupReturn";
import { startGame } from "@/lib/game/startGame";
import { namesSummary, setupWarnings } from "@/lib/game/setupWarnings";
import { SOUND_CHECK_PER_TEAM } from "@/lib/game/soundCheck";
import { gameTitle, getGameSnapshot, getServerGameSnapshot, subscribeGameSnapshot } from "@/lib/game/snapshot";
import { describeTeam, isSport, type TeamSummary } from "@/lib/rosters/types";
import { useToday } from "@/lib/ui/useToday";
import { todayIso } from "@/lib/stats/review";
import { dayLabel, plural } from "@/lib/ui/format";

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
 * Game setup: pick the away team and the home team, check what needs a look,
 * and Start. docs/V3_DEFINITION.md 7.1. main has no live stats (Nov 1): no
 * switch, no "Check each play" box and no Out tonight panel, and every game
 * starts with stats off.
 *
 * `initialPicks` comes from the URL, which is how adding a team or updating
 * stats comes back here with the teams already picked (lib/game/setupReturn.ts).
 *
 * A draft game (Nov 3) opens here too, `/games/new?draft=…`: its date, teams,
 * what each side wears and the share switch, and every change saves back to
 * it. "Save as draft" makes one from what is picked; Start starts that same
 * draft, whose id becomes the game's.
 */
export function GameSetup({
  rosters,
  initialPicks = { away: null, home: null },
  draft = null,
}: {
  rosters: TeamSummary[];
  initialPicks?: Record<Side, string | null>;
  /** The draft game this setup was opened on, as saved. */
  draft?: Draft | null;
}) {
  const router = useRouter();
  const today = useToday();
  const [picked, setPicked] = useState<Record<Side, string>>(() => openingPicks(rosters, initialPicks));
  const [loaded, setLoaded] = useState<LoadedGame | null>(null);
  // Both teams already picked on arrival means a load starts straight away.
  const [loading, setLoading] = useState(() => Boolean(picked.away && picked.home));
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  // Kept here rather than on the roster: which side wears white is a fact about
  // tonight, not about the school.
  const [wearing, setWearing] = useState<Wearing>({ home: draft?.wearing.home ?? "", away: draft?.wearing.away ?? "" });
  // Share a scrubbed copy of the game's log at the end (lib/log/shareLog.ts).
  // On by default, every game (Jed, Oct 5): the announcer can turn it off here
  // or in the live screen's menu until the game ends.
  const [share, setShare] = useState(draft?.share ?? true);
  // The game's date (Nov 3): today until changed, or the draft's.
  const [date, setDate] = useState<string | null>(draft?.gameDate ?? null);
  const gameDate = date ?? today ?? "";
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
    // Hidden tonight belongs to the pair it was chosen for.
    setHidden([]);
    if (!next.away || !next.home) return;
    if (next.away === next.home) {
      setError("Pick two different teams.");
      return;
    }
    setLoading(true);
    void load(next.home, next.away);
  };

  const load = async (homeId: string, awayId: string, hiddenTonight: string[] = []) => {
    const seq = ++loadSeq.current;
    const result = await loadGame(homeId, awayId, hiddenTonight);
    if (seq !== loadSeq.current) return;
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setLoaded(result.loaded);
  };

  // Hidden for this game only (Nov 3, "Hide Hill tonight"): a bench name that
  // sounds like a star's is left out of tonight's game, and the game is read
  // again from the rosters, which is what Refresh rosters does during a game.
  // The saved team is untouched, so the player is back next game.
  const [hidden, setHidden] = useState<string[]>([]);
  const [hiding, setHiding] = useState<string | null>(null);
  const hideTonight = async (next: string[], playerId: string) => {
    if (!picked.home || !picked.away) return;
    setHiding(playerId);
    setHidden(next);
    setError(null);
    setLoading(true);
    await load(picked.home, picked.away, next);
    setHiding(null);
  };

  // Back from adding a team or updating stats with both teams picked: load them.
  useEffect(() => {
    const opening = openingPicks(rosters, initialPicks);
    if (opening.away && opening.home) void load(opening.home, opening.away);
    // Once, for the picks the page opened with. Later picks load from pick().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The draft this setup saves to, once there is one.
  const [draftId, setDraftId] = useState<string | null>(draft?.id ?? null);
  const [draftState, setDraftState] = useState<"saved" | "saving" | "failed" | null>(draft ? "saved" : null);
  const sportOf = (): string | null => {
    const team = rosters.find((roster) => roster.id === (picked.home || picked.away));
    const sport = loaded?.sport ?? team?.sport ?? draft?.sport ?? null;
    return isSport(sport) ? sport : null;
  };
  const draftFields = (): DraftFields => ({
    game_date: gameDate || undefined,
    sport: sportOf() as DraftFields["sport"],
    away_roster_id: picked.away || null,
    home_roster_id: picked.home || null,
    wearing_away: wearing.away?.trim() ? wearing.away.trim().slice(0, 40) : null,
    wearing_home: wearing.home?.trim() ? wearing.home.trim().slice(0, 40) : null,
    share_log: share,
  });

  // On a draft, every change saves back to it, a moment after the last one.
  const lastSaved = useRef<string | null>(
    draft
      ? JSON.stringify({
          game_date: draft.gameDate,
          away_roster_id: draft.awayId,
          home_roster_id: draft.homeId,
          wearing_away: draft.wearing.away,
          wearing_home: draft.wearing.home,
          share_log: draft.share,
        })
      : null,
  );
  const fieldsKey = JSON.stringify({
    game_date: gameDate || undefined,
    away_roster_id: picked.away || null,
    home_roster_id: picked.home || null,
    wearing_away: wearing.away?.trim() ? wearing.away.trim().slice(0, 40) : null,
    wearing_home: wearing.home?.trim() ? wearing.home.trim().slice(0, 40) : null,
    share_log: share,
  });
  useEffect(() => {
    if (!draftId || !gameDate || fieldsKey === lastSaved.current) return;
    const timer = setTimeout(() => {
      setDraftState("saving");
      void saveDraft(draftId, draftFields()).then((ok) => {
        if (ok) lastSaved.current = fieldsKey;
        setDraftState(ok ? "saved" : "failed");
      });
    }, 600);
    return () => clearTimeout(timer);
    // draftFields reads the same state fieldsKey is made of.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId, fieldsKey]);

  const saveAsDraft = async () => {
    if (!gameDate || (!picked.away && !picked.home)) return;
    setDraftState("saving");
    const id = await createDraft({ ...draftFields(), game_date: gameDate });
    if (!id) {
      setDraftState("failed");
      return;
    }
    lastSaved.current = fieldsKey;
    setDraftId(id);
    setDraftState("saved");
    track("game.draft_saved", { from: "setup", teams: [picked.away, picked.home].filter(Boolean).length });
    // The address says which draft this is, so a reload or Add a team keeps it.
    router.replace(setupHref({ side: "away", away: picked.away || null, home: picked.home || null, draft: id }));
  };

  const start = async (keytermBoost: boolean) => {
    if (!loaded) return;
    setStarting(true);
    setError(null);
    // main has no live stats (Nov 1): every game is names only.
    const statsEnabled = false;
    const started = await startGame({
      loaded,
      wearing,
      share,
      keytermBoost,
      statsEnabled,
      draftId,
      from: "setup",
      datePassed: Boolean(draftId && today && gameDate && gameDate < today),
    });
    if (!started.ok) {
      setStarting(false);
      setError(started.error);
      return;
    }
    router.push("/live");
  };

  return (
    <SetupScreen
      rosters={rosters}
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
      onRetry={picked.away && picked.home && picked.away !== picked.home ? () => pick("away", picked.away) : undefined}
      date={gameDate}
      onDate={setDate}
      draftId={draftId}
      draftState={draftState}
      onSaveDraft={() => void saveAsDraft()}
      onHide={(id) => void hideTonight([...hidden, id], id)}
      onShow={(id) => void hideTonight(hidden.filter((other) => other !== id), id)}
      hiding={hiding}
      onStart={(boost) => void start(boost)}
    />
  );
}

/** A loaded side as the picker lists it, for the Summary a test renders. */
function sideSummary(side: LoadedGame["home"], schedule: readonly unknown[] | undefined): TeamSummary {
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
    hasStats: side.statsAsOf !== null,
    hasSchedule: (schedule?.length ?? 0) > 0,
  };
}

/**
 * Setup for two loaded rosters: the warnings, the options and Start. Exported
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
  onHide,
  onShow,
  hiding = null,
  today = todayIso(),
}: {
  loaded: LoadedGame;
  wearing: Wearing;
  onWearing: (next: Wearing) => void;
  share?: boolean;
  onShare?: (next: boolean) => void;
  starting: boolean;
  onStart: (keytermBoost: boolean) => void;
  /** Hides a player for this game only and loads the game again. */
  onHide?: (playerId: string) => void;
  /** Shows a player hidden tonight again. */
  onShow?: (playerId: string) => void;
  /** The player being hidden or shown right now. */
  hiding?: string | null;
  /** "YYYY-MM-DD" in the announcer's time zone. A prop so a test can fix the day. */
  today?: string;
}) {
  return (
    <SetupScreen
      rosters={[sideSummary(loaded.away, loaded.schedules?.away), sideSummary(loaded.home, loaded.schedules?.home)]}
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
      onHide={onHide}
      onShow={onShow}
      hiding={hiding}
      today={today}
    />
  );
}


/** One numbered step of setup: a panel whose heading says what to do. */
function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <Panel heading={`${n}. ${title}`}>
      <div className="flex flex-col gap-3 p-3">{children}</div>
    </Panel>
  );
}

/**
 * The setup screen, top to bottom (Nov 1, made simpler for the first outside
 * announcer): 1, pick the two teams; 2, once both are read, the sound check and
 * anything worth a look; then More options, folded (every name listened for,
 * what each side wears, sharing the log). Start is in the toolbar, the one
 * primary button.
 */
function SetupScreen({
  rosters,
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
  onRetry,
  onHide,
  onShow,
  hiding = null,
  today = todayIso(),
  date = "",
  onDate,
  draftId = null,
  draftState = null,
  onSaveDraft,
}: {
  rosters: TeamSummary[];
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
  /** Loads the picked teams again after a failed load. */
  onRetry?: () => void;
  onHide?: (playerId: string) => void;
  onShow?: (playerId: string) => void;
  hiding?: string | null;
  today?: string;
  /** The game's date, "YYYY-MM-DD" (Nov 3). */
  date?: string;
  onDate?: (next: string) => void;
  /** The draft this setup saves to, if any. */
  draftId?: string | null;
  draftState?: "saved" | "saving" | "failed" | null;
  /** Saves what is picked as a draft game. Absent where there is nothing to save to (a test). */
  onSaveDraft?: () => void;
}) {
  const team = (side: Side) => rosters.find((roster) => roster.id === picked[side]) ?? null;
  const away = team("away");
  const home = team("home");
  const names = namesHref({ away: picked.away || null, home: picked.home || null, draft: draftId });
  const warnings = loaded ? setupWarnings(loaded, today, names, { draft: draftId }) : [];
  const warningCount = warnings.length;
  const both = warnings.filter((warning) => warning.side === "both");
  const tooMany = loaded?.keyterm.kind === "too_many";
  // Hidden for this game only, by name, so the announcer can show them again.
  const hiddenPlayers = loaded ? loaded.statsRoster.filter((player) => loaded.hidden?.includes(player.playerId)) : [];
  const schoolOf = (side: Side) => (side === "home" ? loaded?.home.school : loaded?.away.school) ?? team(side)?.school ?? SIDE_LABEL[side];

  return (
    <>
      <Toolbar
        title="New game"
        actions={
          <>
            {draftId ? (
              <span role="status" className={`text-[14px] ${draftState === "failed" ? "font-semibold text-red" : "text-muted"}`}>
                {draftState === "saving" ? "Saving..." : draftState === "failed" ? "Couldn't save the draft. Check the connection." : "Draft saved"}
              </span>
            ) : (
              onSaveDraft && (
                <Button disabled={(!picked.away && !picked.home) || !date || draftState === "saving"} onClick={onSaveDraft}>
                  {draftState === "saving" ? "Saving..." : "Save as draft"}
                </Button>
              )
            )}
            <Button variant="primary" disabled={!loaded || starting} onClick={() => onStart(!tooMany)}>
              {starting ? "Starting..." : "Start"}
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

      <div className={`${PAGE_COLUMN} flex flex-col gap-4 py-4`}>
        <BrowserCheck look="dash" />
        {current && (
          <RowList className="rounded-[3px] border border-line">
            <WarningRow
              text={`${current} is still open. Starting a new game ends it and saves its counts.`}
              fix={<TextLink href="/live">Back to it</TextLink>}
            />
          </RowList>
        )}

        <Step n={1} title="Pick the teams">
          {onDate && (
            <label className="flex flex-wrap items-center gap-3">
              <span className={LABEL}>Date</span>
              <Input type="date" className="w-48" value={date} onChange={(event) => event.target.value && onDate(event.target.value)} />
              {draftId && <span className="text-[14px] text-muted">Changes save to this draft as you make them.</span>}
            </label>
          )}
          {rosters.length < 2 && (
            <p className="text-muted">
              A game needs two saved teams. Add {rosters.length === 0 ? "them" : "the other one"} with + Add a team, and
              StatCast brings you back here with it picked.
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
                <div key={side} className="flex min-w-0 flex-col gap-2">
                  <label className="flex flex-col gap-1">
                    <span className={LABEL}>{SIDE_LABEL[side]} team</span>
                    <Select className="w-full font-semibold" value={picked[side]} onChange={(event) => onPick(side, event.target.value)}>
                      <option value="">{rosters.length === 0 ? "No saved teams yet" : `Pick the ${side} team`}</option>
                      {rosters.map((roster) => (
                        <option key={roster.id} value={roster.id}>
                          {describeTeam(roster)} ({roster.playerCount})
                        </option>
                      ))}
                    </Select>
                  </label>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px]">
                    {picks && players !== null && (
                      <span className="text-muted">
                        {plural(players, "player")}. {asOf ? `Stats as of ${dayLabel(asOf)}.` : "No season stats."}
                      </span>
                    )}
                    {picks && <TextLink href={`/teams/${picks.id}`}>Open team</TextLink>}
                    <TextLink href={stepHref("/teams/new", { side, away: picked.away || null, home: picked.home || null, draft: draftId })}>
                      + Add a team
                    </TextLink>
                  </div>
                  <SetupWarningList warnings={own} onHide={onHide} hiding={hiding} />
                </div>
              );
            })}
          </div>
          {loading && <p className="text-muted">Reading both rosters and checking the names...</p>}
          {error && <ErrorRow className="px-0" text={error} fix={onRetry && <Button onClick={onRetry}>Try again</Button>} />}
        </Step>

        {loaded && (
          <Step n={2} title="Before you start">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <ButtonLink href={soundCheckHref({ away: loaded.away.id, home: loaded.home.id, draft: draftId })}>Sound check</ButtonLink>
              <p className="min-w-0 flex-1 text-muted">
                Recommended before your first game with these teams. Say each team&apos;s {SOUND_CHECK_PER_TEAM} most called
                names once into the mic. When the mic writes a name some other way, you can save how the mic hears it, so
                the card still finds the player. About two minutes.
              </p>
            </div>

            {warningCount > 0 ? (
              <p className="text-[14px] text-amber-text">
                {warningCount} {warningCount === 1 ? "thing" : "things"} to look at below. None of them stop you starting.
              </p>
            ) : (
              <p className="text-muted">Both rosters look good. Press Start when you&apos;re ready.</p>
            )}

            <SetupWarningList warnings={both} onHide={onHide} hiding={hiding} />
            {hiddenPlayers.length > 0 && (
              <p className="flex flex-wrap items-center gap-x-3 gap-y-2" data-testid="hidden-tonight">
                <span className="font-semibold">Hidden tonight:</span>
                {hiddenPlayers.map((player) => (
                  <span key={player.playerId} className="flex items-center gap-2">
                    <span>
                      {player.last}
                      {player.jersey ? ` #${player.jersey}` : ""}
                    </span>
                    {onShow && (
                      <Button disabled={hiding !== null} onClick={() => onShow(player.playerId)}>
                        {hiding === player.playerId ? "Showing..." : "Show"}
                      </Button>
                    )}
                  </span>
                ))}
                <span className="text-[14px] text-muted">For this game only. Your saved team doesn&apos;t change.</span>
              </p>
            )}
          </Step>
        )}

        {loaded && (
          <details className="group rounded-[3px] border border-line bg-surface">
            <summary className="flex h-10 cursor-pointer list-none items-center gap-2 bg-surface-2 px-3 text-[14px] font-semibold uppercase tracking-[0.04em] text-ink-2">
              <span aria-hidden className="inline-block transition-transform group-open:rotate-90">
                ›
              </span>
              More options
              <span className="font-normal normal-case tracking-normal text-muted">Optional: names, jersey colors, sharing the log</span>
            </summary>
            <div className="flex flex-col gap-4 border-t border-line p-3">
              <p className="flex flex-wrap items-baseline gap-x-2">
                <TextLink href={names}>Names StatCast is listening for, and ones that sound alike</TextLink>
                <span className="text-[14px] text-muted">{namesSummary(loaded)}</span>
              </p>

              <div className="flex flex-col gap-2">
                <span className={LABEL}>Wearing tonight</span>
                <p className="text-muted">
                  Say the color and a number, and StatCast knows the side: &quot;white 5&quot; shows that team&apos;s number 5.
                  The school name and the mascot already work this way.
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

              <div className="flex flex-col gap-2">
                <span className="flex items-center gap-3">
                  <span className={LABEL}>Share game log</span>
                  <Switch checked={share} onChange={onShare} label="Share a copy of this game's log, last names kept" />
                </span>
                <p className="text-muted">{SHARE_NOTE}</p>
              </div>
            </div>
          </details>
        )}
      </div>
    </>
  );
}
