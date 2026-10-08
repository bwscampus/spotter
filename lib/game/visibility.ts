// Whether the tab is hidden, as a store the live screen reads with
// useSyncExternalStore. A hidden tab loses the screen wake lock and may be
// frozen; both go in the connection record (Part 6, Oct 4).

export function subscribeVisibility(listener: () => void): () => void {
  document.addEventListener("visibilitychange", listener);
  return () => document.removeEventListener("visibilitychange", listener);
}

export function getHidden(): boolean {
  return document.visibilityState === "hidden";
}

/** There is no tab on the server. */
export function getServerHidden(): boolean {
  return false;
}
