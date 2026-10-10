import type { BigLineFit } from "@/lib/cards/bigLine";
import { BIG_LINE_SIZES, HERO_HEIGHT_EM, HERO_WIDTH_EM, NAME_PADDING_EM, SLAB_WIDTH_EM, STATS_WIDTH_EM } from "@/lib/cards/bigLine";
import { NO_JERSEY } from "@/lib/cards/cardFace";
import { ESTIMATE_MARK, type CardLines, type StatItem, type StatLine } from "@/lib/cards/lines";
import {
  layoutStats,
  MAX_STAT_SIZE_EM,
  MAX_STAT_SLOTS,
  SECTION_LABEL_EM,
  SECTION_LABEL_GAP_EM,
  SECTION_LABEL_LINE_HEIGHT,
  sectionHeightEm,
  STAT_COLUMN_GAP,
  STAT_LABEL_SCALE,
  STAT_ROW_LINE_HEIGHT,
  statBox,
  STATS_PAD_X_EM,
  STATS_PAD_Y_EM,
  writtenItems,
  type CardSize,
  type StatLayout,
  type StatSection,
} from "@/lib/cards/statLayout";
import { sideLook, type SideLook } from "@/lib/game/colors";
import type { WatchlistPlayer } from "@/lib/watchlist";

// =============================================================================
// The spotting card (docs/CARD_SPEC.md): a wide strip. Left to right, the
// number in the team's colour, the name with the player's storyline under it,
// and a stats column with the season above and tonight below, each every stat
// the player has, a column per group in rows, sized so none is cut off (Jed,
// Oct 8; lib/cards/statLayout.ts). The newest player's card is the hero; the two
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
 * The away code, in em of the card. A small card is the hero at half size, so
 * it is drawn bigger relative to it, to stay at the smallest size anything on
 * the stage is (0.4em of the base size). The section labels' sizes are in
 * lib/cards/statLayout.ts, which lays the rows out under them.
 */
const CODE_SIZE = { hero: "0.45em", small: "0.82em" } as const;

/** A slab before a game says otherwise: home with no colour. */
const NO_LOOK: SideLook = sideLook(null, "H", "");

const NO_ITEMS: StatLine = [];

/** The storyline under the name: two lines at most, in em of the card. */
const STORY_SIZE = { hero: "0.68em", small: "0.82em" } as const;

/** One item's three spans: a label said first ("long "), the value, the label said after (" yds"). */
interface ItemFields {
  root: HTMLElement;
  lead: HTMLElement;
  value: HTMLElement;
  label: HTMLElement;
}

/** A section's grid and its item slots, one item each; the writer places each slot in the grid. */
interface LineFields {
  grid: HTMLElement;
  slots: ItemFields[];
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
  tonight: LineFields;
  /** The TONIGHT section, hidden on a game without live stats. Read, never written, by the writer. */
  tonightSection: HTMLElement;
  /** Which card it is: the hero or a half-size one, whose stats are laid out in its own sizes. */
  size: CardSize;
}

function finder(root: HTMLElement) {
  return (name: string) => root.querySelector<HTMLElement>(`[data-card="${name}"]`)!;
}

function itemFields(item: HTMLElement): ItemFields {
  const part = (name: string) => item.querySelector<HTMLElement>(`[data-part="${name}"]`)!;
  return { root: item, lead: part("lead"), value: part("value"), label: part("label") };
}

function lineFields(root: HTMLElement, line: StatSection): LineFields {
  const find = finder(root);
  return { grid: find(line), slots: SLOTS.map((slot) => itemFields(find(`${line}-item-${slot}`))) };
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
  else writeStatLines(fields, face ? face.season : NO_ITEMS, face ? face.seasonText : player.stat_lines.join("\n"), NO_ITEMS);
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
 * The season section and tonight's, every item placed (lib/cards/statLayout.ts).
 * Live stats rewrite a card already up with this, the same function writeCard
 * uses, and the sections are fixed boxes, so a stat can never change the
 * card's size (docs/V3_DEFINITION.md G3). Another sport's written lines
 * (`seasonText`, one a line) are laid out the same way.
 */
export function writeStatLines(fields: CardFields, season: StatLine, seasonText: string, tonight: StatLine) {
  // Tonight's section is drawn for the whole game or not at all, so this is a
  // flag read, never a layout read.
  const withTonight = !fields.tonightSection.hidden;
  const seasonItems = season.length > 0 || seasonText.length === 0 ? season : textItems(seasonText);
  writeLine(fields.season, layoutFor(seasonItems, fields.size, "season", withTonight));
  writeLine(fields.tonight, withTonight ? layoutFor(tonight, fields.size, "tonight", withTonight) : EMPTY_LAYOUT);
}

const EMPTY_LAYOUT: StatLayout = { size: 1, rows: 0, columns: 0, cells: [] };

/**
 * Layouts already worked out, by line and by where it goes. A line is the
 * same array for a player's whole game (the face, or live stats' lines until
 * the next play), so a card that goes up again does no arithmetic.
 */
const layouts = new WeakMap<StatLine, Map<string, StatLayout>>();

function layoutFor(items: StatLine, size: CardSize, section: StatSection, withTonight: boolean): StatLayout {
  if (items.length === 0) return EMPTY_LAYOUT;
  const key = `${size}:${section}:${withTonight}`;
  let byPlace = layouts.get(items);
  if (!byPlace) layouts.set(items, (byPlace = new Map()));
  let layout = byPlace.get(key);
  if (!layout) {
    layout = layoutStats(items, statBox(size, section, withTonight), MAX_STAT_SIZE_EM[size]);
    byPlace.set(key, layout);
  }
  return layout;
}

/** Another sport's written lines as items, made once per text. */
const written = new Map<string, StatLine>();

function textItems(text: string): StatLine {
  let items = written.get(text);
  if (!items) written.set(text, (items = writtenItems(text)));
  return items;
}

/** The grid's size, then each slot: its item and its cell, or hidden. */
function writeLine(line: LineFields, layout: StatLayout) {
  line.grid.style.fontSize = `${layout.size}em`;
  line.slots.forEach((slot, index) => {
    const cell = layout.cells[index];
    writeItem(slot, cell?.item);
    if (!cell) return;
    slot.root.style.gridColumn = String(cell.column + 1);
    slot.root.style.gridRow = String(cell.row + 1);
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

/** The item slots each section renders, all hidden until written. */
const SLOTS = Array.from({ length: MAX_STAT_SLOTS }, (_, index) => index);

/** One item: a label said first, the value, the label said after, on one line. Hidden slots take no room. */
function ItemSlot({ name }: { name: string }) {
  return (
    <div data-card={name} hidden style={{ whiteSpace: "nowrap" }}>
      <span data-part="lead" style={{ fontSize: `${STAT_LABEL_SCALE}em` }} />
      <span data-part="value" style={{ fontWeight: 700 }} />
      <span data-part="label" style={{ fontSize: `${STAT_LABEL_SCALE}em` }} />
    </div>
  );
}

/**
 * A section: its label, then its grid. The section is a fixed box; the writer
 * sets the grid's text size and puts each slot in its column and row, a
 * column per group, so every item is whole.
 */
function Section({
  line,
  size,
  withTonight,
  className = "",
  hidden,
}: {
  line: StatSection;
  size: CardSize;
  withTonight: boolean;
  className?: string;
  hidden?: boolean;
}) {
  return (
    <div
      data-card={line === "tonight" ? "tonight-section" : undefined}
      hidden={hidden}
      className={`flex flex-none flex-col ${className}`}
      style={{
        height: `${sectionHeightEm(line, withTonight)}em`,
        padding: `${STATS_PAD_Y_EM}em ${STATS_PAD_X_EM}em`,
        gap: `${SECTION_LABEL_GAP_EM}em`,
      }}
    >
      <SectionLabel text={line === "season" ? "SEASON" : "TONIGHT"} size={size} />
      {/* Every slot is rendered; the writer hides the ones this player does not use. */}
      <div
        data-card={line}
        className="grid min-h-0 flex-1"
        style={{
          gridAutoColumns: "max-content",
          gridAutoRows: `${STAT_ROW_LINE_HEIGHT}em`,
          columnGap: `${STAT_COLUMN_GAP}em`,
          alignContent: "center",
          lineHeight: STAT_ROW_LINE_HEIGHT,
          fontWeight: 500,
        }}
      >
        {SLOTS.map((slot) => (
          <ItemSlot key={slot} name={`${line}-item-${slot}`} />
        ))}
      </div>
    </div>
  );
}

/** "SEASON", "TONIGHT": small, spaced capitals over each section's rows. */
function SectionLabel({ text, size }: { text: string; size: CardSize }) {
  return (
    <span
      className="flex-none text-[#555555]"
      style={{ fontSize: `${SECTION_LABEL_EM[size]}em`, fontWeight: 700, letterSpacing: "0.08em", lineHeight: SECTION_LABEL_LINE_HEIGHT }}
    >
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
        <Section line="season" size={size} withTonight={tonight} />
        {/* Tonight is always drawn on a game with live stats, empty until the player does something. */}
        <Section line="tonight" size={size} withTonight={tonight} hidden={!tonight} className="bg-[#F0F0F0]" />
      </div>
    </article>
  );
}
