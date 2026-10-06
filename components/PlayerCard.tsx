import { readableInk } from "@/lib/game/colors";
import { MAX_STAT_LINES } from "@/lib/cards/limits";
import type { WatchlistPlayer } from "@/lib/watchlist";

// =============================================================================
// One player's card: number on the left, name across the top, and the space
// underneath left for what they have done today.
//
// When the announcer typed a pronunciation for a player, that is the big text,
// because it is what gets said on air, and the surname as spelled sits small
// beside it. The date the season numbers were taken is a stamp in the corner.
//
// The markup is rendered once, empty, and filled in by writeCard from the
// socket handler. Nothing here allocates an element on a match, which is what
// keeps a spotted name a DOM write rather than a React render.
//
// Every size is in em so one font-size on the root scales the whole card. The
// live screen uses that to make the newest card the biggest thing on screen.
// Borders stay in px so they do not turn into slabs at large sizes.
// =============================================================================

/** The jersey number's red, used when the team has no colour of its own. */
const NUMBER_RED = "#b5303a";

/** Number cell width in em. Holds "00" or "123" at the number's size. */
const NUMBER_WIDTH = "4.5em";
const NAME_PADDING = "0.25em";
const NAME_GAP = "0.2em";

/**
 * Everything across the card that is not text, in em: the number cell, the
 * name line's padding, and the two gaps. With the text widths measured, this
 * is what turns an available width into a font size.
 */
export const CARD_EM_CHROME = 4.5 + 0.25 * 2 + 0.2 * 2;

/**
 * The name row's gap in em, counted once more when the spelled surname is
 * showing. CARD_EM_CHROME already holds the two gaps the row always had.
 */
export const EXTRA_NAME_GAP_EM = 0.2;

/** The three vertical borders. These stay in px at any size, so they are added flat. */
export const CARD_BORDER_PX = 9;

/** The stat area with nothing in it yet. A card with no stats keeps its shape. */
const STATS_MIN_HEIGHT = "1.2em";

/**
 * The older cards, at a quarter of the stage each, cannot fit a whole card and
 * be read from across a booth. So they carry the three things a glance needs,
 * and only those: the number, the surname, and the first stat line, which is
 * the one written best first.
 *
 * Which parts go is decided in CSS, keyed off this attribute on the card root,
 * rather than by writeCard hiding four more elements on every match. The hidden
 * parts then measure 0 wide and count for nothing in the fit, so a compact card
 * sizes itself up to fill its row without being told to.
 */
export const COMPACT_ATTRIBUTE = "data-compact";
const COMPACT_HIDDEN = "group-data-[compact=true]:hidden";

const STAT_SLOTS = Array.from({ length: MAX_STAT_LINES }, (_, index) => index);

/** Shown in the number cell when the roster gave no jersey. */
const NO_JERSEY = "–";

/**
 * The digit that takes this card down, small in the bottom corner.
 *
 * It is there so the keys can be learned from the screen rather than from a
 * document nobody has open during a game: the card in the second slot says 2,
 * and 2 is the key that removes it.
 */
const HINT_SIZE = "0.22em";

/**
 * The "as of 9/26" stamp, bottom left under the number. Positioned absolutely,
 * like the key digit, so it can never change the card's size or the fit.
 */
const AS_OF_SIZE = "0.2em";

/** Separates year, height and weight. */
const VITALS_SEPARATOR = " · ";

/** The text nodes inside one card. Resolved once, then written to on every match. */
export interface CardFields {
  root: HTMLElement;
  /**
   * Fixed for this slot's whole life. writeCard has no other way to know which
   * season line to give up for a tonight line, and asking the DOM would be a
   * read in the hot path.
   */
  compact: boolean;
  jersey: HTMLElement;
  first: HTMLElement;
  /** The big name: the pronunciation when there is one, the surname otherwise. */
  last: HTMLElement;
  /** The surname as spelled, small beside a pronunciation. Hidden without one. */
  spelled: HTMLElement;
  vitals: HTMLElement;
  /** What this player has done tonight, estimated from the call. Empty hides it. */
  tonight: HTMLElement;
  stats: HTMLElement[];
  asOf: HTMLElement;
}

/** Finds the writable parts of a rendered card. Called once per card, never in the hot path. */
export function cardFields(root: HTMLElement, compact = false): CardFields {
  const find = (name: string) => root.querySelector<HTMLElement>(`[data-card="${name}"]`)!;
  return {
    root,
    compact,
    jersey: find("jersey"),
    first: find("first"),
    last: find("last"),
    spelled: find("spelled"),
    vitals: find("vitals"),
    tonight: find("tonight"),
    stats: STAT_SLOTS.map((slot) => find(`stat-${slot}`)),
    asOf: find("as-of"),
  };
}

/**
 * HOT PATH. Writes one player into an already rendered card.
 *
 * Text assignment and a hidden flag, nothing else: no allocation, no layout
 * read, no React. An absent first name or a missing height hides its element
 * rather than leaving a gap or a stray separator behind.
 */
export function writeCard(
  fields: CardFields,
  player: WatchlistPlayer | undefined,
  color?: string | null,
  tonight?: string,
) {
  fields.root.hidden = player === undefined;
  if (!player) return;

  // The card itself stays white. The team's colour is on the screen behind it,
  // and appears on the card only as the number's ink, which is what says who a
  // player plays for. readableInk darkens a pale school colour rather than
  // printing an invisible number on white.
  fields.jersey.style.color = (color ? readableInk(color) : null) ?? NUMBER_RED;

  fields.jersey.textContent = player.jersey?.trim() || NO_JERSEY;

  const first = player.first_name?.trim() ?? "";
  fields.first.textContent = first;
  fields.first.hidden = first.length === 0;

  // The pronunciation keeps the case it was typed in, because its capitals
  // are the stress ("oh-soo-EH-tuh"). The surname is always shown in capitals.
  const said = player.pronunciation ?? "";
  if (said.length > 0) {
    fields.last.textContent = said;
    fields.last.style.textTransform = "none";
    fields.spelled.textContent = player.last_name;
    fields.spelled.hidden = false;
  } else {
    fields.last.textContent = player.last_name;
    fields.last.style.textTransform = "";
    fields.spelled.textContent = "";
    fields.spelled.hidden = true;
  }

  const vitals = [player.grade, player.height, player.weight]
    .map((part) => part?.trim() ?? "")
    .filter((part) => part.length > 0)
    .join(VITALS_SEPARATOR);
  fields.vitals.textContent = vitals;
  fields.vitals.hidden = vitals.length === 0;

  // Tonight goes above the season lines and takes one of their slots rather
  // than adding a fourth. The card is the same three text lines either way, so
  // its height and the font size fitCards works out are both unchanged: a card
  // with a tally must not read smaller than one without.
  const estimated = tonight ?? "";
  fields.tonight.textContent = estimated;
  fields.tonight.hidden = estimated.length === 0;

  const lines = player.stat_lines ?? [];
  // A compact card shows one line, so tonight is it. A full card shows three,
  // so the third season line is the one that stands down.
  fields.stats.forEach((slot, index) => {
    const surrendered = estimated.length > 0 && index === (fields.compact ? 0 : MAX_STAT_LINES - 1);
    const line = surrendered ? "" : (lines[index] ?? "");
    slot.textContent = line;
    slot.hidden = line.length === 0;
  });

  const asOf = player.as_of ?? "";
  fields.asOf.textContent = asOf;
  fields.asOf.hidden = asOf.length === 0;
}

/**
 * An empty card. White with black rules whatever else is on the page, because
 * this is the thing being read at a glance.
 */
export function PlayerCard({ hint }: { hint?: number }) {
  return (
    <article
      data-compact="false"
      className="group relative flex w-full border-[3px] border-black bg-white text-black"
    >
      <div
        className="flex shrink-0 items-center justify-center border-r-[3px] border-black"
        style={{ width: NUMBER_WIDTH }}
      >
        <span
          data-card="jersey"
          className="font-black leading-none tabular-nums"
          style={{ fontSize: "2em", color: NUMBER_RED }}
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div
          className="flex flex-nowrap items-baseline whitespace-nowrap border-b-2 border-black"
          style={{ gap: `0 ${NAME_GAP}`, padding: `0.1em ${NAME_PADDING}` }}
        >
          {/* shrink-0 throughout: a squeezed span would measure narrower than
              the text in it, and the fit below measures these to size the card. */}
          <span
            data-card="first"
            style={{ fontSize: "0.5em" }}
            className={`shrink-0 leading-none ${COMPACT_HIDDEN}`}
          />
          <span data-card="last" className="shrink-0 font-black uppercase leading-none tracking-tight" />
          {/* The spelled surname beside a pronunciation. Gone on a compact
              card, which keeps only what gets said. */}
          <span
            data-card="spelled"
            hidden
            className={`shrink-0 font-semibold uppercase leading-none text-neutral-600 ${COMPACT_HIDDEN}`}
            style={{ fontSize: "0.34em" }}
          />
          <span
            data-card="vitals"
            className={`ml-auto shrink-0 font-semibold text-neutral-700 ${COMPACT_HIDDEN}`}
            style={{ fontSize: "0.34em" }}
          />
        </div>

        {/* Stat line sizes are Tailwind classes rather than constants at the top
            of this file, because Tailwind only generates the CSS for class
            names it can read in the source: an interpolated constant would
            produce no rule at all. 0.34em on a full card, where three lines
            have to fit; 0.5em on a compact card's single line. */}
        <div
          className="flex flex-col justify-center"
          style={{ minHeight: STATS_MIN_HEIGHT, padding: `0.08em ${NAME_PADDING}`, gap: "0.04em" }}
        >
          {/* Tonight, above the season lines and styled apart from them. Black
              and heavier where a season line is grey and lighter, because one
              came off a real stat sheet and this one is a guess read off the
              announcer's own call. Never COMPACT_HIDDEN: the compact card is
              exactly where it earns its place, which is why writeCard gives up
              stat-0 there instead. */}
          <span
            data-card="tonight"
            hidden
            className="truncate text-[0.34em] font-black uppercase leading-tight tracking-wide text-black group-data-[compact=true]:text-[0.5em]"
          />

          {STAT_SLOTS.map((slot) => (
            <span
              key={slot}
              data-card={`stat-${slot}`}
              hidden
              // The first line stays and grows; the rest go. A compact card has
              // room for one line said out loud, not three.
              className={`truncate text-[0.34em] font-semibold leading-tight text-neutral-800 ${
                slot === 0 ? "group-data-[compact=true]:text-[0.5em]" : COMPACT_HIDDEN
              }`}
            />
          ))}
        </div>
      </div>

      <span
        data-card="as-of"
        hidden
        aria-hidden="true"
        className="pointer-events-none absolute bottom-0 left-0 select-none whitespace-nowrap font-semibold leading-none text-neutral-500"
        style={{ fontSize: AS_OF_SIZE, padding: "0.35em" }}
      />

      {hint !== undefined && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-0 bottom-0 select-none font-semibold leading-none text-neutral-400"
          style={{ fontSize: HINT_SIZE, padding: "0.35em" }}
        >
          {hint}
        </span>
      )}
    </article>
  );
}
