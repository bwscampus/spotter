import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AboutYou } from "@/components/onboarding/AboutYou";
import { Panel } from "@/components/ui/Panel";
import { PageBody, Toolbar } from "@/components/ui/Toolbar";
import { pageUser } from "@/lib/server/pageUser";
import { getAbout } from "@/lib/server/repo/account";
import { listRosters } from "@/lib/server/repo/rosters";

export const metadata: Metadata = { title: "About you" };

/**
 * "About you" (Nov 3, Jed), shown once: right after the first sign-in, and to
 * any account that existed before onboarding on its next visit (pageUser
 * sends it here). Continue or Skip stamps onboarded_at, then an account with
 * fewer than two saved teams is walked through setting up its next game, and
 * everyone else goes Home. Answers are edited later in Settings.
 */
export default async function AboutYouPage() {
  const user = await pageUser({ onboarding: "skip" });
  if (user.onboarded) redirect("/home");
  const [about, teams] = await Promise.all([getAbout(user.id), listRosters(user.id)]);

  return (
    <main className="dash min-h-[calc(100dvh-40px)] bg-surface">
      <Toolbar title="Welcome to StatCast" />
      <PageBody>
        <Panel heading="About you" bodyClassName="p-4">
          <AboutYou initial={{ sports: about.sports, roles: about.roles }} mode="onboarding" teamCount={teams.length} />
        </Panel>
      </PageBody>
    </main>
  );
}
