import type { Metadata } from "next";
import { BoothDraft } from "@/components/booth/BoothDraft";
import { TextLink } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { PageBody, Toolbar } from "@/components/ui/Toolbar";
import { pageUser } from "@/lib/server/pageUser";
import { guestGame } from "@/lib/server/repo/booth";
import { UUID } from "@/lib/server/route";

export const metadata: Metadata = { title: "Booth game" };

type BoothGameProps = { params: Promise<{ gameId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * Booth partners (Nov 15): a game this account joined as a guest. Only while
 * he is an active guest and the host's game is a draft or live; otherwise it
 * says the game is no longer open to him.
 */
export default async function BoothGame({ params, searchParams }: BoothGameProps) {
  const user = await pageUser();
  const { gameId } = await params;
  const { go } = await searchParams;
  const game = UUID.test(gameId) ? await guestGame(user.id, gameId) : null;

  return (
    <main className="dash min-h-[calc(100dvh-40px)] bg-surface">
      <Toolbar title="Booth game" crumbs={[{ label: "Games", href: "/games" }]} />
      <PageBody>
        <Panel heading="Your partner's game" bodyClassName="p-4">
          {!game ? (
            <p className="text-ink-2">
              This game isn&apos;t open to you: it ended, or the host took you out of the booth. Your games are on the{" "}
              <TextLink href="/games">Games page</TextLink>.
            </p>
          ) : !user.emailVerified ? (
            <p className="text-ink-2">
              Confirm your email first: listening uses paid services, so StatCast needs to know the address is yours. Open the link
              StatCast sent you, or use &ldquo;Send it again&rdquo; at the top of the page. This game waits for you here.
            </p>
          ) : (
            <BoothDraft game={game} autoStart={go === "1"} />
          )}
        </Panel>
      </PageBody>
    </main>
  );
}
