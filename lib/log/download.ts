import { logWriter, readGameLog } from "./gameLog";
import { downloadName, toMatchLogCsv, toReplayFile } from "./records";
import { toStatsCsv } from "./statsLog";
import { buildStatsReport, workbookSheets } from "./statsReport";

// =============================================================================
// Downloading one game's browser log, from Past games. (The live screen's Log
// panel went on Oct 3, to give the cards the screen.)
//
// PRIVACY: this is the only way the log itself leaves the browser, and only on
// the announcer's own click. (The share switch sends a different thing: a copy
// with the names taken out, lib/log/shareLog.ts.) Browser only (Blob, an
// anchor, IndexedDB).
// =============================================================================

/** Said beside every Download: the log never leaves the browser on its own. */
export const LOG_STAYS_HERE =
  "This log stays in this browser. It only leaves if you download it. A copy with last names kept and first names and schools taken out is sent at End game unless you turned that off.";

/**
 * Chrome drops the second of two downloads started in the same tick. A short
 * gap lets both through, and it is still one click.
 */
export const SECOND_DOWNLOAD_DELAY_MS = 400;

function save(contents: string | Blob, type: string, name: string) {
  const url = URL.createObjectURL(typeof contents === "string" ? new Blob([contents], { type }) : contents);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export type DownloadResult = { ok: true; records: number; files: number } | { ok: false; reason: "empty" | "unreadable" };

/**
 * The .xlsx report (lib/log/statsReport.ts), or null when there is nothing to
 * report or it could not be made. The library is loaded only now, like the
 * spreadsheet reader on import, so the live screen never carries it.
 */
async function reportFile(records: readonly { kind: string }[]): Promise<Blob | null> {
  const report = buildStatsReport(records);
  if (report === null) return null;
  try {
    const { default: writeExcelFile } = await import("write-excel-file/browser");
    return await writeExcelFile(workbookSheets(report)).toBlob();
  } catch {
    return null;
  }
}

/**
 * The .json replay file and the .csv match log for one game, the .csv stats
 * log when the game read any plays, and the .xlsx report (testrun) when it
 * read any plays or heard anything.
 */
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
    const stats = toStatsCsv(records);
    if (stats !== null) {
      setTimeout(
        () => save(stats, "text/csv;charset=utf-8", downloadName("stats", gameId, now)),
        SECOND_DOWNLOAD_DELAY_MS * 2,
      );
    }
    const report = await reportFile(records);
    if (report !== null) {
      setTimeout(
        () => save(report, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", downloadName("report", gameId, now)),
        SECOND_DOWNLOAD_DELAY_MS * 3,
      );
    }
    return { ok: true, records: records.length, files: 2 + (stats === null ? 0 : 1) + (report === null ? 0 : 1) };
  } catch {
    return { ok: false, reason: "unreadable" };
  }
}
