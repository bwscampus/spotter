// =============================================================================
// Who is signed in, as this browser's own game data needs to know it
// (pre-launch audit M3). A press-box laptop is often shared: the open game
// (both full rosters) and the browser log (every transcript) are stamped with
// the account that made them, and another account signed in on the same
// browser does not see them.
//
// The server already knows the account when it renders the page: the root
// layout hands the id to ViewerStamp (components/auth/BrowserData.tsx), which
// writes it here before any page below it renders, so reading the open game
// stays synchronous. Never read on the hot path: only where a snapshot is
// read or written and where the log is read or flushed.
// =============================================================================

/** The signed-in account's id; null when signed out; undefined until the page has said. */
let viewer: string | null | undefined;
const listeners = new Set<() => void>();

export function viewerId(): string | null | undefined {
  return viewer;
}

/**
 * Sets the account without telling anyone, so it can run while the page
 * renders. Returns whether it changed; when it did, call announceViewer after
 * the render, so what was read under the old account is read again.
 */
export function rememberViewer(id: string | null): boolean {
  if (viewer === id) return false;
  viewer = id;
  return true;
}

export function announceViewer() {
  for (const listener of listeners) listener();
}

export function onViewerChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Whether `viewer` may see something stamped with `owner`. Something made
 * before owners were stamped belongs to whoever is signed in, and so does
 * everything while the page has not said who that is (never the case under
 * the root layout, which always says).
 */
export function visibleTo(owner: string | undefined, viewer: string | null | undefined): boolean {
  if (owner === undefined || viewer === undefined) return true;
  return owner === viewer;
}
