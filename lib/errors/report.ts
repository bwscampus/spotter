import { afterPaint } from "@/lib/afterPaint";
import { isLocalHost } from "@/lib/analytics/localHost";
import { cleanReport } from "./clean";

// =============================================================================
// The browser's crash reporter (audit H5). Installed once from the root layout.
// Hears uncaught errors and unhandled rejections, and the error pages hand it
// what they caught. Each report goes to POST /api/client-errors after paint,
// at most MAX_PER_PAGE per page load, the same one never twice. Best effort:
// a report that fails is dropped, and nothing here ever throws. Browser only.
// =============================================================================

// =============================================================================
// TUNING
// =============================================================================

/** Reports one page load may send, however many errors it has. */
export const MAX_PER_PAGE = 5;

// =============================================================================

export const ENDPOINT = "/api/client-errors";

let sent = 0;
const seen = new Set<string>();
let installed = false;

/** Sends one error. `digest` is Next's, from an error page. */
export function reportError(error: unknown, digest?: string): void {
  try {
    if (typeof window === "undefined" || isLocalHost(window.location.hostname)) return;
    if (sent >= MAX_PER_PAGE) return;

    const err = error instanceof Error ? error : null;
    const report = cleanReport({
      path: window.location.pathname,
      name: err?.name ?? "Error",
      message: err ? err.message : typeof error === "string" ? error : "Non-Error thrown",
      digest: digest ?? (err as { digest?: unknown } | null)?.digest,
    });
    const key = `${report.name}|${report.message}|${report.digest}`;
    if (seen.has(key)) return;
    seen.add(key);
    sent += 1;

    afterPaint(() => {
      void fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(report),
        keepalive: true,
      }).catch(() => undefined);
    });
  } catch {
    // Reporting a crash must never cause one.
  }
}

/** Listens for uncaught errors and unhandled rejections. Safe to call more than once. */
export function installErrorReporter(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (event) => {
    // A resource that failed to load has no error object; it is not a crash.
    if (event.error === undefined && !event.message) return;
    reportError(event.error ?? event.message);
  });
  window.addEventListener("unhandledrejection", (event) => reportError(event.reason));
}

/** For tests: forget what this page load sent. */
export function resetReporterForTest(): void {
  sent = 0;
  seen.clear();
}
