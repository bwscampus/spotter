// Pages anyone may open, signed in or not (V3's list in lib/supabase/proxy.ts,
// plus the password reset page). proxy.ts sends everyone else without a
// session cookie to /login.

const PUBLIC_EXACT = ["/", "/robots.txt", "/sitemap.xml"];
const PUBLIC_PREFIXES = ["/login", "/auth", "/reset-password", "/privacy", "/terms", "/contact"];

export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT.includes(pathname)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
