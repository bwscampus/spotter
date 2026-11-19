import type { Metadata } from "next";
import { AcceptPartner } from "@/components/booth/AcceptPartner";
import { JoinRoles } from "@/components/booth/JoinRoles";
import { ButtonLink } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { PageBody, Toolbar } from "@/components/ui/Toolbar";
import { loginHref } from "@/lib/auth/next";
import { isBoothToken, partnerPath } from "@/lib/booth/code";
import { getViewer } from "@/lib/server/auth";
import { partnerInviteHost } from "@/lib/server/repo/booth";

export const metadata: Metadata = { title: "Booth partner" };

type PartnerProps = { params: Promise<{ token: string }> };

/**
 * Booth partners (Nov 15): the link a saved-partner invite emails. Signed
 * out, sign in or make an account and come back here; signed in, it says who
 * asked and accepts on a click. A new account answers the one question first.
 */
export default async function BoothPartnerInvite({ params }: PartnerProps) {
  const { token } = await params;
  const viewer = await getViewer();
  const user = viewer.status === "approved" || viewer.status === "waiting" ? viewer.user : null;
  const host = user && isBoothToken(token) ? await partnerInviteHost(token) : null;

  return (
    <main className="dash min-h-[calc(100dvh-48px)] bg-page">
      <Toolbar title="Booth partner" />
      <PageBody>
        <Panel heading="Be a booth partner on StatCast" bodyClassName="p-4">
          {!isBoothToken(token) ? (
            <p className="text-ink-2">That link isn&apos;t complete. Open it from the email again.</p>
          ) : !user ? (
            <div className="flex flex-col gap-3">
              <p className="text-ink-2">
                An announcer wants you as a booth partner: their games show up in your account too, and the cards from both of your mics
                show on both screens. Sign in or make a free account to see who, and accept.
              </p>
              <div className="flex gap-2">
                <ButtonLink variant="primary" href={loginHref(partnerPath(token), "signup")}>
                  Create account
                </ButtonLink>
                <ButtonLink href={loginHref(partnerPath(token))}>Sign in</ButtonLink>
              </div>
            </div>
          ) : !host ? (
            <p className="text-ink-2">That invite isn&apos;t open any more: it was accepted, or taken back. Ask for a new one.</p>
          ) : (
            <JoinRoles needsRoles={user.onboarded === false}>
              <p className="mb-3 text-ink-2">
                <span className="font-semibold">{host}</span> wants you as a booth partner. Their new games will show up in your games,
                ready to start.
              </p>
              <AcceptPartner token={token} />
            </JoinRoles>
          )}
        </Panel>
      </PageBody>
    </main>
  );
}
