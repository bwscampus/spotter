import { GameSetup } from "@/components/game/GameSetup";
import { Panel } from "@/components/ui/Panel";
import { PageBody, Toolbar } from "@/components/ui/Toolbar";
import { readSetupPicks, type SearchParams } from "@/lib/game/setupReturn";
import { pageUser } from "@/lib/server/pageUser";
import { getDraft } from "@/lib/server/repo/games";
import { listRosters } from "@/lib/server/repo/rosters";

type NewGameProps = { searchParams: Promise<SearchParams> };

/**
 * Pick the away and home rosters, read the warnings, start. docs/V3_DEFINITION.md 7.1.
 * `?away=…&home=…` opens with those teams picked, which is how adding a team
 * or updating its stats comes back here. `?draft=…` opens a draft game.
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
        <PageBody>
          <Panel heading="Confirm your email first" bodyClassName="p-3">
            <p className="text-ink-2">
              Listening uses paid services, so StatCast needs to know the address is yours. Open the link StatCast sent you,
              or use &ldquo;Send it again&rdquo; at the top of the page. Your teams and rosters work in the meantime.
            </p>
          </Panel>
        </PageBody>
      </main>
    );
  }

  const [rosters, picks] = await Promise.all([listRosters(user.id), searchParams.then(readSetupPicks)]);
  // A draft game (Nov 3) opens with what it saved; a team just added on one
  // side (the URL's pick) wins over the draft's for that side. Another
  // account's draft, or one already started, opens plain setup.
  const draft = picks.draft ? await getDraft(user.id, picks.draft) : null;
  const opening = { away: picks.away ?? draft?.awayId ?? null, home: picks.home ?? draft?.homeId ?? null };

  return (
    <main className="dash min-h-[calc(100dvh-40px)] bg-surface">
      {/* Keyed on the picks and the draft, so coming back with a new team opens fresh rather than keeping the last screen. */}
      <GameSetup key={`${opening.away ?? ""}-${opening.home ?? ""}-${draft?.id ?? ""}`} rosters={rosters} initialPicks={opening} draft={draft} />
    </main>
  );
}
