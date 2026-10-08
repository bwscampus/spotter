import { SoundCheck } from "@/components/game/SoundCheck";
import { TextLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/Rows";
import { Toolbar } from "@/components/ui/Toolbar";
import { readSetupPicks, type SearchParams } from "@/lib/game/setupReturn";

type SoundCheckPageProps = { searchParams: Promise<SearchParams> };

/**
 * The name sound check, a step off game setup: say each team's most called
 * names once and keep what Deepgram writes as "heard as" forms. Needs both
 * teams picked, which the URL carries the same way setup's other steps do.
 */
export default async function SoundCheckPage({ searchParams }: SoundCheckPageProps) {
  const picks = readSetupPicks(await searchParams);

  return (
    <main className="dash min-h-[calc(100dvh-40px)] bg-surface">
      {picks.away && picks.home ? (
        <SoundCheck awayId={picks.away} homeId={picks.home} />
      ) : (
        <>
          <Toolbar crumbs={[{ label: "New game", href: "/games/new" }]} title="Sound check" />
          <EmptyState className="p-4">
            Pick both teams on game setup first. <TextLink href="/games/new">Back to setup</TextLink>
          </EmptyState>
        </>
      )}
    </main>
  );
}
