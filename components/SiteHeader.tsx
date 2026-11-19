import { CircleHelp, House, LogOut, Menu, Play, Plus, Trophy, Users } from "lucide-react";
import Link from "next/link";
import type { ComponentType } from "react";
import { PruneOldLogs, SignOutForm } from "@/components/auth/BrowserData";
import { HELP_HREF, HOME_PATH, NAV_LINKS, SETTINGS_HREF, type NavKey } from "@/lib/ui/nav";
import { SITE_NAME } from "@/lib/ui/site";

// =============================================================================
// The header (docs/UI_STYLE.md, A1; the Broadcast look, Nov 19). One header,
// identical on every screen but the live one: a navy bar with the same items
// in the same order, signed in or signed out. It takes no children and no page
// content. Its only inputs are which of the four links is current and who is
// signed in; a page's own links and actions go in that page's toolbar.
//
// From 640px up every item is in the bar. Under 640px (a phone) the bar keeps
// the wordmark and folds the same items, in the same order, into a Menu.
// =============================================================================

const ICONS: Record<NavKey, ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = {
  home: House,
  "new-game": Plus,
  teams: Users,
  "past-games": Trophy,
};

const ICON = "size-4 shrink-0";

const ITEM =
  "flex h-full shrink-0 items-center gap-1.5 border-y-[3px] border-transparent px-3 text-[16px] font-medium transition-colors duration-150";

const MENU_ITEM = "flex h-11 items-center gap-2 px-4 text-[16px] font-medium";

/** The wordmark, with a bright square before it: the one bit of highlight in the bar when nothing is current. */
const WORDMARK =
  "flex h-full shrink-0 items-center gap-2 pr-3 text-[16px] font-bold tracking-[0.12em] " +
  "before:inline-block before:size-2.5 before:shrink-0 before:rounded-[2px] before:bg-highlight before:content-['']";

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
    <header className="dash relative flex h-12 items-stretch bg-navy text-on-navy">
      <nav aria-label="StatCast" className="flex h-full min-w-0 flex-1 items-center px-4">
        {signedOut ? (
          <span data-item aria-disabled="true" className={`${WORDMARK} text-on-navy-disabled`}>
            STATCAST
          </span>
        ) : (
          <Link data-item href={HOME_PATH} className={`${WORDMARK} text-on-navy hover:text-highlight`}>
            STATCAST
          </Link>
        )}
        {NAV_LINKS.map((link) => {
          const Icon = ICONS[link.key];
          return signedOut ? (
            <span key={link.key} data-item aria-disabled="true" className={`${ITEM} text-on-navy-disabled max-sm:hidden`}>
              <Icon aria-hidden className={ICON} />
              <span>{link.label}</span>
            </span>
          ) : (
            <Link
              key={link.key}
              data-item
              href={link.href}
              aria-current={current === link.key ? "page" : undefined}
              className={`${ITEM} max-sm:hidden hover:bg-navy-2 ${current === link.key ? "border-b-highlight text-on-navy" : "text-on-navy-2 hover:text-on-navy"}`}
            >
              <Icon aria-hidden className={ICON} />
              <span>{link.label}</span>
            </Link>
          );
        })}
        <span className="min-w-6 flex-1" />
        {/* Help is a public page, so it works signed out too: the way to a person when sign-in fails. */}
        <Link
          data-item
          data-header="help"
          href={HELP_HREF}
          className="flex h-full shrink-0 items-center gap-1.5 px-3 text-[14px] font-medium text-on-navy-2 transition-colors duration-150 hover:bg-navy-2 hover:text-on-navy max-sm:hidden"
        >
          <CircleHelp aria-hidden className={ICON} />
          <span>Help</span>
        </Link>
        {signedOut ? (
          <span data-item data-header="email" className="shrink-0 px-3 text-[14px] max-sm:hidden" style={{ visibility: "hidden" }}>
            Signed in
          </span>
        ) : (
          <Link
            data-item
            data-header="email"
            href={SETTINGS_HREF}
            title="Settings"
            className="flex h-full max-w-[280px] shrink-0 items-center truncate px-3 text-[14px] text-on-navy-2 transition-colors duration-150 hover:bg-navy-2 hover:text-on-navy max-md:hidden"
          >
            {email || "Signed in"}
          </Link>
        )}
        <SignOutForm
          data-header="signout"
          className="flex h-full shrink-0 items-center max-sm:hidden"
          style={signedOut ? { visibility: "hidden" } : undefined}
        >
          <button
            data-item
            type="submit"
            tabIndex={signedOut ? -1 : undefined}
            className="h-full cursor-pointer px-3 text-[14px] font-medium text-on-navy transition-colors duration-150 hover:bg-navy-2"
          >
            Sign out
          </button>
        </SignOutForm>
      </nav>
      <PhoneMenu current={current} email={email} />
      <PruneOldLogs />
    </header>
  );
}

/**
 * Under 640px: the same items, in the same order, behind one Menu button. A
 * <details>, so it opens with no script and closes with a second tap.
 */
function PhoneMenu({ current, email }: { current: NavKey | null; email: string | null }) {
  const signedOut = email === null;
  return (
    <details data-header="menu" className="group relative flex items-center sm:hidden">
      <summary className="flex h-12 cursor-pointer items-center gap-1.5 px-4 text-[16px] font-medium text-on-navy hover:bg-navy-2">
        <Menu aria-hidden className="size-5" />
        <span>Menu</span>
      </summary>
      <nav
        aria-label="StatCast menu"
        className="fade-in absolute right-2 top-full z-50 w-64 overflow-hidden rounded-[6px] border border-line bg-surface py-1 text-ink shadow-panel"
      >
        {NAV_LINKS.map((link) => {
          const Icon = ICONS[link.key];
          return signedOut ? (
            <span key={link.key} aria-disabled="true" className={`${MENU_ITEM} text-disabled`}>
              <Icon aria-hidden className={ICON} />
              {link.label}
            </span>
          ) : (
            <Link
              key={link.key}
              href={link.href}
              aria-current={current === link.key ? "page" : undefined}
              className={`${MENU_ITEM} hover:bg-surface-2 ${current === link.key ? "border-l-[3px] border-highlight pl-[13px] font-semibold" : ""}`}
            >
              <Icon aria-hidden className={ICON} />
              {link.label}
            </Link>
          );
        })}
        <div className="my-1 border-t border-line" />
        <Link href={HELP_HREF} className={`${MENU_ITEM} hover:bg-surface-2`}>
          <CircleHelp aria-hidden className={ICON} />
          Help
        </Link>
        {!signedOut && (
          <>
            <Link href={SETTINGS_HREF} className={`${MENU_ITEM} truncate text-[14px] text-muted hover:bg-surface-2`}>
              {email || "Settings"}
            </Link>
            <SignOutForm className="flex">
              <button type="submit" className={`${MENU_ITEM} w-full cursor-pointer hover:bg-surface-2`}>
                <LogOut aria-hidden className={ICON} />
                Sign out
              </button>
            </SignOutForm>
          </>
        )}
      </nav>
    </details>
  );
}

/**
 * The bar above the public pages (landing, demo, help, privacy, terms,
 * contact) for a visitor who is not signed in. Not the dashboard header: a
 * stranger has no dashboard to see disabled links to.
 */
export function PublicHeader() {
  return (
    <header className="dash h-12 bg-navy text-on-navy">
      <nav aria-label={SITE_NAME} className="mx-auto flex h-full max-w-[1200px] items-center gap-1 px-4">
        <Link href="/" className={`${WORDMARK} text-on-navy hover:text-highlight`}>
          STATCAST
        </Link>
        <span className="min-w-2 flex-1" />
        <Link
          href="/demo"
          className="flex h-full shrink-0 items-center gap-1.5 px-3 text-[16px] font-medium text-on-navy-2 transition-colors duration-150 hover:bg-navy-2 hover:text-on-navy"
        >
          <Play aria-hidden className={`${ICON} max-sm:hidden`} />
          <span className="max-sm:hidden">Try the demo</span>
          <span className="sm:hidden">Demo</span>
        </Link>
        <Link
          href={HELP_HREF}
          className="flex h-full shrink-0 items-center px-3 text-[16px] font-medium text-on-navy-2 transition-colors duration-150 hover:bg-navy-2 hover:text-on-navy"
        >
          Help
        </Link>
        <Link
          href="/login"
          className="flex h-full shrink-0 items-center px-3 text-[16px] font-semibold text-on-navy transition-colors duration-150 hover:bg-navy-2"
        >
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
    <Link href={HOME_PATH} className="shrink-0 text-sm font-black tracking-[0.3em] text-neutral-600 hover:text-neutral-900">
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
