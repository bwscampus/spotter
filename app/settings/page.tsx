import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DeleteAccount } from "@/components/auth/DeleteAccount";
import { TextLink } from "@/components/ui/Button";
import { Panel, PanelRow } from "@/components/ui/Panel";
import { PageBody, Toolbar } from "@/components/ui/Toolbar";
import { getViewerEmail, getViewerId } from "@/lib/auth/viewer";
import { hasPassword } from "@/lib/server/repo/account";
import { CONTACT_EMAIL, CONTACT_MAILTO } from "@/lib/ui/site";

export const metadata: Metadata = { title: "Settings" };

/** The signed-in account: its email, where it stands, and the way out. */
export default async function Settings() {
  const [email, id] = await Promise.all([getViewerEmail(), getViewerId()]);
  if (email === null || id === null) redirect("/login");
  // A password account types its password to delete; a Google one needs a recent sign-in (AUTH-5).
  const passwordAccount = await hasPassword(id).catch(() => false);

  return (
    <main className="dash min-h-[calc(100dvh-40px)] bg-surface">
      <Toolbar title="Settings" />
      <PageBody className="max-w-[720px]">
        <Panel heading="Account">
          <PanelRow label="Email">
            <span className="text-ink">{email || "No email on this account"}</span>
          </PanelRow>
        </Panel>

        <Panel heading="Delete my account" bodyClassName="flex flex-col gap-3 p-3">
          <p className="text-ink-2">
            Deletes your account, your teams, rosters, season stats, past games, feedback, and any game logs you shared. It
            also clears the game and game logs kept in this browser. Game logs kept in another browser stay there until you
            clear that browser. See the <TextLink href="/privacy">privacy policy</TextLink> for what is kept.
          </p>
          <DeleteAccount hasPassword={passwordAccount} />
          <p className="text-[12px] text-muted">
            Problems? Email <a href={CONTACT_MAILTO} className="text-accent hover:underline">{CONTACT_EMAIL}</a>.
          </p>
        </Panel>
      </PageBody>
    </main>
  );
}
