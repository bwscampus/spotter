// Booth partners (Nov 15): the invite link the host made, kept in his own
// browser for that game, so the live screen's ⋯ menu can copy it again. The
// server keeps only its hash; on another computer the host makes a new one.

const KEY = "spotter.v3.booth-link.";

export function savedLink(gameId: string): string | null {
  try {
    return localStorage.getItem(KEY + gameId);
  } catch {
    return null;
  }
}

export function saveLink(gameId: string, token: string): void {
  try {
    localStorage.setItem(KEY + gameId, token);
  } catch {
    // Shown once on screen anyway; Reset link makes another.
  }
}

export function linkUrl(token: string): string {
  return `${window.location.origin}/join/${token}`;
}
