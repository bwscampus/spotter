"use client";

import { useEffect } from "react";

// =============================================================================
// Asks before unsaved work on a page is thrown away (audit, Nov 1).
//
// A reload or a closed tab is beforeunload's. A click on any link inside the
// app (the header, a breadcrumb, Cards preview) is a client-side navigation
// that beforeunload never sees, so the page lost a whole roster import and its
// edits without a word. This listens for those clicks on the document, before
// Next's Link handles them, and asks the same question; Cancel stops the click.
// =============================================================================

/** Whether a click on this element is a same-site link to another page that the app would follow itself. */
export function leavesPage(event: Pick<MouseEvent, "button" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "defaultPrevented">, anchor: HTMLAnchorElement | null, here: Location): boolean {
  if (!anchor || event.defaultPrevented || event.button !== 0) return false;
  // A new tab or window leaves this page as it is.
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  if (anchor.target && anchor.target !== "_self") return false;
  if (anchor.hasAttribute("download")) return false;
  let url: URL;
  try {
    url = new URL(anchor.href, here.href);
  } catch {
    return false;
  }
  if (url.origin !== here.origin) return false;
  return url.pathname !== here.pathname || url.search !== here.search;
}

export function useUnsavedGuard(unsaved: boolean, question: string): void {
  useEffect(() => {
    if (!unsaved) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    const onClick = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest("a") : null;
      if (!leavesPage(event, anchor, window.location)) return;
      if (window.confirm(question)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    // Capture, on the document: before React's own listener and so before Link navigates.
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [unsaved, question]);
}
