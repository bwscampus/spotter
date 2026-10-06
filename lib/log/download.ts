import { logWriter, readGameLog } from "./gameLog";
import { downloadName, toMatchLogCsv, toReplayFile } from "./records";

// =============================================================================
// Downloading one game's browser log: the live screen's Log panel and Past
// games both come through here.
//
// PRIVACY: this is the only way the log leaves the browser, and only on the
// announcer's own click. Browser only (Blob, an anchor, IndexedDB).
// =============================================================================

/**
 * Chrome drops the second of two downloads started in the same tick. A short
 * gap lets both through, and it is still one click.
 */
export const SECOND_DOWNLOAD_DELAY_MS = 400;

function save(contents: string, type: string, name: string) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export type DownloadResult = { ok: true; records: number } | { ok: false; reason: "empty" | "unreadable" };

/** The .json replay file and the .csv match log for one game. */
export async function downloadGameLog(gameId: string): Promise<DownloadResult> {
  try {
    // What is still in memory goes first, or the file would miss the last few seconds.
    await logWriter().flush();
    const records = await readGameLog(gameId);
    if (records.length === 0) return { ok: false, reason: "empty" };
    const now = new Date();
    save(JSON.stringify(toReplayFile(gameId, records, now)), "application/json", downloadName("log", gameId, now));
    const csv = toMatchLogCsv(records);
    setTimeout(() => save(csv, "text/csv;charset=utf-8", downloadName("matches", gameId, now)), SECOND_DOWNLOAD_DELAY_MS);
    return { ok: true, records: records.length };
  } catch {
    return { ok: false, reason: "unreadable" };
  }
}
