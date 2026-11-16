import { partnerPath } from "@/lib/booth/code";
import { VERIFY_NOTE } from "@/lib/server/auth";
import { appOrigin, boothPartnerMessage, sendEmail } from "@/lib/server/email";
import { normalizeEmail } from "@/lib/server/password";
import { takeToken, tooManyRequests } from "@/lib/server/rateLimit";
import { addPartner, hostsOf, invitesFor, listPartners } from "@/lib/server/repo/booth";
import { badRequest, failure, forUser, json, readJson } from "@/lib/server/route";

// Saved booth partners (Nov 15), from Settings.

// GET: the partners this account added, the invites waiting for it (by its
// confirmed email only), and the hosts it is a partner of.
export function GET(request: Request) {
  return forUser(request, async ({ user }) => {
    const [partners, invites, hosts] = await Promise.all([listPartners(user.id), invitesFor(user), hostsOf(user.id)]);
    return json({ partners, invites, hosts });
  });
}

// POST { email }: adds a partner, who accepts once. The answer is the same
// whether or not the address has an account. The link goes by email; only
// when it could not be sent does the answer carry it, for the host to copy.
export function POST(request: Request) {
  return forUser(request, async ({ user }) => {
    if (user.emailVerified !== true) return failure(403, "email_not_verified", VERIFY_NOTE);
    const read = await readJson(request, 1024);
    if (!read.ok) return read.response;
    const body = read.body as { email?: unknown };
    if (typeof body !== "object" || body === null || Object.keys(body).length !== 1) return badRequest();
    const email = normalizeEmail(body.email);
    if (!email) return failure(400, "bad_email", "That does not look like an email address.");
    if (!takeToken("boothPartnerInviteUser", user.id)) return tooManyRequests();

    const added = await addPartner(user, email);
    if (added.status !== "ok") {
      if (added.status === "self") return failure(400, "self", "That's your own address.");
      if (added.status === "exists") return failure(409, "exists", "That partner already accepted.");
      return failure(409, "too_many", "You have as many saved partners as fit. Remove one first.");
    }

    const origin = appOrigin(request);
    const link = origin ? `${origin}${partnerPath(added.token)}` : null;
    const sent = link ? (await sendEmail(boothPartnerMessage(email, link))).sent : false;
    return json({ sent, ...(sent || !link ? {} : { link }) });
  });
}
