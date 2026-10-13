// =============================================================================
// Shared game logs as files again (`npm run pull:logs`, scripts/pull-shared-logs.ts):
// a share's pieces, each its own gzipped scrubbed log, joined in part order
// into the one shared log the replays read (lib/log/sharedReplay.ts), and
// what the share's header row says about it beside it. Pure: the script reads
// the database and writes the files; `gunzip` is handed in.
// =============================================================================

/** A share as the pull reads it from shared_game_logs. */
export interface PulledShare {
  id: string;
  shareId: string | null;
  createdAt: Date;
  sport: string | null;
  statsEnabled: boolean;
  scrubVersion: number;
  complete: boolean;
  pieces: number;
  records: number;
  appCommit: string | null;
  header: unknown;
  counts: unknown;
  rating: number | null;
  blockers: string[] | null;
  /** A share from before Oct 12: the whole log in one. */
  wholeLog: string | null;
}

/** One piece as the pull reads it from shared_game_log_pieces. */
export interface PulledPiece {
  part: number;
  logGzB64: string;
}

export type Gunzip = (base64: string) => string;

/** The file a share is written to: "shared-20261012-1931-ab12cd34" (UTC), and ".json" / ".meta.json" after it. */
export function sharedFileBase(share: Pick<PulledShare, "id" | "createdAt">): string {
  const iso = share.createdAt.toISOString();
  const stamp = `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}-${iso.slice(11, 13)}${iso.slice(14, 16)}`;
  return `shared-${stamp}-${share.id.replace(/-/g, "").slice(0, 8)}`;
}

/**
 * The share's log: the whole log of an older share, or every piece's records
 * in part order. A missing part (a piece that never arrived) is listed in
 * `missingParts`; the log is still written from what is there.
 */
export function joinShare(share: PulledShare, pieces: readonly PulledPiece[], gunzip: Gunzip): { log: unknown; missingParts: number[] } {
  if (share.wholeLog !== null) return { log: JSON.parse(gunzip(share.wholeLog)), missingParts: [] };
  const sorted = [...pieces].sort((a, b) => a.part - b.part);
  const records: unknown[] = [];
  let scrubVersion = share.scrubVersion;
  for (const piece of sorted) {
    const part = JSON.parse(gunzip(piece.logGzB64)) as { scrubVersion?: unknown; records?: unknown };
    if (typeof part.scrubVersion === "number") scrubVersion = part.scrubVersion;
    if (Array.isArray(part.records)) records.push(...part.records);
  }
  const last = sorted.at(-1)?.part ?? -1;
  const present = new Set(sorted.map((piece) => piece.part));
  const missingParts: number[] = [];
  for (let part = 0; part <= last; part++) if (!present.has(part)) missingParts.push(part);
  return { log: { format: "spotter-v3-shared-log", scrubVersion, records }, missingParts };
}

/** What is known about a share, written beside its log. No owner, nothing said. */
export function shareMeta(share: PulledShare, missingParts: readonly number[]) {
  return {
    createdAt: share.createdAt.toISOString(),
    sport: share.sport,
    statsEnabled: share.statsEnabled,
    scrubVersion: share.scrubVersion,
    complete: share.shareId === null ? true : share.complete,
    pieces: share.pieces,
    missingParts,
    records: share.records,
    appCommit: share.appCommit,
    header: share.header ?? null,
    counts: share.counts ?? null,
    rating: share.rating,
    blockers: share.blockers ?? [],
  };
}
