// =============================================================================
// A file dropped on New game's "Add the away team" box (Nov 3) is held here,
// in memory, while the page moves on to the new team's page, whose roster box
// takes it and reads it as if it had been dropped there. Nothing is stored:
// the files live only in this tab's memory, and a reload drops them.
// =============================================================================

const held = new Map<string, File[]>();

/** Holds files for the next import box of this kind ("roster") to mount. */
export function holdFiles(kind: string, files: readonly File[]): void {
  if (files.length > 0) held.set(kind, [...files]);
}

export function hasHeldFiles(kind: string): boolean {
  return held.has(kind);
}

/** The held files, once: taking them clears them. */
export function takeHeldFiles(kind: string): File[] | null {
  const files = held.get(kind) ?? null;
  held.delete(kind);
  return files;
}
