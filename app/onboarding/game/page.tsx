import type { Metadata } from "next";
import { GameWalkthrough } from "@/components/onboarding/GameWalkthrough";
import { PageBody, Toolbar } from "@/components/ui/Toolbar";
import { readSetupPicks, type SearchParams } from "@/lib/game/setupReturn";
import { pageUser } from "@/lib/server/pageUser";
import { getAbout } from "@/lib/server/repo/account";
import { getDraft } from "@/lib/server/repo/games";
import { listRosters } from "@/lib/server/repo/rosters";

export const metadata: Metadata = { title: "Set up your next game" };

type WalkthroughProps = { searchParams: Promise<SearchParams> };

/**
 * "Set up your next game" (Nov 3): after "About you" for an account with
 * fewer than two teams, and from Home's big button. `?draft=…` resumes a draft
 * at its first missing step; another account's draft id opens a fresh one.
 */
export default async function Walkthrough({ searchParams }: WalkthroughProps) {
  const user = await pageUser({ onboarding: "skip" });
  const { draft: draftId } = readSetupPicks(await searchParams);
  const [about, teams, draft] = await Promise.all([
    getAbout(user.id),
    listRosters(user.id),
    draftId ? getDraft(user.id, draftId) : Promise.resolve(null),
  ]);

  return (
    <main className="dash min-h-[calc(100dvh-40px)] bg-surface">
      <Toolbar title="Set up your next game" />
      <PageBody>
        <GameWalkthrough initialDraft={draft} teams={teams} mySports={about.sports} canImport={user.emailVerified} email={user.email} />
      </PageBody>
    </main>
  );
}
