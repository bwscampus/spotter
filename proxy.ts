import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/server/sessionCookie";

// Next 16's request interception file, formerly middleware.ts. Sends a visitor
// with no session cookie to /login. It never touches the database: pages check
// the session itself (lib/server/auth.ts), and a database blip must not throw an
// announcer off the live screen, which runs from what the browser already holds.
export function proxy(request: NextRequest) {
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  // Skipped on purpose:
  // - /login and /auth/*: how a signed-out visitor gets in and out.
  // - /api/*: route handlers check the session themselves, and a proxy would
  //   buffer (and truncate) roster uploads.
  // - pcm-capture-worklet.js and other static files: a redirect here would
  //   break audio capture mid-broadcast if the session lapsed.
  matcher: [
    "/((?!login|auth/|api/|_next/static|_next/image|favicon.ico|pcm-capture-worklet.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|js|css|ico)$).*)",
  ],
};
