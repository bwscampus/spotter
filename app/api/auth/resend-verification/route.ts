import { requireUser } from "@/lib/server/auth";
import { sendTokenEmail } from "@/lib/server/emailTokens";
import { takeToken, tooManyRequests } from "@/lib/server/rateLimit";
import { clientIp, forbidden, isSameOrigin } from "@/lib/server/request";
import { failure, json } from "@/lib/server/route";
import { CONTACT_EMAIL } from "@/lib/ui/site";

const EMAIL_UNAVAILABLE = `The email could not be sent just now. Try again in a few minutes, or email ${CONTACT_EMAIL} and we will confirm your account.`;

// Sends the signed-in account a fresh confirmation link (Production Standard
// AUTH-2, AUTH-3). Identity comes from the session; the body is ignored. Limited
// per network and per address, so it cannot be used to flood an inbox. An
// already confirmed account is told so (it is the account's own address, so
// there is nothing to hide), and a send that fails says it failed rather than
// "sent" (audit, Nov 1: a misconfigured sender left people waiting for good).

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return forbidden();
  if (!takeToken("resendVerificationIp", clientIp(request))) return tooManyRequests();
  const gate = await requireUser();
  if (!gate.ok) return gate.response;
  const { user } = gate;
  if (!takeToken("resendVerificationEmail", user.email.toLowerCase())) return tooManyRequests();

  try {
    if (user.emailVerified) return json({ ok: true, alreadyConfirmed: true });
    const sent = await sendTokenEmail(user, "verify", request);
    if (!sent) return failure(503, "email_unavailable", EMAIL_UNAVAILABLE);
    return json({ ok: true });
  } catch (err) {
    console.error(`auth.resend_verification: failed (${(err as { code?: string })?.code ?? "unknown"})`);
    return failure(503, "resend_unavailable", "Could not send the link just now. Try again in a moment.");
  }
}
