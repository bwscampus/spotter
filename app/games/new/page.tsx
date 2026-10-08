import { GameSetup } from "@/components/game/GameSetup";
import { Panel } from "@/components/ui/Panel";
import { PageBody, Toolbar } from "@/components/ui/Toolbar";
import { readSetupPicks, type SearchParams } from "@/lib/game/setupReturn";
import { pageUser } from "@/lib/server/pageUser";
import { listRosters } from "@/lib/server/repo/rosters";

type NewGameProps = { searchParams: Promise<SearchParams> };

/**
 * Pick the away and home rosters, read the warnings, start. docs/V3_DEFINITION.md 7.1.
 * `?away=…&home=…` opens with those teams picked, which is how adding a team
 * or updating its stats comes back here.
 *
 * An email account that has not confirmed its address cannot listen (the
 * Deepgram token route answers email_not_verified), so it is stopped here,
 * before a game exists, rather than on the live screen, which stays free of
 * database reads so a blip never ends a game.
 */
export default async function NewGame({ searchParams }: NewGameProps) {
  const user = await pageUser();
  if (!user.emailVerified) {
    return (
      <main className="dash min-h-[calc(100dvh-40px)] bg-surface">
        <Toolbar title="New game" />
        <PageBody className="max-w-[720px]">
          <Panel heading="Confirm your email first" bodyClassName="p-3">
            <p className="text-ink-2">
              Listening uses paid services, so Spotter needs to know the address is yours. Open the link Spotter sent you,
              or use &ldquo;Send it again&rdquo; at the top of the page. Your teams and rosters work in the meantime.
            </p>
          </Panel>
        </PageBody>
      </main>
    );
  }

  const [rosters, picks] = await Promise.all([listRosters(user.id), searchParams.then(readSetupPicks)]);

  return (
    <main className="dash min-h-[calc(100dvh-40px)] bg-surface">
      {/* Keyed on the picks, so coming back with a new team opens fresh rather than keeping the last screen. */}
      <GameSetup key={`${picks.away ?? ""}-${picks.home ?? ""}`} rosters={rosters} initialPicks={picks} />
    </main>
  );
}
