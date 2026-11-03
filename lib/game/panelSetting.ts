"use client";

import { useSyncExternalStore } from "react";
import { onViewerChange, viewerId } from "./viewer";

// =============================================================================
// Whether the live screen shows the team panel (Oct 28, docs/PANEL_SPEC.md):
// off by default (Jed, Nov 1: "Make the panel off by default"; on from Oct 28),
// switched by the Panel switch in the top bar or by P, and remembered per
// announcer. Kept in this browser under the signed-in
// account's id, so another account on the same laptop has its own; like the
// device and sound settings, signing out leaves it.
// =============================================================================

const KEY_PREFIX = "spotter.livePanel.";
const ON = "on";
const OFF = "off";

function keyFor(viewer: string | null | undefined): string {
  return `${KEY_PREFIX}${viewer ?? "anyone"}`;
}

/** What was stored, read: off unless it says on. A setting never saved is off (Nov 1). */
export function panelFrom(saved: string | null): boolean {
  return saved === ON;
}

/** The announcer's setting in this browser. Off where storage cannot be read. */
export function readPanelSetting(): boolean {
  try {
    return panelFrom(localStorage.getItem(keyFor(viewerId())));
  } catch {
    return false;
  }
}

const listeners = new Set<() => void>();
let viewerSubscribed = false;

function notify() {
  for (const listener of listeners) listener();
}

/** Remembers the setting and tells every screen showing it. Never throws: a full or blocked storage keeps it for this page only. */
export function writePanelSetting(on: boolean) {
  try {
    localStorage.setItem(keyFor(viewerId()), on ? ON : OFF);
  } catch {
    // Remembered nowhere, but the switch still works for this page.
    pageOnly = on;
  }
  notify();
}

/** Set only when storage refused a write. */
let pageOnly: boolean | null = null;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!viewerSubscribed) {
    viewerSubscribed = true;
    onViewerChange(notify);
  }
  window.addEventListener("storage", notify);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", notify);
  };
}

function snapshot(): boolean {
  return pageOnly ?? readPanelSetting();
}

/** The panel is hidden on the server's render, the default. */
function serverSnapshot(): boolean {
  return false;
}

/** Whether the panel shows, and the way to change it. */
export function usePanelSetting(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  return [on, writePanelSetting];
}
