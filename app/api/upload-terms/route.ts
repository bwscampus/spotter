import { acceptUploadTerms } from "@/lib/server/repo/account";
import { forUser, json } from "@/lib/server/route";

// POST: the account says it has the right to use what it uploads (V3 audit M5,
// components/auth/UploadTerms.tsx). Asked once, before the first import.
export function POST(request: Request) {
  return forUser(request, async ({ user }) => {
    await acceptUploadTerms(user.id);
    return json({ ok: true });
  });
}
