"use client";

import { useSyncExternalStore } from "react";
import { onViewerChange, viewerId } from "./viewer";

// =============================================================================
// Whether the live screen shows the team panel (Oct 28, docs/PANEL_SPEC.md):
// on by default, switched by the Panel switch in the top bar or by P, and
// remembered per announcer. Kept in this browser under the signed-in
// account's id, so another account on the same laptop has its own; like the
// device and sound settings, signing out leaves it.
// =============================================================================

const KEY_PREFIX = "spotter.livePanel.";
const OFF = "off";

function keyFor(viewer: string | null | undefined): string {
  return `${KEY_PREFIX}${viewer ?? "anyone"}`;
}

/** What was stored, read: on unless it says off. A setting never saved is on. */
export function panelFrom(saved: string | null): boolean {
  return saved !== OFF;
}

/** The announcer's setting in this browser. On where storage cannot be read. */
export function readPanelSetting(): boolean {
  try {
    return panelFrom(localStorage.getItem(keyFor(viewerId())));
  } catch {
    return true;
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
    localStorage.setItem(keyFor(viewerId()), on ? "on" : OFF);
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

/** The panel shows on the server's render, the default. */
function serverSnapshot(): boolean {
  return true;
}

/** Whether the panel shows, and the way to change it. */
export function usePanelSetting(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  return [on, writePanelSetting];
}
