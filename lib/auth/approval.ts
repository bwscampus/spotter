/**
 * Where an account stands, read on the server from the session and users.approved
 * (lib/server/auth.ts). Shared with the browser, which only shows and hides things.
 *
 * - signed_out: no valid session.
 * - waiting: signed in, not approved yet. Can use everything that costs nothing.
 * - approved: can use everything.
 * - unknown: the session could not be read (the database is down). Treated as
 *   not approved wherever money is spent.
 */
export type Approval =
  | { status: "signed_out" }
  | { status: "waiting"; userId: string }
  | { status: "approved"; userId: string }
  | { status: "unknown" };

/** The line on the banner and beside every disabled button. */
export const WAITING_NOTE = "Your account is waiting for approval.";
