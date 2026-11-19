// =============================================================================
// Where a sign-up came from (Nov 19, the UX overhaul's Phase 0): the landing
// page, the demo, the sign-in page itself, or nowhere we know. It rides the
// sign-up links as ?from=, through the form to POST /api/auth/signup (and the
// Google button), and onto account.signed_up as `from`. Nothing tracks a
// visitor who does not sign up. Pure, so the browser and the route share it.
// =============================================================================

export const SIGNUP_SOURCES = ["landing", "demo", "login", "direct"] as const;
export type SignupSource = (typeof SIGNUP_SOURCES)[number];

/** The source a ?from= value or a request body names, or `fallback` for anything else. */
export function readSignupSource(value: unknown, fallback: SignupSource = "direct"): SignupSource {
  return typeof value === "string" && (SIGNUP_SOURCES as readonly string[]).includes(value) ? (value as SignupSource) : fallback;
}

/** The sign-up link for a page: /login in sign-up mode, saying where it was clicked. */
export function signupHref(from: Exclude<SignupSource, "direct">): string {
  return `/login?mode=signup&from=${from}`;
}
