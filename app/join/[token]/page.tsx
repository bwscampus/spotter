import type { Metadata } from "next";
import { JoinGame } from "@/components/booth/JoinGame";
import { ButtonLink } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { PageBody, Toolbar } from "@/components/ui/Toolbar";
import { loginHref } from "@/lib/auth/next";
import { isBoothToken, joinPath } from "@/lib/booth/code";
import { isSport } from "@/lib/rosters/types";
import { getViewer } from "@/lib/server/auth";
import { inviteSport } from "@/lib/server/repo/booth";

export const metadata: Metadata = { title: "Join a game" };

type JoinProps = { params: Promise<{ token: string }> };

/**
 * Booth partners (Nov 15): the invite link. Signed out, it says what it is
 * and offers sign-in or a new account, which come straight back here. Signed
 * in, it joins (after the one question, for a new account) and opens the
 * game. Nothing about the game is shown to a visitor who is not signed in.
 */
export default async function JoinByLink({ params }: JoinProps) {
  const { token } = await params;
  const viewer = await getViewer();
  const user = viewer.status === "approved" || viewer.status === "waiting" ? viewer.user : null;
  const valid = isBoothToken(token);
  const sport = user && valid && user.onboarded === false ? await inviteSport(token) : null;

  return (
    <main className="dash min-h-[calc(100dvh-48px)] bg-page">
      <Toolbar title="Join a game" />
      <PageBody>
        <Panel heading="You're invited to call a game on StatCast" bodyClassName="p-4">
          {!valid ? (
            <p className="text-ink-2">That link isn&apos;t complete. Ask your partner to copy it again.</p>
          ) : user ? (
            <JoinGame token={token} needsRoles={user.onboarded === false} sport={isSport(sport) ? sport : null} />
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-ink-2">
                Your booth partner set up the game. Sign in or make a free account and it shows up in your games, with their rosters
                ready. Cards from either of your mics show on both screens.
              </p>
              <div className="flex gap-2">
                <ButtonLink variant="primary" href={loginHref(joinPath(token), "signup")}>
                  Create account
                </ButtonLink>
                <ButtonLink href={loginHref(joinPath(token))}>Sign in</ButtonLink>
              </div>
            </div>
          )}
        </Panel>
      </PageBody>
    </main>
  );
}
