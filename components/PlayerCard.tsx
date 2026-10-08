import type { BigLineFit } from "@/lib/cards/bigLine";
import { BIG_LINE_SIZES, HERO_HEIGHT_EM, HERO_WIDTH_EM, NAME_PADDING_EM, SLAB_WIDTH_EM, STATS_WIDTH_EM } from "@/lib/cards/bigLine";
import { NO_JERSEY } from "@/lib/cards/cardFace";
import { ESTIMATE_MARK, MAX_GROUP_ITEMS, MAX_GROUPS, type CardLines, type StatItem, type StatLine } from "@/lib/cards/lines";
import { sideLook, type SideLook } from "@/lib/game/colors";
import type { WatchlistPlayer } from "@/lib/watchlist";

// =============================================================================
// The spotting card (docs/CARD_SPEC.md): a wide strip. Left to right, the
// number in the team's colour, the name with the player's storyline under it,
// and a stats column with the season above and tonight below, each in two
// columns of rows (Jed, Oct 7: show as many stats as fit). The newest player's card is the hero; the two
// before are the same card at half size, side by side under it, so they say
// everything the hero says (Jed, Oct 4).
//
// The card is read in a glance from two or three feet away, often off to the
// side, mid-sentence. So the jersey number is the first thing the eye lands
// on, and what the announcer has to say is the biggest text: the respelling
// when there is one, the surname when there is not.
//
// The markup is rendered once, empty, and filled in by writeCard from the
// socket handler: text, hidden flags, and a few style writes on elements that
// already exist. Nothing here creates an element or reads layout, which is
// what keeps a spotted name a DOM write rather than a React render. Every
// size is in em of the card's own size, and its width and height are fixed,
// so nothing written into it can change its size.
// =============================================================================

/** The big line before it is fitted: whole, at its largest size. */
const BIG_SIZE = `${BIG_LINE_SIZES[0]}em`;

/** The number's size in the slab, and the smaller one for three characters. */
const JERSEY_SIZE = "4em";
const LONG_JERSEY_SIZE = "2.9em";

/**
 * The section labels and the away code, in em of the card. A small card is the
 * hero at half size, so its labels are drawn bigger relative to it, to stay at
 * the smallest size anything on the stage is (0.4em of the base size).
 */
const LABEL_SIZE = { hero: "0.5em", small: "0.82em" } as const;
const CODE_SIZE = { hero: "0.45em", small: "0.82em" } as const;

/** A slab before a game says otherwise: home with no colour. */
const NO_LOOK: SideLook = sideLook(null, "H", "");

const NO_ITEMS: StatLine = [];

/**
 * Stat rows in each of a section's two columns (Jed, Oct 7: show as much as
 * fits). Without live stats the season has the whole column; with them,
 * tonight takes the lower part. The left column is the line's biggest group
 * and the right its next (lib/cards/lines.ts); a line of one group runs down
 * the left column and on into the right.
 */
export const STAT_ROWS = {
  hero: { season: 5, withTonight: { season: 3, tonight: 2 } },
  small: { season: 5, withTonight: { season: 2, tonight: 2 } },
} as const;

/** Columns in each section. One per group. */
export const STAT_COLUMNS = MAX_GROUPS;

/** The most rows a column has, which is how many slots each column renders. */
const COLUMN_SLOTS = Array.from({ length: MAX_GROUP_ITEMS }, (_, index) => index);
const TONIGHT_SLOTS = COLUMN_SLOTS.slice(0, Math.max(STAT_ROWS.hero.withTonight.tonight, STAT_ROWS.small.withTonight.tonight));

/**
 * A stat's size, in em of the card. A small card is the hero at half size, so
 * its stats are drawn a little bigger relative to it, and stay above the
 * smallest size anything on the stage is (0.4em of the base size).
 */
const ITEM_SIZE = { hero: 0.85, small: 0.9 } as const;
const ROW_LINE_HEIGHT = 1.1;

/** The storyline under the name: two lines at most, in em of the card. */
const STORY_SIZE = { hero: "0.68em", small: "0.82em" } as const;

/** One item's three spans: a label said first ("long "), the value, the label said after (" yds"). */
interface ItemFields {
  root: HTMLElement;
  lead: HTMLElement;
  value: HTMLElement;
  label: HTMLElement;
}

/** A section's row slots, one item each, by column. */
interface LineFields {
  columns: ItemFields[][];
}

/** The writable parts of a card. Resolved once, then written to on every match. */
export interface CardFields {
  root: HTMLElement;
  slab: HTMLElement;
  jersey: HTMLElement;
  position: HTMLElement;
  /** The away school code under the position. Hidden for home. */
  code: HTMLElement;
  /** The big line, whose size steps down for a long name. */
  big: HTMLElement;
  /** The surname, when there is no respelling. */
  plain: HTMLElement;
  before: HTMLElement;
  stressed: HTMLElement;
  after: HTMLElement;
  smallFirst: HTMLElement;
  smallLast: HTMLElement;
  /** The player's storyline, under the name. Hidden when there is none. */
  storyline: HTMLElement;
  season: LineFields;
  /** Every other sport's first saved line, in the season section. */
  seasonText: HTMLElement;
  tonight: LineFields;
  /** The TONIGHT section, hidden on a game without live stats. Read, never written, by the writer. */
  tonightSection: HTMLElement;
  /** Which card it is, for its rows: STAT_ROWS. */
  size: "hero" | "small";
}

function finder(root: HTMLElement) {
  return (name: string) => root.querySelector<HTMLElement>(`[data-card="${name}"]`)!;
}

function itemFields(item: HTMLElement): ItemFields {
  const part = (name: string) => item.querySelector<HTMLElement>(`[data-part="${name}"]`)!;
  return { root: item, lead: part("lead"), value: part("value"), label: part("label") };
}

function lineFields(root: HTMLElement, line: "season" | "tonight"): LineFields {
  const slots = line === "season" ? COLUMN_SLOTS : TONIGHT_SLOTS;
  const columns = Array.from({ length: STAT_COLUMNS }, (_, column) => column);
  return { columns: columns.map((column) => slots.map((slot) => itemFields(finder(root)(`${line}-item-${column}-${slot}`)))) };
}

/** Finds the writable parts of a rendered card. Called once per card, never in the hot path. */
export function cardFields(root: HTMLElement): CardFields {
  const find = finder(root);
  return {
    root,
    slab: find("slab"),
    jersey: find("jersey"),
    position: find("position"),
    code: find("code"),
    big: find("big"),
    plain: find("plain"),
    before: find("before"),
    stressed: find("stressed"),
    after: find("after"),
    smallFirst: find("small-first"),
    smallLast: find("small-last"),
    storyline: find("storyline"),
    season: lineFields(root, "season"),
    seasonText: find("season-text"),
    tonight: lineFields(root, "tonight"),
    tonightSection: find("tonight-section"),
    size: root.dataset.size === "small" ? "small" : "hero",
  };
}

/**
 * HOT PATH. Writes one player into a rendered card, the hero or a small one.
 *
 * Text, hidden flags and a few style writes. No element is created and no
 * layout is read. A game built before the card face (lib/cards/cardFace.ts)
 * has no `face`, and its card shows the saved names as they are.
 *
 * `lines` are live stats' season and tonight for this player, when they have
 * done something tonight. `fit` is the big line fitted to the card, worked
 * out once per player after the font loaded; without it the big line goes up
 * whole at full size.
 */
export function writeCard(
  fields: CardFields,
  player: WatchlistPlayer | undefined,
  look?: SideLook | null,
  lines?: CardLines,
  fit?: BigLineFit,
) {
  fields.root.hidden = player === undefined;
  if (!player) return;
  const face = player.face;

  writeSlab(fields.slab, fields.code, look);
  fields.jersey.textContent = face ? face.jersey : (player.jersey ?? NO_JERSEY);
  fields.jersey.style.fontSize = face?.longJersey ? LONG_JERSEY_SIZE : JERSEY_SIZE;
  fields.position.textContent = face ? face.position : (player.position ?? "");

  writeBigLine(fields, player, fit);
  fields.smallFirst.textContent = face ? face.smallFirst : (player.first_name ?? "");
  fields.smallLast.textContent = face ? face.smallLast : "";
  const storyline = face?.storyline ?? "";
  fields.storyline.textContent = storyline;
  fields.storyline.hidden = storyline.length === 0;

  if (lines) writeStatLines(fields, lines.season, "", lines.tonight);
  else writeStatLines(fields, face ? face.season : NO_ITEMS, face ? face.seasonText : (player.stat_lines[0] ?? ""), NO_ITEMS);
}

/**
 * The big line: the respelling's three parts, or the surname. A "\n" in a
 * fitted part is its one break, which the line's pre-line white space shows.
 * Also called after paint, when the fit arrives for a card already up: text
 * and one size, and the card's own size is fixed.
 */
export function writeBigLine(fields: CardFields, player: WatchlistPlayer, fit?: BigLineFit) {
  const parts = fit ?? player.face;
  fields.plain.textContent = parts ? parts.plain : player.last_name;
  fields.before.textContent = parts ? parts.before : "";
  fields.stressed.textContent = parts ? parts.stressed : "";
  fields.after.textContent = parts ? parts.after : "";
  fields.big.style.fontSize = fit ? `${fit.size}em` : BIG_SIZE;
}

/**
 * The season section and tonight's. Live stats rewrite a card already up with
 * this, the same function writeCard uses, and the sections are fixed, so a
 * stat can never change the card's size (docs/V3_DEFINITION.md G3).
 */
export function writeStatLines(fields: CardFields, season: StatLine, seasonText: string, tonight: StatLine) {
  // Tonight's section is drawn for the whole game or not at all, so this is a
  // flag read, never a layout read.
  const rows = STAT_ROWS[fields.size];
  const withTonight = !fields.tonightSection.hidden;
  writeLine(fields.season, season, withTonight ? rows.withTonight.season : rows.season);
  fields.seasonText.textContent = seasonText;
  fields.seasonText.hidden = seasonText.length === 0;
  writeLine(fields.tonight, tonight, withTonight ? rows.withTonight.tonight : 0);
}

/**
 * One item per row, `rows` rows in each column. A line of two groups puts each
 * in its own column, the highest priority items of each (rank under the row
 * count) in the order they are said. A line of one group (or one saved before
 * Oct 7) runs down the left column and on into the right. Rows left over are
 * hidden.
 */
function writeLine(line: LineFields, items: StatLine, rows: number) {
  const twoGroups = items.some((item) => (item.group ?? 0) > 0);
  const placed: StatItem[][] = line.columns.map(() => []);
  if (twoGroups) {
    for (const item of items) {
      const column = item.group ?? 0;
      if (column < placed.length && (item.rank ?? 0) < rows) placed[column].push(item);
    }
  } else {
    const kept = items.filter((item, index) => (item.rank ?? index) < rows * placed.length);
    kept.forEach((item, index) => placed[Math.floor(index / rows)]?.push(item));
  }
  line.columns.forEach((slots, column) => {
    slots.forEach((slot, row) => writeItem(slot, row < rows ? placed[column][row] : undefined));
  });
}

function writeItem(fields: ItemFields, item: StatItem | undefined) {
  fields.root.hidden = item === undefined;
  if (!item) return;
  fields.lead.textContent = item.labelFirst ? `${item.label} ` : "";
  fields.value.textContent = item.estimated ? `${ESTIMATE_MARK}${item.value}` : item.value;
  fields.label.textContent = item.labelFirst || !item.label ? "" : ` ${item.label}`;
}

/** The slab's colour, ink and away hatching, and the away school code. */
function writeSlab(slab: HTMLElement, code: HTMLElement, look?: SideLook | null) {
  const side = look ?? NO_LOOK;
  slab.style.backgroundColor = side.background;
  slab.style.backgroundImage = side.hatch;
  slab.style.color = side.ink;
  code.textContent = side.code;
  code.hidden = side.code.length === 0;
}

/** A row's style: a fixed height, one line, never wider than its column. */
const ROW_STYLE = { height: `${ROW_LINE_HEIGHT}em`, lineHeight: ROW_LINE_HEIGHT, whiteSpace: "nowrap", overflow: "hidden" } as const;

/** One row, one item: a label said first, the value, the label said after. Hidden rows take no room. */
function ItemSlot({ name }: { name: string }) {
  return (
    <div data-card={name} hidden style={ROW_STYLE}>
      <span data-part="lead" style={{ fontSize: "0.85em" }} />
      <span data-part="value" style={{ fontWeight: 700 }} />
      <span data-part="label" style={{ fontSize: "0.85em" }} />
    </div>
  );
}

/** A section's two columns of rows, one item each: "420 yds" over "5 TD", and beside them "22 rec" over "180 yds". */
function Columns({ line, slots, size }: { line: "season" | "tonight"; slots: readonly number[]; size: "hero" | "small" }) {
  return (
    <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", columnGap: "0.3em", fontSize: `${ITEM_SIZE[size]}em`, fontWeight: 500 }}>
      {Array.from({ length: STAT_COLUMNS }, (_, column) => (
        <div key={column} className="min-w-0">
          {slots.map((slot) => (
            <ItemSlot key={slot} name={`${line}-item-${column}-${slot}`} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** How much of the column a section takes: its label and its rows, so neither is ever cut off. */
function sectionGrow(rows: number, size: "hero" | "small"): number {
  const label = size === "small" ? 1.1 : 0.7;
  return label + rows * ITEM_SIZE[size] * ROW_LINE_HEIGHT;
}

/** "SEASON", "TONIGHT": small, spaced capitals over each section's line. */
function SectionLabel({ text, size }: { text: string; size: "hero" | "small" }) {
  return (
    <span className="text-[#555555]" style={{ fontSize: LABEL_SIZE[size], fontWeight: 700, letterSpacing: "0.08em", lineHeight: 1.2 }}>
      {text}
    </span>
  );
}

/**
 * A card, empty: 32em by 6.4em whatever is written into it. `small` is one of
 * the two older cards, drawn by its parent at SMALL_SCALE, with its labels
 * bigger relative to it. `tonight` is a game with live stats on: the stats
 * column has a TONIGHT section, on a grey band, under the season. Both are
 * fixed for the card's life.
 */
export function PlayerCard({ small = false, tonight = true }: { small?: boolean; tonight?: boolean }) {
  const size = small ? "small" : "hero";
  return (
    <article
      data-card="card"
      hidden
      data-size={size}
      className="flex overflow-hidden bg-white text-[#111111]"
      style={{ width: `${HERO_WIDTH_EM}em`, height: `${HERO_HEIGHT_EM}em`, lineHeight: 1 }}
    >
      <div
        data-card="slab"
        className="flex flex-none flex-col items-center justify-center"
        style={{ width: `${SLAB_WIDTH_EM}em`, gap: "0.15em" }}
      >
        <span data-card="jersey" style={{ fontSize: JERSEY_SIZE, fontWeight: 800 }} />
        <span data-card="position" style={{ fontSize: "0.9em", fontWeight: 700 }} />
        <span data-card="code" hidden style={{ fontSize: CODE_SIZE[size], fontWeight: 700, letterSpacing: "0.04em" }} />
      </div>

      <div
        className="flex min-w-0 flex-1 flex-col justify-center overflow-hidden"
        style={{ padding: `0 ${NAME_PADDING_EM}em`, gap: "0.2em" }}
      >
        <div data-card="big" style={{ fontSize: BIG_SIZE, lineHeight: 1.05, letterSpacing: "0.01em", whiteSpace: "pre-line" }}>
          <span data-card="plain" style={{ fontWeight: 700 }} />
          <span data-card="before" style={{ fontWeight: 500 }} />
          <span data-card="stressed" style={{ fontWeight: 800, letterSpacing: "0.03em" }} />
          <span data-card="after" style={{ fontWeight: 500 }} />
        </div>
        <div style={{ fontSize: "1em", lineHeight: 1.2, letterSpacing: "0.01em", whiteSpace: "nowrap" }}>
          <span data-card="small-first" style={{ fontWeight: 500 }} />
          <span data-card="small-last" style={{ fontWeight: 700 }} />
        </div>
        {/* The storyline (Jed, Oct 7): two lines at most, cut with an ellipsis, never taller. */}
        <div
          data-card="storyline"
          hidden
          className="text-[#333333]"
          style={{
            fontSize: STORY_SIZE[size],
            lineHeight: 1.15,
            fontWeight: 500,
            display: "-webkit-box",
            WebkitBoxOrient: "vertical",
            WebkitLineClamp: 2,
            overflow: "hidden",
            overflowWrap: "anywhere",
          }}
        />
      </div>

      <div className="flex flex-none flex-col" style={{ width: `${STATS_WIDTH_EM}em` }}>
        <div
          className="flex min-h-0 flex-col justify-center"
          style={{
            padding: "0 0.5em",
            gap: "0.1em",
            flexGrow: tonight ? sectionGrow(STAT_ROWS[size].withTonight.season, size) : 1,
            flexBasis: 0,
          }}
        >
          <SectionLabel text="SEASON" size={size} />
          {/* Every row is rendered; the writer hides the ones this card does not use. */}
          <div data-card="season">
            <Columns line="season" slots={COLUMN_SLOTS} size={size} />
            <div data-card="season-text" hidden style={ROW_STYLE} />
          </div>
        </div>
        {/* Tonight is always drawn on a game with live stats, empty until the player does something. */}
        <div
          data-card="tonight-section"
          hidden={!tonight}
          className="flex min-h-0 flex-col justify-center bg-[#F0F0F0]"
          style={{ padding: "0 0.5em", gap: "0.1em", flexGrow: sectionGrow(STAT_ROWS[size].withTonight.tonight, size), flexBasis: 0 }}
        >
          <SectionLabel text="TONIGHT" size={size} />
          <div data-card="tonight">
            <Columns line="tonight" slots={TONIGHT_SLOTS} size={size} />
          </div>
        </div>
      </div>
    </article>
  );
}
