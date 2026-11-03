"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScheduleSection, type ScheduleStart } from "@/components/schedule/ScheduleSection";
import { StatsReviewSection } from "@/components/stats/StatsReviewSection";
import { Button, LinkButton, TextLink } from "@/components/ui/Button";
import { INPUT, LABEL } from "@/components/ui/Field";
import { plural } from "@/lib/ui/format";
import { Panel } from "@/components/ui/Panel";
import { Toolbar, ToolbarMeta } from "@/components/ui/Toolbar";
import { track } from "@/lib/analytics/track";
import { setupHref, stepHref, type SetupReturn } from "@/lib/game/setupReturn";
import {
  applySport,
  carryOverFromSaved,
  mergeTeam,
  PHOTO_READ_NOTE,
  REIMPORT_STATS_NOTE,
  replaceWithImport,
  saveBlocker,
  savedRosterProps,
  savedRow,
  toSaveArgs,
  withSeasonStats,
  type EditorRow,
  type SavedStats,
  type TeamDraft,
} from "@/lib/rosters/editor";
import type { LoadedRoster } from "@/lib/rosters/loadRosters";
import { reviewRoster } from "@/lib/rosters/reviewPlayers";
import { applyStorylines } from "@/lib/rosters/storylines";
import { teamKey } from "@/lib/rosters/teamKey";
import {
  GENDER_LABELS,
  GENDERS,
  LEVEL_LABELS,
  LEVELS,
  SPORT_LABELS,
  SPORTS,
  genderLabel,
  isSport,
  levelLabel,
  sportLabel,
  type Sport,
} from "@/lib/rosters/types";
import type { ScheduleGame } from "@/lib/schedule/types";
import { buildStatsReview, type StatsReview } from "@/lib/stats/review";
import type { StatsExtractResponse } from "@/lib/stats/types";
import { api } from "@/lib/apiClient";
import { DeleteTeamButton } from "./DeleteTeamButton";
import { PlayerTable } from "./PlayerTable";
import type { ImportResult } from "./RosterImport";
import { StorylineImport } from "./StorylineImport";
import { TeamColor } from "./TeamColor";
import { TeamImports } from "./TeamImports";
import { useUnsavedGuard } from "./useUnsavedGuard";

/** Why the Season stats box is shut (Oct 29): stats are matched to the saved players. */
export const STATS_SAVE_TEAM_FIRST = "Save the team first. Stats are matched to its saved players by jersey number.";
export const STATS_SAVE_ROSTER_FIRST = "Save the roster changes first. Stats are matched to the saved players.";
/** On a stats review whose roster was edited after the sheet was read (audit, Nov 1: it used to say save the roster, which threw the review away). */
export const STATS_ROSTER_CHANGED =
  "You changed the roster after reading this sheet. Undo those changes to save these stats, or save the roster and drop the sheet in again.";
export const SCHEDULE_SAVE_TEAM_FIRST = "Save the team first, then import or type its schedule.";
/** Asked before a click away from the page throws unsaved work away. */
export const LEAVE_UNSAVED = "You have unsaved changes on this team. Leave without saving them?";
/** Said when a roster save throws away a stats sheet read but not yet saved. */
export const STATS_READ_AGAIN = "Roster saved. Drop the stats sheet again: saving the roster starts its players over.";

const FIELD = `${INPUT} w-full`;

/** "Football, Varsity, 2026": what kind of team, beside its name in the toolbar. */
export function teamMeta(team: Pick<TeamDraft, "sport" | "gender" | "level" | "season">): string {
  return [sportLabel(team.sport), genderLabel(team.gender), levelLabel(team.level), team.season.trim()].filter(Boolean).join(", ");
}

/**
 * One team: its details, an import in any format, the review table with every
 * warning, and Save. The same screen makes a new team and edits a saved one.
 *
 * Save goes through save_roster, so the whole roster saves or none of it does.
 * A saved team's id rides along, so editing its school or season renames it in
 * place rather than saving a second team.
 *
 * `then` is set when game setup's Add a team opened this: a save goes on to the
 * team's season stats, the second step, rather than staying here.
 *
 * Since Oct 29 the page is where a team is set up whole: three import boxes
 * in a row (roster, season stats, schedule), whose reviews open right here,
 * each with its own Save, and Other info behind the toolbar's "Add other info".
 */
export function RosterEditor({
  initial,
  then = null,
  schedule,
}: {
  initial: LoadedRoster | { id: null; team: TeamDraft; players: [] };
  then?: SetupReturn | null;
  /** The saved team's schedule; null when it could not be read. A new team has none. */
  schedule?: ScheduleGame[] | null;
}) {
  const router = useRouter();
  const [rosterId, setRosterId] = useState<string | null>(initial.id);
  const [team, setTeam] = useState<TeamDraft>(initial.team);
  const [rows, setRows] = useState<EditorRow[]>(() => initial.players.map(({ player, season }) => savedRow(player, season)));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const firstImportAt = useRef<number | null>(null);
  // A team with no players yet opens on the import, big: it is what this page is for.
  const [importOpen, setImportOpen] = useState(() => initial.players.length === 0);
  const [otherInfoOpen, setOtherInfoOpen] = useState(false);
  // How many players the team has saved: stats are matched to them.
  const [savedPlayers, setSavedPlayers] = useState(initial.players.length);
  // A stats sheet read from the Stats box, waiting for its own Save.
  const [statsRead, setStatsRead] = useState<{ review: StatsReview; source: string; key: number } | null>(null);
  const [savedGames, setSavedGames] = useState<ScheduleGame[] | null>(schedule === undefined ? [] : schedule);
  // Each read or "type the games in" opens the schedule section afresh (its key).
  const [scheduleStart, setScheduleStart] = useState<{ start: ScheduleStart; key: number } | null>(null);
  const statsRef = useRef<HTMLDivElement>(null);
  const scheduleRef = useRef<HTMLDivElement>(null);
  // While Delete asks, the toolbar's other actions step aside for the question.
  const [deleting, setDeleting] = useState(false);
  const onAsking = useCallback((asking: boolean) => setDeleting(asking), []);
  // The rows came from a photo or a scan, until the next save or text import.
  const [readFromImage, setReadFromImage] = useState(false);

  const sport: Sport | null = isSport(team.sport) ? team.sport : null;
  const reviews = useMemo(() => reviewRoster(rows.map((row) => row.player), sport), [rows, sport]);
  const blocker = saveBlocker(team, rows);

  // A review that just opened is what to look at next, under the boxes.
  useEffect(() => {
    if (statsRead) statsRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [statsRead]);
  useEffect(() => {
    if (scheduleStart) scheduleRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [scheduleStart]);

  // Leaving with unsaved edits, or a stats sheet read but not saved, loses
  // them, so the page asks first: on a reload, and on any link in the app.
  useUnsavedGuard(dirty || statsRead !== null, LEAVE_UNSAVED);

  // Other info opens under the boxes; bring it into view, as the reviews are.
  const otherInfoRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (otherInfoOpen) otherInfoRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [otherInfoOpen]);

  const changeRows = (next: EditorRow[]) => {
    setRows(next);
    setDirty(true);
    setMessage(null);
  };

  const changeTeam = (field: keyof TeamDraft, value: string) => {
    const next = { ...team, [field]: value } as TeamDraft;
    setTeam(next);
    if (field === "sport") setRows((current) => applySport(current, isSport(value) ? value : null));
    setDirty(true);
    setMessage(null);
  };

  const imported = (result: ImportResult) => {
    const saved = rows.filter((row) => row.player.last_name.trim()).length;
    if (
      saved > 0 &&
      !window.confirm(
        `Replace the ${plural(saved, "player")} below with the ${result.players.length} just imported? Pronunciations, heard-as forms and spotting settings stay with any player whose surname and number match. ${REIMPORT_STATS_NOTE}`,
      )
    ) {
      return;
    }
    firstImportAt.current ??= Date.now();
    // A photo or a scanned PDF is read from page images, where a misread name
    // has no text to be checked against (M10).
    setReadFromImage(result.route === "vision");
    // From what is on the page now, not when the read began: a read takes up to
    // two minutes, and what was typed meanwhile must not revert (audit, Nov 1).
    let nextSport: Sport | null = null;
    setTeam((current) => {
      const next = mergeTeam(current, result.team);
      nextSport = isSport(next.sport) ? next.sport : null;
      return next;
    });
    setRows((current) => replaceWithImport(current, result.players, nextSport ?? (isSport(team.sport) ? team.sport : null)));
    setDirty(true);
    setMessage(null);
  };

  const statsImported = (body: StatsExtractResponse, source: string) => {
    setStatsRead({ review: buildStatsReview(body), source, key: Date.now() });
  };

  // The stats were saved from the team page: the table takes exactly what was
  // written, so the roster's next Save keeps them. Nothing in the roster changed.
  const statsSaved = (saved: SavedStats[], asOf: string | null) => {
    setRows((current) => withSeasonStats(current, saved, asOf));
    setStatsRead(null);
    setMessage({ tone: "ok", text: `Season stats saved for ${plural(saved.length, "player")}.` });
    router.refresh();
  };

  const openSchedule = (start: ScheduleStart) => setScheduleStart({ start, key: Date.now() });

  // "Other info": the storylines the announcer ticked, into the table, saved with the team.
  const storylinesPicked = (picks: ReadonlyMap<string, string>) => {
    changeRows(applyStorylines(rows, picks));
    setMessage({ tone: "ok", text: `${plural(picks.size, "storyline")} added to the table. Save to keep them.` });
  };

  async function save() {
    if (blocker) return;
    // The save gives every player a new id, so a stats sheet read but not saved
    // has nobody to land on afterwards: ask rather than drop it (audit, Nov 1).
    if (statsRead && !window.confirm("Season stats you read are not saved yet. Saving the roster now means dropping the stats sheet in again. Save the roster anyway?")) {
      return;
    }
    setSaving(true);
    setMessage(null);

    let saveTeam = team;
    let saveRows = rows;
    let saveId = rosterId;
    let merged = false;
    // A new team with the same details as a saved one updates that team, and
    // keeps what its players already had (audit, Nov 1: it used to wipe them).
    if (!rosterId) {
      const lookup = await api<{ id: string | null }>("GET", `/api/rosters?key=${encodeURIComponent(teamKey(team))}`);
      if (lookup.ok && lookup.data.id) {
        if (
          !window.confirm(
            `You already have this team saved. Saving updates it with this roster, and every player whose surname and number match keeps their pronunciation, heard-as forms, storyline and spotting setting. ${REIMPORT_STATS_NOTE} Go ahead?`,
          )
        ) {
          setSaving(false);
          return;
        }
        const existing = await api<LoadedRoster>("GET", `/api/rosters/${encodeURIComponent(lookup.data.id)}`);
        if (!existing.ok) {
          setSaving(false);
          setMessage({ tone: "error", text: "Could not read the saved team to keep its settings. Check the connection and try again." });
          return;
        }
        saveTeam = mergeTeam(team, existing.data.team);
        saveRows = carryOverFromSaved(
          rows,
          existing.data.players.map(({ player, season }) => savedRow(player, season)),
        );
        saveId = lookup.data.id;
        merged = true;
        setTeam(saveTeam);
        setRows(saveRows);
      }
    }

    // One call, one transaction: the team, its colour, the players, their
    // heard-as forms and storylines all save, or none of them do (M12).
    // Carried-over rows are reviewed again for their heard-as forms.
    const args = toSaveArgs(saveTeam, saveRows, saveId, merged ? undefined : reviews);
    const savableCount = args.p_players.length;
    const saved = await api<{ id: string }>("PUT", "/api/rosters", args);
    setSaving(false);
    if (!saved.ok || typeof saved.data.id !== "string") {
      // save_roster's own messages are written for the announcer ("Pick a sport before saving.").
      setMessage({ tone: "error", text: (!saved.ok && saved.error) || "Could not save the roster. Try again." });
      return;
    }
    const id = saved.data.id;
    setReadFromImage(false);
    setSavedPlayers(savableCount);

    track("prep.roster_saved", savedRosterProps(saveRows, reviews, firstImportAt.current, Date.now()));
    firstImportAt.current = null;
    // The next save counts only what changes after this one.
    setRows((current) =>
      current.map((row) => ({
        ...row,
        edited: false,
        pronunciationsAtStart: row.player.pronunciations.length,
        heardAsAtStart: (row.player.heard_as ?? []).length,
      })),
    );
    setDirty(false);
    // The save gave every player a new id, so a stats sheet read before it has nobody to land on.
    const statsDropped = statsRead !== null;
    setStatsRead(null);
    if (then) {
      // Adding a team from game setup: on to its season stats, step 2 of 2.
      setMessage({ tone: "ok", text: "Saved. On to the season stats..." });
      router.push(stepHref(`/teams/${id}/stats`, then));
      return;
    }
    setMessage({ tone: "ok", text: statsDropped ? STATS_READ_AGAIN : "Saved." });
    if (id !== rosterId) {
      setRosterId(id);
      router.replace(`/teams/${id}`);
    }
    router.refresh();
  }

  const name = [team.school.trim(), team.mascot.trim()].filter(Boolean).join(" ");
  const title = name || (then ? `Add the ${then.side} team` : "New team");
  const meta = teamMeta(team);
  const players = rows.filter((row) => row.player.last_name.trim()).length;
  const statsBlockedBy = !rosterId || savedPlayers === 0 ? STATS_SAVE_TEAM_FIRST : dirty ? STATS_SAVE_ROSTER_FIRST : null;
  const scheduleBlockedBy = !rosterId
    ? SCHEDULE_SAVE_TEAM_FIRST
    : savedGames === null
      ? "Couldn't load this team's schedule. Reload to try again."
      : null;
  // A team with players folds its imports to one bar until they are asked for.
  const foldable = players > 0;

  return (
    <>
      <Toolbar
        crumbs={[{ label: "Teams", href: "/teams" }]}
        title={title}
        actions={
          <>
            {!deleting && foldable && (
              <Button aria-expanded={importOpen} onClick={() => setImportOpen(!importOpen)}>
                Import
              </Button>
            )}
            {rosterId && (
              <DeleteTeamButton
                look="button"
                id={rosterId}
                name={name || team.school}
                players={players}
                onAsking={onAsking}
                afterDelete={() => router.replace("/teams")}
              />
            )}
            {!deleting && (
              <Button variant="primary" disabled={saving || blocker !== null || (rosterId !== null && !dirty && !then)} onClick={() => void save()}>
                {saving ? "Saving..." : then ? "Save and add stats" : "Save"}
              </Button>
            )}
          </>
        }
      >
        {meta && <ToolbarMeta>{meta}</ToolbarMeta>}
        <LinkButton aria-expanded={otherInfoOpen} onClick={() => setOtherInfoOpen(!otherInfoOpen)}>
          Add other info
        </LinkButton>
        {rosterId && (
          <TextLink href={`/teams/${rosterId}/cards`}>
            Cards preview
          </TextLink>
        )}
        {then && (
          <TextLink href={setupHref(then)}>
            Back to the game
          </TextLink>
        )}
      </Toolbar>

      <div className="flex flex-col gap-4 p-4">
        <TeamImports
          rosterId={rosterId}
          foldable={foldable}
          open={importOpen}
          onOpenChange={setImportOpen}
          statsBlockedBy={statsBlockedBy}
          scheduleBlockedBy={scheduleBlockedBy}
          onRoster={imported}
          onStats={statsImported}
          onSchedule={(body, source) => openSchedule({ mode: "read", body, source })}
          onTypeSchedule={() => openSchedule({ mode: "type" })}
        />

        {rosterId && statsRead && (
          <div ref={statsRef} className="scroll-mt-4">
            <StatsReviewSection
              key={statsRead.key}
              rosterId={rosterId}
              review={statsRead.review}
              source={statsRead.source}
              blockedBy={dirty ? STATS_ROSTER_CHANGED : null}
              onSaved={statsSaved}
              onDiscard={() => setStatsRead(null)}
            />
          </div>
        )}

        {rosterId && (
          <div ref={scheduleRef} className="scroll-mt-4">
            <ScheduleSection
              key={scheduleStart?.key ?? 0}
              teamId={rosterId}
              saved={savedGames}
              start={scheduleStart?.start ?? null}
              onSaved={(games) => {
                setSavedGames(games);
                setScheduleStart(null);
                setMessage({ tone: "ok", text: `Schedule saved: ${plural(games.length, "game")}.` });
                router.refresh();
              }}
              onClose={() => setScheduleStart(null)}
            />
          </div>
        )}

        <div ref={otherInfoRef} className="scroll-mt-4">
          <StorylineImport
            rows={rows}
            teamName={[team.school, team.mascot].map((part) => part.trim()).filter(Boolean).join(" ")}
            onApply={storylinesPicked}
            open={otherInfoOpen}
            onOpenChange={setOtherInfoOpen}
          />
        </div>

        {then && (
          <p className="text-muted">
            Step 1 of 2: the roster. Import it, check it, and Save. Then you import the team&apos;s season stats, and come
            back to the game with this team picked.
          </p>
        )}

        {(blocker || (dirty && !saving) || message) && (
          <div className="flex min-h-8 flex-wrap items-center gap-3">
            {blocker && <span className="text-muted">Before you can save: {blocker}</span>}
            {!blocker && dirty && !saving && <span className="text-muted">Unsaved changes.</span>}
            {message && (
              <span
                role={message.tone === "error" ? "alert" : "status"}
                className={message.tone === "error" ? "font-semibold text-red" : "font-semibold text-green"}
              >
                {message.text}
              </span>
            )}
          </div>
        )}

        <Panel heading="Team details" className="max-w-[760px]" bodyClassName="grid grid-cols-1 gap-x-6 gap-y-2 p-3 lg:grid-cols-2">
          <Row label="School" id="team-school">
            <input id="team-school" className={FIELD} value={team.school} onChange={(e) => changeTeam("school", e.target.value)} />
          </Row>
          <Row label="Mascot" id="team-mascot">
            <input id="team-mascot" className={FIELD} value={team.mascot} onChange={(e) => changeTeam("mascot", e.target.value)} />
          </Row>
          <Row label="Sport" id="team-sport">
            <select id="team-sport" className={`${FIELD} cursor-pointer`} value={team.sport} onChange={(e) => changeTeam("sport", e.target.value)}>
              <option value="">Pick one</option>
              {SPORTS.map((value) => (
                <option key={value} value={value}>
                  {SPORT_LABELS[value]}
                </option>
              ))}
            </select>
          </Row>
          <Row label="Gender" id="team-gender">
            <select id="team-gender" className={`${FIELD} cursor-pointer`} value={team.gender} onChange={(e) => changeTeam("gender", e.target.value)}>
              <option value="">None</option>
              {GENDERS.map((value) => (
                <option key={value} value={value}>
                  {GENDER_LABELS[value]}
                </option>
              ))}
            </select>
          </Row>
          <Row label="Level" id="team-level">
            <select id="team-level" className={`${FIELD} cursor-pointer`} value={team.level} onChange={(e) => changeTeam("level", e.target.value)}>
              <option value="">None</option>
              {LEVELS.map((value) => (
                <option key={value} value={value}>
                  {LEVEL_LABELS[value]}
                </option>
              ))}
            </select>
          </Row>
          <Row label="Season" id="team-season">
            <input id="team-season" className={FIELD} placeholder="26-27" value={team.season} onChange={(e) => changeTeam("season", e.target.value)} />
          </Row>
          <Row label="Colour" id="team-colour">
            <TeamColor value={team.color || null} onClear={() => changeTeam("color", "")} onChange={(hex) => changeTeam("color", hex)} />
          </Row>
        </Panel>

        {readFromImage && rows.length > 0 && (
          <p role="status" className="flex items-center gap-2 rounded-[3px] border border-line-strong bg-surface-2 px-3 py-2 font-semibold">
            <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-amber-dot" />
            {PHOTO_READ_NOTE}
          </p>
        )}

        <PlayerTable rows={rows} reviews={reviews} sport={sport} onChange={changeRows} />
      </div>
    </>
  );
}

/** One field of the team form: an 88px label at the left, the control after it. */
function Row({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className={`${LABEL} w-[88px] shrink-0`}>
        {label}
      </label>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

