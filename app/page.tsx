import Link from "next/link";
import { CurrentGame } from "@/components/game/CurrentGame";
import { SiteHeader } from "@/components/SiteHeader";

const COMMIT = process.env.NEXT_PUBLIC_GIT_COMMIT ?? "unknown";

/**
 * The menu. Everything starts here: a new game, the game still in progress in
 * this browser, and the teams. The commit is at the bottom so a branch link can
 * be matched to the pull request it was built from at a glance.
 */
export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader>
        <Link href="/teams" className="text-sm text-neutral-600 hover:text-neutral-900">
          Teams
        </Link>
        <Link href="/games" className="text-sm text-neutral-600 hover:text-neutral-900">
          Past games
        </Link>
      </SiteHeader>
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-6">
        <CurrentGame />
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/games/new"
            className="rounded-md border border-neutral-800 bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-700"
          >
            New game
          </Link>
          <Link
            href="/teams"
            className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-800 hover:border-neutral-600"
          >
            Teams
          </Link>
          <Link
            href="/games"
            className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-800 hover:border-neutral-600"
          >
            Past games
          </Link>
        </div>
        <p className="mt-auto text-xs text-neutral-500">
          Built from commit{" "}
          <code title={COMMIT} className="font-mono">
            {COMMIT.slice(0, 7)}
          </code>
        </p>
      </main>
    </div>
  );
}
