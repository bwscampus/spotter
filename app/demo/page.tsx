import type { Metadata } from "next";
import Link from "next/link";
import { DemoStage } from "@/components/demo/DemoStage";
import { ButtonLink } from "@/components/ui/Button";
import { signupHref } from "@/lib/auth/signupSource";

export const metadata: Metadata = {
  title: "Try StatCast",
  description: "Watch player cards go up the moment an announcer says a name or a number. Made-up teams, no account needed.",
};

/**
 * The public demo (Nov 19): anyone, signed in or not, can watch a made-up
 * football game called and see the cards go up, then type or say a line of
 * their own. Everything runs in the browser (components/demo/DemoStage.tsx).
 */
export default function Demo() {
  return (
    <main className="dash min-h-[calc(100dvh-48px)] bg-page">
      <section className="bg-[#0b1f3a] text-white">
        <div className="mx-auto flex w-full max-w-[1400px] flex-wrap items-end justify-between gap-4 px-6 py-8">
          <div className="flex max-w-[760px] flex-col gap-2">
            <p className="text-[14px] font-semibold uppercase tracking-[0.08em] text-[#ffb547]">Try it, no account needed</p>
            <h1 className="text-[32px] font-bold leading-tight">Say a name. The card is already up.</h1>
            <p className="text-[18px] text-white/80">
              Harborview hosts Millbrook, two made-up teams. Press Play to hear the booth call a few drives, and watch each
              player&apos;s card go up the moment their name or number is said. Scores, downs and the clock never put a card up.
            </p>
          </div>
          <ButtonLink variant="primary" href={signupHref("demo")} className="h-12 px-6 text-[18px]">
            Set this up for your team, free
          </ButtonLink>
        </div>
      </section>
      <div className="mx-auto w-full max-w-[1400px] px-6 py-6">
        <DemoStage />
        <p className="pt-6 text-[14px] text-muted">
          In a real game StatCast listens to your mic and uses your own rosters and season stats. Setting up a team takes a
          roster file, a photo or a pasted list. <Link href="/" className="text-accent hover:underline">How StatCast works</Link>
        </p>
      </div>
    </main>
  );
}
