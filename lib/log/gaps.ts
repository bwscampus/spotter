// =============================================================================
// Stretches when nothing was heard (Part 6, Oct 4). After a gap longer than a
// minute between words, the stats strip and the play-by-play export carry a
// marker line ("Nothing heard 5:59 PM to 6:25 PM"), so the totals are visibly
// incomplete. Pure, and imports nothing: live stats and the export both use it.
// =============================================================================

/** A gap between words longer than this gets a marker. */
export const GAP_MARK_MS = 60_000;

export interface HeardGap {
  /** When the last words before the gap arrived, wall clock ms. */
  from: number;
  /** When the first words after it arrived. */
  to: number;
}

/** The gaps longer than `minGapMs` between consecutive times, oldest first. Unsorted input is sorted. */
export function gapsBetween(times: readonly number[], minGapMs = GAP_MARK_MS): HeardGap[] {
  const sorted = [...times].filter((time) => Number.isFinite(time)).sort((a, b) => a - b);
  const gaps: HeardGap[] = [];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - sorted[i - 1] > minGapMs) gaps.push({ from: sorted[i - 1], to: sorted[i] });
  }
  return gaps;
}

/** The gaps in a browser log, between its utterance records with words. */
export function gapsOf(records: readonly { kind: string }[], minGapMs = GAP_MARK_MS): HeardGap[] {
  const times: number[] = [];
  for (const record of records) {
    const any = record as { kind: string; at?: unknown; text?: unknown };
    if (any.kind !== "utterance" || typeof any.at !== "number" || typeof any.text !== "string" || any.text.trim().length === 0) continue;
    times.push(any.at);
  }
  return gapsBetween(times, minGapMs);
}

/** "Nothing heard 5:59 PM to 6:25 PM", in the browser's own time zone. */
export function gapLabel(gap: HeardGap): string {
  return `Nothing heard ${clockOf(gap.from)} to ${clockOf(gap.to)}`;
}

function clockOf(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export type WithGaps<T> = { kind: "item"; item: T } | { kind: "gap"; gap: HeardGap };

/**
 * A newest-first list with each gap put where it falls: before the first item
 * that happened before the gap ended, which is the same place the play-by-play
 * export puts it. Gaps older than every item are left out, because the list is
 * capped and they would hang off its end.
 */
export function withGaps<T>(newestFirst: readonly T[], at: (item: T) => number, gaps: readonly HeardGap[]): Array<WithGaps<T>> {
  const pending = [...gaps].sort((a, b) => b.to - a.to);
  const out: Array<WithGaps<T>> = [];
  for (const item of newestFirst) {
    const time = at(item);
    while (pending.length > 0 && pending[0].to > time) out.push({ kind: "gap", gap: pending.shift()! });
    out.push({ kind: "item", item });
  }
  return out;
}
