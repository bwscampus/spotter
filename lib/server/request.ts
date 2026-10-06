// Small checks every route handler shares.

export const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Railway's edge overwrites X-Real-IP on every request, so it is the one
 * client-IP header that cannot be forged (Production Standard AUTH-3).
 */
export function clientIp(request: Request): string {
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

/**
 * Only Spotter's own pages may call a state-changing route (API-6). Browsers send
 * Sec-Fetch-Site on every request; when it is missing (an old browser, curl), the
 * Origin header must match the host.
 */
export function isSameOrigin(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site) return site === "same-origin";
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === request.headers.get("host");
  } catch {
    return false;
  }
}

export function forbidden(): Response {
  return Response.json({ code: "forbidden", error: "Forbidden" }, { status: 403, headers: NO_STORE });
}
