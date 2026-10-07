import { redirect } from "next/navigation";
import { getViewer } from "./auth";
import type { SessionUser } from "./session";

/**
 * The signed-in user for a page that reads their data. No session goes to
 * /login; a database outage throws, which shows the error page rather than an
 * empty list that looks like lost data.
 */
export async function pageUser(): Promise<SessionUser> {
  const viewer = await getViewer();
  if (viewer.status === "signed_out") redirect("/login");
  if (viewer.status === "unknown" || !viewer.user) throw new Error("Could not check your account just now. Try again in a moment.");
  return viewer.user;
}
