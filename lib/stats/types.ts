import type { FootballStats } from "@/lib/cards/statKeys";
import type { StatValue } from "@/lib/cards/volleyball";
import type { ImportFormat, ReadRoute } from "@/lib/rosters/types";

/**
 * What a stats sheet is read into. Football is numbers on the 9.2 stat keys;
 * volleyball is every column as a labelled value (Jed, Oct 21,
 * lib/cards/volleyball.ts); every other sport is up to three written lines.
 * docs/V3_DEFINITION.md 6.4.
 */
export type StatsKind = "numbers" | "values" | "lines";

export function statsKindFor(sport: string | null | undefined): StatsKind {
  if (sport === "football") return "numbers";
  return sport === "volleyball" ? "values" : "lines";
}

/** A player already saved on the roster. The id is what set_season_stats writes to. */
export interface StatsPlayer {
  id: string;
  jersey: string | null;
  last_name: string;
  /** Volleyball only, so the review shows the card in the order the position puts it. */
  position?: string | null;
}

/** How a stats row names its player. Everything the matcher needs, and nothing else. */
export interface BlockIdentity {
  jersey: string | null;
  last_name: string;
}

/** One football player's numbers, as Claude read them off the sheet. */
export interface NumberBlock extends BlockIdentity {
  stats: FootballStats;
}

/** One volleyball player's stats, as the sheet printed them. */
export interface ValueBlock extends BlockIdentity {
  values: StatValue[];
}

/** One player's lines, as Claude wrote them from the sheet. */
export interface LineBlock extends BlockIdentity {
  lines: string[];
}

/** What POST /api/stats/extract returns. No file bytes, no sheet text. */
export type StatsExtractResponse = {
  warnings: string[];
  /** The roster Claude was shown, so the browser matches against the same list. */
  roster: StatsPlayer[];
  format: ImportFormat;
  route: ReadRoute;
  /** Pages for a PDF, images for an image import, 0 otherwise. */
  pages: number;
} & (
  | { kind: "numbers"; blocks: NumberBlock[] }
  | { kind: "values"; blocks: ValueBlock[] }
  | { kind: "lines"; blocks: LineBlock[] }
);
