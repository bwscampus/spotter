import { redirect } from "next/navigation";
import { getViewer } from "./auth";
import type { SessionUser } from "./session";

/** Where an account that has not answered "About you" is sent (Nov 3). */
export const ONBOARDING_PATH = "/onboarding";

/**
 * The signed-in user for a page that reads their data. No session goes to
 * /login; a database outage throws, which shows the error page rather than an
 * empty list that looks like lost data.
 *
 * An account that has not answered or skipped "About you" yet goes to
 * /onboarding first (Nov 3), once: every sign-in lands on /home, which comes
 * through here, and so does every other dashboard page, so an account that
 * existed before onboarding sees it on its next visit too. The onboarding
 * pages themselves pass `onboarding: "skip"`. Settings does not come through
 * here, and the live screen never reads the session, so a game is never
 * interrupted. Call it outside any try: redirect() works by throwing.
 */
export async function pageUser(options: { onboarding?: "skip" } = {}): Promise<SessionUser> {
  const viewer = await getViewer();
  if (viewer.status === "signed_out") redirect("/login");
  if (viewer.status === "unknown" || !viewer.user) throw new Error("Could not check your account just now. Try again in a moment.");
  if (viewer.user.onboarded === false && options.onboarding !== "skip") redirect(ONBOARDING_PATH);
  return viewer.user;
}
