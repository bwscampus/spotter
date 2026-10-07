import Link from "next/link";
import { DeleteTeamButton } from "@/components/rosters/DeleteTeamButton";
import { SiteHeader } from "@/components/SiteHeader";
import { pageUser } from "@/lib/server/pageUser";
import { listRosters } from "@/lib/server/repo/rosters";
import { describeTeam } from "@/lib/rosters/types";

/** Every saved team, a way to make a new one, and a way to open or delete each. */
export default async function Teams() {
  const teams = await listRosters((await pageUser()).id);

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-black">Teams</h1>
          <Link
            href="/teams/new"
            className="rounded-md border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-neutral-700"
          >
            New team
          </Link>
        </div>

        {teams.length === 0 ? (
          <p className="text-sm text-neutral-600">No teams yet. Make one, then import its roster or type it in.</p>
        ) : (
          <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200">
            {teams.map((team) => (
              <li key={team.id} className="flex items-center gap-4 px-4 py-3">
                <Link href={`/teams/${team.id}`} className="flex-1 hover:underline">
                  <span className="font-semibold">{describeTeam(team)}</span>
                  {team.mascot && <span className="text-neutral-500"> {team.mascot}</span>}
                  <span className="ml-2 text-sm text-neutral-500">
                    {team.playerCount} {team.playerCount === 1 ? "player" : "players"}
                  </span>
                </Link>
                <DeleteTeamButton id={team.id} name={team.school} />
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
