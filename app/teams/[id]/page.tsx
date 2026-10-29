import { notFound } from "next/navigation";
import { LoadError } from "@/components/rosters/LoadError";
import { RosterEditor } from "@/components/rosters/RosterEditor";
import { loadRosterState, TEAM_LOAD_ERROR } from "@/lib/rosters/loadRosters";
import { loadScheduleState } from "@/lib/schedule/loadSchedule";

// Typed by hand rather than with PageProps, which only exists once `next build`
// has generated route types, so `tsc` on a fresh clone would fail.
type TeamProps = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function Team({ params }: TeamProps) {
  const { id } = await params;
  // A malformed id would reach Postgres as a cast error; it is simply not a team.
  if (!UUID.test(id)) notFound();
  // The schedule is edited on this page too (Oct 29). A schedule that does not
  // read is null, which the page says, never an empty table to save over it.
  const [load, schedule] = await Promise.all([loadRosterState(id), loadScheduleState(id)]);
  if (load.status === "missing") notFound();

  return (
    <main className="dash min-h-[calc(100dvh-40px)] bg-surface">
      {load.status === "error" ? (
        // Never an empty editor: Save would replace the saved players with none.
        <LoadError title="Team" crumbs={[{ label: "Teams", href: "/teams" }]} message={TEAM_LOAD_ERROR} />
      ) : (
        // Keyed by id so a save that moves to a new id starts from the saved state.
        <RosterEditor key={load.roster.id} initial={load.roster} schedule={schedule.status === "ok" ? schedule.games : null} />
      )}
    </main>
  );
}
