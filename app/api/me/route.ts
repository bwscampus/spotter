import { deleteAccount, passwordHash } from "@/lib/server/repo/account";
import { verifyPassword } from "@/lib/server/password";
import { failure, forUser, json, readJson } from "@/lib/server/route";
import { endSession } from "@/lib/server/session";

// DELETE: deletes the signed-in account and everything in it (AUTH-6), then
// ends this browser's session. A sensitive change needs fresh proof of who is
// asking (AUTH-5): the current password for a password account, and for a
// Google account a sign-in within the last REAUTH_MINUTES, so a session left
// open on a shared laptop cannot wipe the account.

const REAUTH_MINUTES = 10;

export function DELETE(request: Request) {
  return forUser(request, async ({ user }) => {
    const read = await readJson(request, 4 * 1024);
    const body = read.ok && typeof read.body === "object" && read.body !== null ? (read.body as { password?: unknown }) : {};

    const stored = await passwordHash(user.id);
    if (stored) {
      if (typeof body.password !== "string" || !(await verifyPassword(body.password, stored))) {
        return failure(403, "wrong_password", "That password is not right. Nothing was deleted.");
      }
    } else if (Date.now() - user.signedInAt.getTime() > REAUTH_MINUTES * 60_000) {
      return failure(
        403,
        "reauth_required",
        `For your safety, sign out and sign in with Google again, then delete within ${REAUTH_MINUTES} minutes. Nothing was deleted.`,
      );
    }

    await deleteAccount(user.id);
    await endSession();
    return json({ ok: true });
  });
}
