const COMMIT = process.env.NEXT_PUBLIC_GIT_COMMIT ?? "unknown";

/**
 * Placeholder menu until port/app brings over New game, the current game and
 * Teams. The commit is at the bottom so a deploy can be matched to the pull
 * request it was built from at a glance.
 */
export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 p-6">
      <h1 className="text-2xl font-bold">Spotter</h1>
      <p className="text-neutral-700">Live name spotting for sports broadcasters.</p>
      <p className="mt-auto text-xs text-neutral-500">
        Built from commit{" "}
        <code title={COMMIT} className="font-mono">
          {COMMIT.slice(0, 7)}
        </code>
      </p>
    </main>
  );
}
