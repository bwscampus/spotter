import { notFound } from "next/navigation";
import { LoadError } from "@/components/rosters/LoadError";
import { ScheduleImport } from "@/components/schedule/ScheduleImport";
import { loadScheduleState } from "@/lib/schedule/loadSchedule";

// Typed by hand rather than with PageProps, which only exists once `next build`
// has generated route types, so `tsc` on a fresh clone would fail.
type TeamProps = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SCHEDULE_LOAD_ERROR = "Couldn't load this team's schedule. Reload to try again.";

/**
 * One team's schedule (docs/V3_DEFINITION.md 6.7): import it, check every
 * game, and save. The live screen's team panel shows it (docs/PANEL_SPEC.md).
 */
export default async function TeamSchedule({ params }: TeamProps) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const load = await loadScheduleState(id);
  if (load.status === "missing") notFound();

  if (load.status === "error") {
    return (
      <main className="dash min-h-[calc(100dvh-40px)] bg-surface">
        {/* Never an empty table: Save would replace the saved schedule with nothing. */}
        <LoadError title="Schedule" crumbs={[{ label: "Teams", href: "/teams" }]} message={SCHEDULE_LOAD_ERROR} />
      </main>
    );
  }

  const name = [load.team.school, load.team.mascot].filter((part) => part && part.trim()).join(" ");
  return (
    <main className="dash min-h-[calc(100dvh-40px)] bg-surface">
      <ScheduleImport
        teamId={id}
        initial={load.games}
        crumbs={[
          { label: "Teams", href: "/teams" },
          { label: name || "Team", href: `/teams/${id}` },
        ]}
      />
    </main>
  );
}
