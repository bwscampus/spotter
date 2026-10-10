"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, TextLink } from "@/components/ui/Button";
import { INPUT, LABEL } from "@/components/ui/Field";
import { plural } from "@/lib/ui/format";
import { Panel } from "@/components/ui/Panel";
import { Toolbar, ToolbarMeta } from "@/components/ui/Toolbar";
import { track } from "@/lib/analytics/track";
import { setupHref, stepHref, type SetupReturn } from "@/lib/game/setupReturn";
import {
  applySport,
  mergeTeam,
  PHOTO_READ_NOTE,
  REIMPORT_STATS_NOTE,
  replaceWithImport,
  saveBlocker,
  savedRosterProps,
  savedRow,
  toSaveArgs,
  type EditorRow,
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
import { api } from "@/lib/apiClient";
import { DeleteTeamButton } from "./DeleteTeamButton";
import { PlayerTable } from "./PlayerTable";
import { RosterImport, type ImportResult } from "./RosterImport";
import { StorylineImport } from "./StorylineImport";
import { TeamColor } from "./TeamColor";

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
 */
export function RosterEditor({
  initial,
  then = null,
}: {
  initial: LoadedRoster | { id: null; team: TeamDraft; players: [] };
  then?: SetupReturn | null;
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
  // While Delete asks, the toolbar's other actions step aside for the question.
  const [deleting, setDeleting] = useState(false);
  const onAsking = useCallback((asking: boolean) => setDeleting(asking), []);
  // The rows came from a photo or a scan, until the next save or text import.
  const [readFromImage, setReadFromImage] = useState(false);

  const sport: Sport | null = isSport(team.sport) ? team.sport : null;
  const reviews = useMemo(() => reviewRoster(rows.map((row) => row.player), sport), [rows, sport]);
  const blocker = saveBlocker(team, rows);

  // Leaving with unsaved edits loses them, so the browser asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

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
    const nextTeam = mergeTeam(team, result.team);
    const nextSport = isSport(nextTeam.sport) ? nextTeam.sport : null;
    setTeam(nextTeam);
    changeRows(replaceWithImport(rows, result.players, nextSport));
  };

  // "Other info": the storylines the announcer ticked, into the table, saved with the team.
  const storylinesPicked = (picks: ReadonlyMap<string, string>) => {
    changeRows(applyStorylines(rows, picks));
    setMessage({ tone: "ok", text: `${plural(picks.size, "storyline")} added to the table. Save to keep them.` });
  };

  async function save() {
    if (blocker) return;
    setSaving(true);
    setMessage(null);

    // A new team with the same details as a saved one replaces that one's roster.
    if (!rosterId) {
      const lookup = await api<{ id: string | null }>("GET", `/api/rosters?key=${encodeURIComponent(teamKey(team))}`);
      if (
        lookup.ok &&
        lookup.data.id &&
        !window.confirm(`You already have this team saved. Saving replaces its roster with this one. ${REIMPORT_STATS_NOTE} Go ahead?`)
      ) {
        setSaving(false);
        return;
      }
    }

    // One call, one transaction: the team, its colour, the players, their
    // heard-as forms and storylines all save, or none of them do (M12).
    const args = toSaveArgs(team, rows, rosterId, reviews);
    const saved = await api<{ id: string }>("PUT", "/api/rosters", args);
    setSaving(false);
    if (!saved.ok || typeof saved.data.id !== "string") {
      // save_roster's own messages are written for the announcer ("Pick a sport before saving.").
      setMessage({ tone: "error", text: (!saved.ok && saved.error) || "Could not save the roster. Try again." });
      return;
    }
    const id = saved.data.id;
    setReadFromImage(false);

    track("prep.roster_saved", savedRosterProps(rows, reviews, firstImportAt.current, Date.now()));
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
    if (then) {
      // Adding a team from game setup: on to its season stats, step 2 of 2.
      setMessage({ tone: "ok", text: "Saved. On to the season stats..." });
      router.push(stepHref(`/teams/${id}/stats`, then));
      return;
    }
    setMessage({ tone: "ok", text: "Saved." });
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
  // Stats are matched to saved players, and a roster save replaces them, so
  // leaving with unsaved edits asks first.
  const leave = (event: React.MouseEvent) => {
    if (dirty && !window.confirm("You have unsaved changes to this roster. Leave without saving them?")) event.preventDefault();
  };

  return (
    <>
      <Toolbar
        crumbs={[{ label: "Teams", href: "/teams" }]}
        title={title}
        actions={
          <>
            {!deleting && (
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
              <Button variant="primary" disabled={saving || blocker !== null} onClick={() => void save()}>
                {saving ? "Saving..." : then ? "Save and add stats" : "Save"}
              </Button>
            )}
          </>
        }
      >
        {meta && <ToolbarMeta>{meta}</ToolbarMeta>}
        {rosterId && (
          <>
            <TextLink href={`/teams/${rosterId}/stats`} onClick={leave}>
              Season stats
            </TextLink>
            <TextLink href={`/teams/${rosterId}/cards`} onClick={leave}>
              Cards preview
            </TextLink>
          </>
        )}
        {then && (
          <TextLink href={setupHref(then)} onClick={leave}>
            Back to the game
          </TextLink>
        )}
      </Toolbar>

      <div className="flex flex-col gap-4 p-4">
        <RosterImport onImported={imported} open={importOpen} onOpenChange={setImportOpen} />
        <StorylineImport rows={rows} teamName={[team.school, team.mascot].map((part) => part.trim()).filter(Boolean).join(" ")} onApply={storylinesPicked} />

        {then && (
          <p className="text-muted">
            Step 1 of 2: the roster. Import it, check it, and Save. Then you import the team&apos;s season stats, and come
            back to the game with this team picked.
          </p>
        )}

        {(blocker || (dirty && !saving) || message) && (
          <div className="flex min-h-8 flex-wrap items-center gap-3">
            {blocker && <span className="text-muted">{blocker}</span>}
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

