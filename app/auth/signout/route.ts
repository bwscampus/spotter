import { forbidden, isSameOrigin } from "@/lib/server/request";
import { endSession } from "@/lib/server/session";

// The Sign out button's form (components/SiteHeader.tsx). Deletes this
// browser's session row, clears the cookie and goes to the sign-in page.
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return forbidden();
  await endSession();
  return Response.redirect(new URL("/login", request.url), 303);
}
