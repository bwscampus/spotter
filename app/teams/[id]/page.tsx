import Link from "next/link";
import { notFound } from "next/navigation";
import { RosterEditor } from "@/components/rosters/RosterEditor";
import { SiteHeader } from "@/components/SiteHeader";
import { pageUser } from "@/lib/server/pageUser";
import { getRoster } from "@/lib/server/repo/rosters";
import { describeTeam } from "@/lib/rosters/types";

// Typed by hand rather than with PageProps, which only exists once `next build`
// has generated route types, so `tsc` on a fresh clone would fail.
type TeamProps = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function Team({ params }: TeamProps) {
  const { id } = await params;
  // A malformed id would reach Postgres as a cast error; it is simply not a team.
  const roster = UUID.test(id) ? await getRoster((await pageUser()).id, id) : null;
  if (!roster) notFound();

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader>
        <Link href="/teams" className="text-sm text-neutral-600 hover:text-neutral-900">
          Teams
        </Link>
      </SiteHeader>
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-6">
        <h1 className="text-2xl font-black">{describeTeam({ ...roster.team, sport: roster.team.sport || "" })}</h1>
        {/* Keyed by id so a save that moves to a new id starts from the saved state. */}
        <RosterEditor key={roster.id} initial={roster} />
      </main>
    </div>
  );
}
