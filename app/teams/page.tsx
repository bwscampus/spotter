import { LoadError } from "@/components/rosters/LoadError";
import { TeamsTable } from "@/components/rosters/TeamsTable";
import { loadTeamList, TEAMS_LOAD_ERROR } from "@/lib/rosters/loadRosters";

/** Every saved team in one table, a way to make a new one, and a way to open or delete each. */
export default async function Teams() {
  const list = await loadTeamList();

  return (
    <main className="dash min-h-[calc(100dvh-40px)] bg-surface">
      {/* A failed read is said as one, never as "No teams yet". */}
      {list.status === "error" ? <LoadError title="Teams" message={TEAMS_LOAD_ERROR} /> : <TeamsTable teams={list.teams} />}
    </main>
  );
}
