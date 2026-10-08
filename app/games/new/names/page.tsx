import { NamesPage } from "@/components/game/NamesPage";
import { readSetupPicks, type SearchParams } from "@/lib/game/setupReturn";

type NamesProps = { searchParams: Promise<SearchParams> };

/** The names two picked teams are listened for: `?away=…&home=…`, as setup carries them. */
export default async function Names({ searchParams }: NamesProps) {
  const picks = readSetupPicks(await searchParams);
  return (
    <main className="dash min-h-[calc(100dvh-40px)] bg-surface">
      <NamesPage away={picks.away} home={picks.home} />
    </main>
  );
}
