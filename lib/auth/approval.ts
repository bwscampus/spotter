/**
 * Where an account stands, read on the server from the session and users.approved
 * (lib/server/auth.ts). Shared with the browser, which only shows and hides things.
 *
 * - signed_out: no valid session.
 * - waiting: signed in, but switched off (users.approved = false; there is no
 *   approval step, so only the owner switching an account off causes this).
 *   Can use everything that costs nothing.
 * - approved: can use everything (an email account must also have confirmed
 *   its address before anything that costs money: requireVerifiedUser).
 * - unknown: the session could not be read (the database is down). Treated as
 *   not approved wherever money is spent.
 */
export type Approval =
  | { status: "signed_out" }
  | { status: "waiting"; userId: string }
  | { status: "approved"; userId: string }
  | { status: "unknown" };

