/**
 * Response headers for every route (Production Standard API-4), applied in
 * next.config.ts. Kept in its own file so a test can read them.
 *
 * Spotter needs three things a generic CSP would block:
 * - Google Identity Services: its script, its stylesheet, its iframe and its
 *   FedCM/One Tap calls, all under https://accounts.google.com/gsi/.
 * - The Deepgram socket (wss) and its REST host, opened from the live screen.
 * - The microphone, so Permissions-Policy allows it for this origin only.
 *
 * Next injects inline bootstrap scripts, hence 'unsafe-inline' for scripts until
 * a nonce replaces it (tracked in docs/SECURITY-GAPS.md). React Refresh needs
 * 'unsafe-eval' in development only.
 */

const GSI = "https://accounts.google.com/gsi/";

export function contentSecurityPolicy(isProduction: boolean): string {
  const scriptSrc = ["'self'", "'unsafe-inline'", `${GSI}client`];
  if (!isProduction) scriptSrc.push("'unsafe-eval'");

  return [
    "default-src 'self'",
    `script-src ${scriptSrc.join(" ")}`,
    `style-src 'self' 'unsafe-inline' ${GSI}style`,
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self' ${GSI} https://api.deepgram.com wss://api.deepgram.com`,
    `frame-src ${GSI}`,
    "worker-src 'self' blob:",
    "media-src 'self' blob:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

export function securityHeaders(isProduction: boolean): { key: string; value: string }[] {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(isProduction) },
    { key: "Strict-Transport-Security", value: "max-age=15552000; includeSubDomains" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    // The live screen listens, so the microphone is allowed here and nowhere else.
    { key: "Permissions-Policy", value: "microphone=(self), camera=(), geolocation=(), payment=()" },
    // Google's sign-in popup has to be able to reach back to this window.
    { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  ];
}
