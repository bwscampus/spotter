import type { Metadata } from "next";
import { JoinGame } from "@/components/booth/JoinGame";
import { ButtonLink } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { PageBody, Toolbar } from "@/components/ui/Toolbar";
import { loginHref } from "@/lib/auth/next";
import { getViewer } from "@/lib/server/auth";

export const metadata: Metadata = { title: "Join a game" };

/**
 * Booth partners (Nov 15): "Join a game" from Home. Type the 4-character code
 * your partner's game shows, and his game shows up in your games as a draft.
 * Signed out, it sends you to sign in and back here.
 */
export default async function JoinByCode() {
  const viewer = await getViewer();
  const user = viewer.status === "approved" || viewer.status === "waiting" ? viewer.user : null;
  return (
    <main className="dash min-h-[calc(100dvh-40px)] bg-surface">
      <Toolbar title="Join a game" />
      <PageBody>
        <Panel heading="Call a game with your booth partner" bodyClassName="p-4">
          {user ? (
            <JoinGame needsRoles={user.onboarded === false} />
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-ink-2">Sign in or make a free account, then type your partner&apos;s code.</p>
              <div className="flex gap-2">
                <ButtonLink variant="primary" href={loginHref("/join", "signup")}>
                  Create account
                </ButtonLink>
                <ButtonLink href={loginHref("/join")}>Sign in</ButtonLink>
              </div>
            </div>
          )}
        </Panel>
      </PageBody>
    </main>
  );
}
