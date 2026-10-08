// =============================================================================
// What a crash report may carry (audit H5), shared by the browser reporter and
// the route that writes it, so both cut the same way. Pure.
//
// A report is the error's name, the first line of its message, the path it
// happened on without its query, and Next's digest. Never a stack, a request
// body, a query string or anything a page holds. Quoted text with a space in
// it and anything shaped like an email address are blanked, because that is
// where a player's name or an account's address would appear.
// =============================================================================

/** The route's body cap. A report is a few hundred characters; this is far past any honest one. */
export const MAX_REPORT_BYTES = 8 * 1024;

export const LIMITS = { path: 200, name: 80, message: 300, digest: 100 } as const;

export interface ClientErrorReport {
  path: string;
  name: string;
  message: string;
  digest: string;
}

const EMAIL = /[^\s@"'`]+@[^\s@"'`]+\.[^\s@"'`]+/g;
/** A quoted run with a space in it, or longer than 40 characters: free text, not a property name. */
const QUOTED = /(["'`])((?:(?!\1).)*)\1/g;

function cut(value: string, limit: number): string {
  return value.length > limit ? value.slice(0, limit) : value;
}

/** The first line of a message, with free text and addresses blanked, cut to its limit. */
export function cleanMessage(message: unknown): string {
  const text = typeof message === "string" ? message : "";
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  const blanked = first
    .replace(EMAIL, "[email]")
    .replace(QUOTED, (whole, quote: string, inner: string) =>
      /\s/.test(inner) || inner.length > 40 ? `${quote}...${quote}` : whole,
    );
  return cut(blanked.trim(), LIMITS.message);
}

/** A path with no query, no fragment and no origin, cut to its limit. */
export function cleanPath(path: unknown): string {
  let text = typeof path === "string" ? path : "";
  try {
    // Accepts a full URL too, keeping only its path.
    if (/^[a-z][a-z0-9+.-]*:/i.test(text)) text = new URL(text).pathname;
  } catch {
    text = "";
  }
  text = text.split(/[?#]/, 1)[0] ?? "";
  if (!text.startsWith("/")) text = `/${text}`;
  return cut(text, LIMITS.path);
}

/** A short code-like string: an error's name or Next's digest. Anything else is dropped. */
function cleanCode(value: unknown, limit: number): string {
  if (typeof value !== "string") return "";
  const text = value.trim();
  return /^[\w .:-]*$/.test(text) ? cut(text, limit) : "";
}

export function cleanReport(input: { path?: unknown; name?: unknown; message?: unknown; digest?: unknown }): ClientErrorReport {
  return {
    path: cleanPath(input.path),
    name: cleanCode(input.name, LIMITS.name) || "Error",
    message: cleanMessage(input.message),
    digest: cleanCode(input.digest, LIMITS.digest),
  };
}
