"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { track } from "@/lib/analytics/track";
import { stepHref, type SetupReturn } from "@/lib/game/setupReturn";
import {
  applySport,
  mergeTeam,
  replaceWithImport,
  saveBlocker,
  savedRosterProps,
  savedRow,
  toSaveArgs,
  type EditorRow,
  type TeamDraft,
} from "@/lib/rosters/editor";
import type { LoadedRoster } from "@/lib/server/repo/rosters";
import { reviewRoster } from "@/lib/rosters/reviewPlayers";
import { teamKey } from "@/lib/rosters/teamKey";
import {
  GENDER_LABELS,
  GENDERS,
  LEVEL_LABELS,
  LEVELS,
  SPORT_LABELS,
  SPORTS,
  isSport,
  type Sport,
} from "@/lib/rosters/types";
import { api } from "@/lib/apiClient";
import { DeleteTeamButton } from "./DeleteTeamButton";
import { PlayerTable } from "./PlayerTable";
import { RosterImport, type ImportResult } from "./RosterImport";

const FIELD =
  "mt-1 h-9 w-full rounded-md border border-neutral-300 bg-neutral-50 px-2 text-sm text-neutral-900 focus:border-neutral-600 focus:outline-none";
const LABEL = "text-[11px] font-semibold uppercase tracking-widest text-neutral-500";
const PRIMARY =
  "cursor-pointer rounded-md border border-neutral-800 bg-neutral-900 px-4 py-2 text-sm font-black uppercase tracking-wider text-white hover:bg-neutral-700 disabled:cursor-not-allowed disabled:border-neutral-300 disabled:bg-neutral-200 disabled:text-neutral-500";

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
        `Replace the ${plural(saved, "player")} below with the ${result.players.length} just imported? Pronunciations and spotting settings stay with any player whose surname and number match.`,
      )
    ) {
      return;
    }
    firstImportAt.current ??= Date.now();
    const nextTeam = mergeTeam(team, result.team);
    const nextSport = isSport(nextTeam.sport) ? nextTeam.sport : null;
    setTeam(nextTeam);
    changeRows(replaceWithImport(rows, result.players, nextSport));
  };

  async function save() {
    if (blocker) return;
    setSaving(true);
    setMessage(null);

    // A new team with the same details as a saved one replaces that one's roster.
    if (!rosterId) {
      const existing = await api<{ id: string | null }>("GET", `/api/rosters?key=${encodeURIComponent(teamKey(team))}`);
      if (existing.ok && existing.data.id && !window.confirm("You already have this team saved. Saving replaces its roster with this one. Go ahead?")) {
        setSaving(false);
        return;
      }
    }

    const saved = await api<{ id: string }>("PUT", "/api/rosters", toSaveArgs(team, rows, rosterId));
    setSaving(false);
    if (!saved.ok || typeof saved.data.id !== "string") {
      // save_roster's own messages are written for the announcer ("Pick a sport before saving.").
      setMessage({ tone: "error", text: (!saved.ok && saved.error) || "Could not save the roster. Try again." });
      return;
    }
    const id = saved.data.id;

    track("prep.roster_saved", savedRosterProps(rows, reviews, firstImportAt.current, Date.now()));
    firstImportAt.current = null;
    // The next save counts only what changes after this one.
    setRows((current) => current.map((row) => ({ ...row, edited: false, pronunciationsAtStart: row.player.pronunciations.length })));
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

  return (
    <div className="flex flex-col gap-6">
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-6">
        <label className="col-span-2 sm:col-span-2">
          <span className={LABEL}>School</span>
          <input className={FIELD} value={team.school} onChange={(e) => changeTeam("school", e.target.value)} />
        </label>
        <label className="col-span-2 sm:col-span-1">
          <span className={LABEL}>Mascot</span>
          <input className={FIELD} value={team.mascot} onChange={(e) => changeTeam("mascot", e.target.value)} />
        </label>
        <label>
          <span className={LABEL}>Sport</span>
          <select className={FIELD} value={team.sport} onChange={(e) => changeTeam("sport", e.target.value)}>
            <option value="">Pick one</option>
            {SPORTS.map((value) => (
              <option key={value} value={value}>
                {SPORT_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className={LABEL}>Gender</span>
          <select className={FIELD} value={team.gender} onChange={(e) => changeTeam("gender", e.target.value)}>
            <option value="">None</option>
            {GENDERS.map((value) => (
              <option key={value} value={value}>
                {GENDER_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className={LABEL}>Level</span>
          <select className={FIELD} value={team.level} onChange={(e) => changeTeam("level", e.target.value)}>
            <option value="">None</option>
            {LEVELS.map((value) => (
              <option key={value} value={value}>
                {LEVEL_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className={LABEL}>Season</span>
          <input className={FIELD} placeholder="26-27" value={team.season} onChange={(e) => changeTeam("season", e.target.value)} />
        </label>
      </section>

      {rosterId && (
        <nav className="flex flex-wrap gap-3">
          {/* Stats are matched to saved players, and a roster save replaces
              them, so leaving with unsaved edits asks first. */}
          {[
            { href: `/teams/${rosterId}/stats`, label: "Import season stats" },
            { href: `/teams/${rosterId}/cards`, label: "Cards preview" },
          ].map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={(event) => {
                if (dirty && !window.confirm("You have unsaved changes to this roster. Leave without saving them?")) {
                  event.preventDefault();
                }
              }}
              className="rounded-md border border-neutral-300 bg-neutral-50 px-3 py-1.5 text-sm font-semibold text-neutral-900 hover:border-neutral-600"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      )}

      <RosterImport onImported={imported} />

      <PlayerTable rows={rows} reviews={reviews} sport={sport} onChange={changeRows} />

      <div className="sticky bottom-0 flex flex-wrap items-center gap-4 border-t border-neutral-200 bg-white py-3">
        <button type="button" disabled={saving || blocker !== null} onClick={() => void save()} className={PRIMARY}>
          {saving ? "Saving..." : then ? "Save and add stats" : "Save"}
        </button>
        {blocker && <span className="text-sm text-neutral-500">{blocker}</span>}
        {!blocker && dirty && !saving && <span className="text-sm text-neutral-500">Unsaved changes.</span>}
        {message && (
          <span role={message.tone === "error" ? "alert" : "status"} className={`text-sm font-semibold ${message.tone === "error" ? "text-amber-700" : "text-neutral-700"}`}>
            {message.text}
          </span>
        )}
        {rosterId && (
          <div className="ml-auto">
            <DeleteTeamButton id={rosterId} name={team.school} afterDelete={() => router.replace("/teams")} />
          </div>
        )}
      </div>
    </div>
  );
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}
