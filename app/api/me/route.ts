import { deleteAccount, passwordHash, saveAbout, skipAbout } from "@/lib/server/repo/account";
import { takeToken, tooManyRequests } from "@/lib/server/rateLimit";
import { clientIp } from "@/lib/server/request";
import { verifyPassword } from "@/lib/server/password";
import { badRequest, failure, forUser, json, readJson } from "@/lib/server/route";
import { isAboutBody } from "@/lib/server/validate";
import { endSession } from "@/lib/server/session";

// PATCH: "About you" (Nov 3): the sports the announcer calls and the kinds of
// announcing they do, or a skip. Always the session's own account; the body
// names no one.
export function PATCH(request: Request) {
  return forUser(request, async ({ user }) => {
    const read = await readJson(request, 2 * 1024);
    if (!read.ok) return read.response;
    if (!isAboutBody(read.body)) return badRequest();
    if ("skip" in read.body) await skipAbout(user.id);
    else await saveAbout(user.id, read.body.sports, read.body.roles);
    return json({ ok: true });
  });
}

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
      // Each wrong guess costs a scrypt; limit them like sign-in, by account and by network (audit, Nov 1).
      if (!takeToken("deleteAccountUser", user.id) || !takeToken("deleteAccountIp", clientIp(request))) return tooManyRequests();
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
