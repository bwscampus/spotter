import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ButtonLink } from "@/components/ui/Button";
import { PublicFooter } from "@/components/PublicFooter";
import { getViewerId } from "@/lib/auth/viewer";
import { HOME_PATH } from "@/lib/ui/nav";
import { SITE_NAME, TAGLINE } from "@/lib/ui/site";

export const metadata: Metadata = {
  title: { absolute: `${SITE_NAME}: Announcing Sports, Easily` },
};

const STEPS = [
  {
    title: "Save both teams' rosters",
    body: "From any PDF, photo, spreadsheet or pasted list. StatCast reads the names and numbers, and you check them.",
  },
  {
    title: "Open it in the booth",
    body: "Chrome on a laptop, with a microphone that hears you. Run a sound check on the names first.",
  },
  {
    title: "Call the game",
    body: "Say a player's name, or a number with a cue like \"number 22\", and their card is on screen.",
  },
];

/**
 * The public landing page. A signed-in visitor goes straight to Home.
 * docs/UI_STYLE.md: flat, the dashboard's tokens and type, no pictures.
 */
export default async function Landing() {
  if ((await getViewerId()) !== null) redirect(HOME_PATH);

  return (
    <div className="dash flex min-h-[calc(100dvh-40px)] flex-col bg-surface">
      <main className="mx-auto flex w-full max-w-[960px] flex-col gap-10 px-4 py-10 sm:py-16">
        <section className="flex flex-col gap-4">
          <h1 className="text-[32px] font-bold leading-tight text-ink sm:text-[44px]">{SITE_NAME}</h1>
          <p className="max-w-[640px] text-[17px] leading-relaxed text-ink sm:text-[19px]">{TAGLINE}</p>
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <ButtonLink variant="primary" href="/login?mode=signup" className="h-10 px-5 text-[15px]">
              Create account
            </ButtonLink>
            <ButtonLink href="/login" className="h-10 px-5 text-[15px]">
              Sign in
            </ButtonLink>
          </div>
          <p className="flex items-center gap-2 text-[13px] text-ink-2">
            <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-amber-dot" />
            Needs Chrome on a laptop or desktop with a microphone.
          </p>
        </section>

        <section aria-labelledby="how" className="flex flex-col gap-3">
          <h2 id="how" className="text-[12px] font-semibold uppercase tracking-[0.04em] text-ink-2">
            How it works
          </h2>
          <ol className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {STEPS.map((step, index) => (
              <li key={step.title} className="flex flex-col gap-1 rounded-[3px] border border-line bg-surface p-4">
                <span className="font-num text-[12px] text-muted">{index + 1}</span>
                <span className="text-[15px] font-semibold text-ink">{step.title}</span>
                <span className="text-[13px] leading-relaxed text-ink-2">{step.body}</span>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="who" className="flex max-w-[720px] flex-col gap-2">
          <h2 id="who" className="text-[12px] font-semibold uppercase tracking-[0.04em] text-ink-2">
            Who it is for
          </h2>
          <p className="text-[15px] leading-relaxed text-ink">
            Announcers at high school games, on the PA or on a stream. It works for any sport with a roster: football,
            volleyball, basketball, soccer, baseball and more. The card shows the jersey number, the name and how to say it,
            and season stats if you add them.
          </p>
        </section>

        <section aria-labelledby="accounts" className="flex max-w-[720px] flex-col gap-2 rounded-[3px] border border-line bg-surface-2 p-4">
          <h2 id="accounts" className="text-[12px] font-semibold uppercase tracking-[0.04em] text-ink-2">
            New accounts
          </h2>
          <p className="text-[13px] leading-relaxed text-ink">
            Sign up with Google, or with your email and a password, and everything is open at once: import rosters, set up
            a game and go live.
          </p>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
