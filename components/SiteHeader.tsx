import Link from "next/link";
import { PruneOldLogs, SignOutForm } from "@/components/auth/BrowserData";
import { HELP_HREF, HOME_PATH, NAV_LINKS, SETTINGS_HREF, type NavKey } from "@/lib/ui/nav";
import { SITE_NAME } from "@/lib/ui/site";

// =============================================================================
// The header (docs/UI_STYLE.md, A1). One header, identical on every screen but
// the live one: the same items, in the same order and the same places, at
// every width, signed in or signed out. It takes no
// children and no page content. Its only inputs are which of the four links is
// current and who is signed in; a page's own links and actions go in that
// page's toolbar.
// =============================================================================

const ITEM =
  "flex h-full shrink-0 items-center border-y-2 border-transparent px-3 text-[13px] font-medium transition-colors duration-100";

export function SiteHeader({
  current,
  email,
}: {
  /** The link for the page being shown, or null on a page none of them is. */
  current: NavKey | null;
  /** The signed-in account's email. Null when signed out: the links are disabled and the account items keep their space hidden. */
  email: string | null;
}) {
  const signedOut = email === null;
  return (
    <header className="dash h-10 overflow-x-auto border-b border-line bg-surface">
      <nav aria-label="StatCast" className="flex h-full min-w-max items-center px-4">
        {signedOut ? (
          <span aria-disabled="true" className="shrink-0 pr-2 text-[13px] font-bold tracking-[0.1em] text-disabled">
            STATCAST
          </span>
        ) : (
          <Link href={HOME_PATH} className="flex h-full shrink-0 items-center pr-2 text-[13px] font-bold tracking-[0.1em] text-ink hover:bg-surface-2">
            STATCAST
          </Link>
        )}
        {NAV_LINKS.map((link) =>
          signedOut ? (
            <span key={link.key} aria-disabled="true" className={`${ITEM} text-disabled`}>
              {link.label}
            </span>
          ) : (
            <Link
              key={link.key}
              href={link.href}
              aria-current={current === link.key ? "page" : undefined}
              className={`${ITEM} hover:bg-surface-2 ${current === link.key ? "border-b-ink text-ink" : "text-ink-2"}`}
            >
              {link.label}
            </Link>
          ),
        )}
        <span className="min-w-6 flex-1" />
        {/* Help is a public page, so it works signed out too: the way to a person when sign-in fails. */}
        <Link
          data-header="help"
          href={HELP_HREF}
          className="flex h-full shrink-0 items-center px-3 text-[12px] font-medium text-ink-2 transition-colors duration-100 hover:bg-surface-2"
        >
          Help
        </Link>
        {signedOut ? (
          <span data-header="email" className="shrink-0 px-3 text-[12px] text-muted" style={{ visibility: "hidden" }}>
            Signed in
          </span>
        ) : (
          <Link
            data-header="email"
            href={SETTINGS_HREF}
            title="Settings"
            className="flex h-full shrink-0 items-center px-3 text-[12px] text-muted transition-colors duration-100 hover:bg-surface-2 hover:text-ink"
          >
            {email || "Signed in"}
          </Link>
        )}
        <SignOutForm
          data-header="signout"
          className="flex h-full shrink-0 items-center"
          style={signedOut ? { visibility: "hidden" } : undefined}
        >
          <button
            type="submit"
            tabIndex={signedOut ? -1 : undefined}
            className="h-full cursor-pointer px-3 text-[12px] font-medium text-ink transition-colors duration-100 hover:bg-surface-2"
          >
            Sign out
          </button>
        </SignOutForm>
      </nav>
      <PruneOldLogs />
    </header>
  );
}

/**
 * The bar above the landing, privacy, terms and contact pages for a visitor
 * who is not signed in. Not the dashboard header: a stranger has no dashboard
 * to see disabled links to.
 */
export function PublicHeader() {
  return (
    <header className="dash h-10 border-b border-line bg-surface">
      <nav aria-label={SITE_NAME} className="mx-auto flex h-full max-w-[960px] items-center gap-1 px-4">
        <Link href="/" className="flex h-full shrink-0 items-center pr-2 text-[13px] font-bold tracking-[0.1em] text-ink hover:bg-surface-2">
          STATCAST
        </Link>
        <span className="min-w-2 flex-1" />
        <Link href={HELP_HREF} className="flex h-full shrink-0 items-center px-3 text-[13px] font-medium text-ink-2 hover:bg-surface-2">
          Help
        </Link>
        <Link href="/login" className="flex h-full shrink-0 items-center px-3 text-[13px] font-medium text-ink hover:bg-surface-2">
          Sign in
        </Link>
      </nav>
    </header>
  );
}

// -----------------------------------------------------------------------------
// The live screen's own pieces. It keeps its bar exactly as it was, so these
// stay as they were too.
// -----------------------------------------------------------------------------

/** The wordmark as the live screen and the feedback card draw it. */
export function Wordmark() {
  return (
    <Link
      href={HOME_PATH}
      className="shrink-0 text-sm font-black tracking-[0.3em] text-neutral-600 hover:text-neutral-900"
    >
      STATCAST
    </Link>
  );
}

/** Sign out as the live screen's menu draws it. */
export function SignOutButton() {
  return (
    <SignOutForm>
      <button
        type="submit"
        className="cursor-pointer rounded border border-neutral-300 px-2 py-0.5 text-sm font-semibold text-neutral-800 hover:border-neutral-600"
      >
        Sign out
      </button>
    </SignOutForm>
  );
}
