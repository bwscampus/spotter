import { requireUser } from "@/lib/server/auth";
import { sendTokenEmail } from "@/lib/server/emailTokens";
import { takeToken, tooManyRequests } from "@/lib/server/rateLimit";
import { clientIp, forbidden, isSameOrigin } from "@/lib/server/request";
import { failure, json } from "@/lib/server/route";

// Sends the signed-in account a fresh confirmation link (Production Standard
// AUTH-2, AUTH-3). Identity comes from the session; the body is ignored. Limited
// per network and per address, so it cannot be used to flood an inbox. An
// already confirmed account gets the same answer and no email.

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return forbidden();
  if (!takeToken("resendVerificationIp", clientIp(request))) return tooManyRequests();
  const gate = await requireUser();
  if (!gate.ok) return gate.response;
  const { user } = gate;
  if (!takeToken("resendVerificationEmail", user.email.toLowerCase())) return tooManyRequests();

  try {
    if (!user.emailVerified) await sendTokenEmail(user, "verify", request);
    return json({ ok: true });
  } catch (err) {
    console.error(`auth.resend_verification: failed (${(err as { code?: string })?.code ?? "unknown"})`);
    return failure(503, "resend_unavailable", "Could not send the link just now. Try again in a moment.");
  }
}
