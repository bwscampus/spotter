// =============================================================================
// Booth partners (Nov 15): where a sign-in goes back to. An invited announcer
// who is signed out opens /join/<token> (or /join to type a code, or a saved
// partner's /booth-partner/<token>), signs in or makes an account, and comes
// straight back to that step instead of Home.
//
// Only those paths, written exactly so, ever: anything else (another site, a
// "//" path, a backslash, a query string) is refused and the sign-in goes Home
// as it always did, so this is no open redirect.
// =============================================================================

const TOKEN = "[A-Za-z0-9_-]{43}";
const ALLOWED = new RegExp(`^/(?:join(?:/${TOKEN})?|booth-partner/${TOKEN})$`);

export function safeNext(value: unknown): string | null {
  return typeof value === "string" && ALLOWED.test(value) ? value : null;
}

/** "/login?next=/join/..." for a page that needs the visitor signed in first. */
export function loginHref(next: string, mode: "signin" | "signup" = "signin"): string {
  const query = new URLSearchParams({ next });
  if (mode === "signup") query.set("mode", "signup");
  return `/login?${query.toString()}`;
}

/** Set by a sign-up made on the way to a booth, so the join can say booth.guest_signed_up once. */
export const BOOTH_SIGNUP_KEY = "spotter.v3.booth-signup";

export function markBoothSignUp(): void {
  try {
    sessionStorage.setItem(BOOTH_SIGNUP_KEY, "1");
  } catch {
    // Only the event is lost.
  }
}

/** True once, in the tab that signed up on its way to a booth. */
export function takeBoothSignUp(): boolean {
  try {
    const was = sessionStorage.getItem(BOOTH_SIGNUP_KEY) === "1";
    sessionStorage.removeItem(BOOTH_SIGNUP_KEY);
    return was;
  } catch {
    return false;
  }
}
