// Transactional email through Resend's HTTP API (no SDK: one POST). Server only.
//
// Never log an address, a link, a token or a body (Production Standard API-8):
// a reset link in the server log is a way into the account for anyone who can
// read the log. Lines here carry the kind of email and a code, nothing else.

const RESEND_URL = "https://api.resend.com/emails";
/** A send that has not answered by now is given up; the caller's request must not hang on it. */
const SEND_TIMEOUT_MS = 10_000;

/** What an email is for. Logged in place of anything about the person. */
export type EmailKind = "verify" | "reset" | "signup_notice";

export type EmailMessage = { kind: EmailKind; to: string; subject: string; text: string; html: string };

export type SendResult = { sent: true } | { sent: false; code: "no_provider" | "no_sender" | "send_failed" };

const isProduction = () => process.env.NODE_ENV === "production";

/**
 * The origin emailed links point at. Only ever APP_URL: a request's Host header
 * is never trusted for this, or a forged header could send someone a reset link
 * to another site. Off production, with no APP_URL, the request's own origin
 * will do for a laptop. Null means no link can be built.
 */
export function appOrigin(request?: Request): string | null {
  const configured = process.env.APP_URL?.trim().replace(/\/+$/, "");
  if (configured) {
    // A production link must be https; anything else is a misconfiguration, not a link to send.
    if (isProduction() && !configured.startsWith("https://")) return null;
    return configured;
  }
  if (!isProduction() && request) return new URL(request.url).origin;
  return null;
}

/**
 * Sends one email. Never throws: a failed send must not fail the sign-up or the
 * reset request around it, and the caller answers the same either way (AUTH-7).
 *
 * Without RESEND_API_KEY nothing leaves the server. In production that is a
 * misconfiguration, logged as a code; on a laptop it logs that an email would
 * have gone, by kind only, so a developer can see the flow ran.
 */
export async function sendEmail(message: EmailMessage, fetcher: typeof fetch = fetch): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    if (isProduction()) {
      console.error(`[Spotter] email.${message.kind} not sent (no_provider): RESEND_API_KEY is not set`);
    } else {
      console.info(`[Spotter] email.${message.kind} would be sent here; set RESEND_API_KEY to send it`);
    }
    return { sent: false, code: "no_provider" };
  }
  const from = process.env.EMAIL_FROM?.trim();
  if (!from) {
    console.error(`[Spotter] email.${message.kind} not sent (no_sender): EMAIL_FROM is not set`);
    return { sent: false, code: "no_sender" };
  }

  try {
    const response = await fetcher(RESEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [message.to], subject: message.subject, text: message.text, html: message.html }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (!response.ok) {
      // The status only: Resend's error body can echo the recipient.
      console.error(`[Spotter] email.${message.kind} not sent (send_failed ${response.status})`);
      return { sent: false, code: "send_failed" };
    }
    return { sent: true };
  } catch (err) {
    console.error(`[Spotter] email.${message.kind} not sent (send_failed ${(err as Error)?.name ?? "error"})`);
    return { sent: false, code: "send_failed" };
  }
}

// The messages. Links are built from our own origin and a base64url token, so
// nothing in them needs escaping; no user-typed text goes into an email.

export function verifyEmailMessage(to: string, link: string, hours: number): EmailMessage {
  return {
    kind: "verify",
    to,
    subject: "Confirm your email for Spotter",
    text: `Confirm this is your email address to finish setting up your Spotter account (the link works for ${hours} hours):\n\n${link}\n\nIf you did not create a Spotter account, ignore this email.`,
    html: `<p>Confirm this is your email address to finish setting up your Spotter account.</p><p><a href="${link}">Confirm my email</a> (the link works for ${hours} hours).</p><p>If you did not create a Spotter account, ignore this email.</p>`,
  };
}

export function resetPasswordMessage(to: string, link: string, minutes: number): EmailMessage {
  return {
    kind: "reset",
    to,
    subject: "Reset your Spotter password",
    text: `Someone asked to reset the password for the Spotter account with this address. Open this link to choose a new one (it works for ${minutes} minutes, once):\n\n${link}\n\nIf it was not you, ignore this email and your password stays as it is.`,
    html: `<p>Someone asked to reset the password for the Spotter account with this address.</p><p><a href="${link}">Choose a new password</a> (the link works for ${minutes} minutes, once).</p><p>If it was not you, ignore this email and your password stays as it is.</p>`,
  };
}

/** Sent instead of a second account, so sign-up answers the same either way (AUTH-7). */
export function signupNoticeMessage(to: string, origin: string): EmailMessage {
  const login = `${origin}/login`;
  return {
    kind: "signup_notice",
    to,
    subject: "You already have a Spotter account",
    text: `Someone tried to create a Spotter account with this address, but it already has one. If it was you, sign in at ${login}, or use "Forgot password?" there.\n\nIf it was not you, ignore this email. Nothing about your account has changed.`,
    html: `<p>Someone tried to create a Spotter account with this address, but it already has one.</p><p>If it was you, <a href="${login}">sign in</a>, or use "Forgot password?" there.</p><p>If it was not you, ignore this email. Nothing about your account has changed.</p>`,
  };
}
