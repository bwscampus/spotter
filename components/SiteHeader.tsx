import Link from "next/link";
import { WAITING_NOTE } from "@/lib/auth/approval";

// The wordmark is the app's identity and sits top left on every screen. There
// are no per-page headings and no nav: everything starts from the menu, which
// is what the wordmark links back to.
export function Wordmark() {
  return (
    <Link
      href="/"
      className="shrink-0 text-sm font-black tracking-[0.3em] text-neutral-600 hover:text-neutral-900"
    >
      SPOTTER
    </Link>
  );
}

export function SignOutButton() {
  return (
    <form method="post" action="/auth/signout">
      <button
        type="submit"
        className="cursor-pointer rounded border border-neutral-300 px-2 py-0.5 text-sm font-semibold text-neutral-800 hover:border-neutral-600"
      >
        Sign out
      </button>
    </form>
  );
}

/** Wordmark left, anything the screen adds in the middle, sign out right. */
export function SiteHeader({ children }: { children?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-neutral-200 px-6 py-4">
      <Wordmark />
      {children}
      <div className="ml-auto">
        <SignOutButton />
      </div>
    </header>
  );
}

/**
 * Across the top of every page while the account waits for approval. It
 * carries its own Sign out, because someone who signed in with the wrong
 * account needs a way out from any page.
 */
export function WaitingBanner() {
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-amber-300 bg-amber-50 px-6 py-3 text-amber-900"
    >
      <p className="text-sm font-semibold">{WAITING_NOTE}</p>
      <div className="ml-auto">
        <SignOutButton />
      </div>
    </div>
  );
}
