// =============================================================================
// A saved web page (Jed, Oct 28: a schedule can be "a saved web page", and
// MaxPreps is the usual source) turned into plain text in the browser, then
// sent as text, the way a paste is. Every import takes one: a roster or a
// stats page saved from a browser reads the same way.
//
// Pure string work, no DOM, so it runs in the tests as it does in the page.
// The model reads the result, so it only has to keep the words in order and
// the table's rows apart, not be a faithful renderer.
// =============================================================================

const WEB_PAGE = /\.(html?|mhtml?|mht)$/i;

/** A saved web page: "Webpage, HTML only" (.html, .htm) or "Webpage, Single File" (.mhtml, .mht). */
export function isWebPage(file: { name: string; type: string }): boolean {
  return WEB_PAGE.test(file.name) || file.type === "text/html" || file.type === "multipart/related" || file.type === "message/rfc822";
}

/** True for an MHTML archive: a MIME message holding the page, rather than the page itself. */
export function isMhtml(text: string): boolean {
  return /^\s*(from:|mime-version:|content-type:\s*multipart\/related)/im.test(text.slice(0, 2000)) && /boundary=/i.test(text.slice(0, 4000));
}

/** Quoted-printable, as MHTML stores its HTML: soft line breaks dropped, "=3D" back to "=". */
export function decodeQuotedPrintable(text: string): string {
  const joined = text.replace(/=\r?\n/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < joined.length; i += 1) {
    const hex = joined[i] === "=" ? joined.slice(i + 1, i + 3) : "";
    if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
      bytes.push(parseInt(hex, 16));
      i += 2;
    } else {
      // Characters outside the 7-bit range are written as UTF-8 too.
      for (const byte of new TextEncoder().encode(joined[i]!)) bytes.push(byte);
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

/** The HTML part of an MHTML archive, decoded. The text itself when it has none. */
export function mhtmlHtml(text: string): string {
  const boundary = /boundary="?([^";\r\n]+)"?/i.exec(text)?.[1];
  if (!boundary) return text;
  for (const part of text.split(`--${boundary}`)) {
    const split = part.search(/\r?\n\r?\n/);
    if (split < 0) continue;
    const headers = part.slice(0, split);
    if (!/content-type:\s*text\/html/i.test(headers)) continue;
    const body = part.slice(split).replace(/^\r?\n\r?\n/, "");
    if (/content-transfer-encoding:\s*quoted-printable/i.test(headers)) return decodeQuotedPrintable(body);
    if (/content-transfer-encoding:\s*base64/i.test(headers)) {
      try {
        const binary = atob(body.replace(/\s+/g, ""));
        return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
      } catch {
        return "";
      }
    }
    return body;
  }
  return text;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "-",
  mdash: "-",
  middot: "·",
  bull: "·",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

/**
 * The words of a saved page, in order: no scripts, styles, head or comments;
 * each table row on its own line with " | " between its cells; a line break
 * for every block. An MHTML archive is opened first.
 */
export function webPageText(saved: string): string {
  const html = isMhtml(saved) ? mhtmlHtml(saved) : saved;
  const text = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template|svg|head)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<\/t[dh]\s*>/gi, " | ")
    .replace(/<\/tr\s*>/gi, "\n")
    .replace(/<(br|hr)\b[^>]*>/gi, "\n")
    .replace(/<\/(p|div|li|ul|ol|h[1-6]|table|thead|tbody|section|article|header|footer|nav|main|aside|dt|dd|caption)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(text)
    .split("\n")
    .map((line) =>
      line
        .replace(/[ \t ]+/g, " ")
        .replace(/(\s*\|\s*)+$/, "")
        .replace(/^(\s*\|\s*)+/, "")
        .replace(/(\s\|\s?)+\|/g, " |")
        .trim(),
    )
    .filter((line) => line.length > 0)
    .join("\n");
}
