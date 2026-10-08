// =============================================================================
// The header's four links and which one is current (docs/UI_STYLE.md, A1).
//
// One header on every screen but the live one, with the same items in the same
// places. Which link is current is the only thing that changes, and it is
// worked out here from the path alone, so it can be tested without a browser.
// =============================================================================

export type NavKey = "home" | "new-game" | "teams" | "past-games";

/** The signed-in dashboard. "/" is the public landing page. */
export const HOME_PATH = "/home";

/** Always all four, always in this order. */
export const NAV_LINKS: ReadonlyArray<{ key: NavKey; label: string; href: string }> = [
  { key: "home", label: "Home", href: HOME_PATH },
  { key: "new-game", label: "New game", href: "/games/new" },
  { key: "teams", label: "Teams", href: "/teams" },
  { key: "past-games", label: "Past games", href: "/games" },
];

/** The header's Help link. A public page, so it works signed out too. */
export const HELP_HREF = "/contact";

/** Where the signed-in email in the header goes. */
export const SETTINGS_HREF = "/settings";

/** How the chrome above a page looks for a path. */
export interface Place {
  /** False only on the live screen, which keeps its own bar. */
  header: boolean;
  /** Sign in and reset password: the header in its signed-out state, whoever is signed in. */
  signedOut: boolean;
  /**
   * The landing page and the legal and contact pages. A signed-out visitor
   * gets the public bar there instead of the dashboard header.
   */
  public: boolean;
  current: NavKey | null;
}

const SIGNED_OUT_PATHS = ["/login", "/reset-password"];
const PUBLIC_PATHS = ["/privacy", "/terms", "/contact"];

function under(path: string, base: string): boolean {
  return path === base || path.startsWith(`${base}/`);
}

export function placeFor(pathname: string | null): Place {
  const path = (pathname || "/").replace(/\/+$/, "") || "/";
  const place = (current: NavKey | null): Place => ({ header: true, signedOut: false, public: false, current });
  if (under(path, "/live")) return { header: false, signedOut: false, public: false, current: null };
  if (SIGNED_OUT_PATHS.some((base) => under(path, base))) return { header: true, signedOut: true, public: false, current: null };
  if (path === "/" || PUBLIC_PATHS.some((base) => under(path, base))) {
    return { header: true, signedOut: false, public: true, current: null };
  }
  if (path === HOME_PATH) return place("home");
  // Setup, its Names page, the sound check, and anything else that is part of starting a game.
  if (["/games/new", "/games/sound-check", "/games/details"].some((base) => under(path, base))) return place("new-game");
  if (under(path, "/games")) return place("past-games");
  if (under(path, "/teams")) return place("teams");
  return place(null);
}
