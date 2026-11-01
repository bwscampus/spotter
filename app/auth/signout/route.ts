import { forbidden, isSameOrigin } from "@/lib/server/request";
import { endSession } from "@/lib/server/session";

// The Sign out button's form (components/SiteHeader.tsx). Deletes this
// browser's session row, clears the cookie and goes to the sign-in page.
//
// The Location is relative on purpose. Under `next start` behind Railway's
// proxy, request.url is https://localhost:<PORT>/..., so a URL built from it
// sent every Sign out to localhost (audit, Nov 1). The browser resolves a
// relative Location against the page's own address.
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return forbidden();
  await endSession();
  return new Response(null, { status: 303, headers: { Location: "/login", "Cache-Control": "no-store" } });
}
