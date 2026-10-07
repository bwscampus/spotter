"use client";

import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import {
  CARD_BORDER_PX,
  CARD_EM_CHROME,
  COMPACT_ATTRIBUTE,
  EXTRA_NAME_GAP_EM,
  PlayerCard,
  cardFields,
  writeCard,
  type CardFields,
} from "@/components/PlayerCard";
import { MAX_NAMES_ON_SCREEN } from "@/lib/matching/SpotterEngine";
import type { WatchlistPlayer } from "@/lib/watchlist";

/** The colour each side wears, resolved when the game was built. */
export type SideColors = Record<"H" | "A", string | null>;

/**
 * What each player has done tonight, by player object rather than by key.
 *
 * Identity, not a string: the WatchlistPlayer objects in the jersey index are
 * the same objects for the whole game, so this is exactly as positional as the
 * slot key would be, and neither show nor writeCard has to learn what a slot
 * key is. Anything that ever spreads a player between the index and here makes
 * the lookup miss silently, which is what the test pinning it by reference is
 * for.
 */
export type TonightLines = ReadonlyMap<WatchlistPlayer, string>;

export interface NameDisplayHandle {
  /** Writes players (newest first) straight into the DOM, synchronously. Empty shows the placeholder. */
  show(players: WatchlistPlayer[], colors?: SideColors, tonight?: TonightLines): void;
}

// The newest card gets this many times the height of each older one, so a
// glance lands on it first. With three cards that is a 50/25/25 split.
const NEWEST_WEIGHT = 2;

/**
 * Which slots show a compact card: everything but the newest.
 *
 * A quarter of the stage is not enough for a first name, vitals and three stat
 * lines at a size anyone can read from across a booth, so the older cards drop
 * to the number, the surname and one stat line. Which parts go is CSS, keyed
 * off the attribute this sets.
 */
const isCompactSlot = (slot: number) => slot > 0;

/**
 * How much of its row a card takes, leaving the rest as the gap it is staggered
 * into: away cards sit against the left edge, home cards against the right, so
 * a run of names from both teams fans out like a hand of cards.
 *
 * The cost of the stagger is this much width, and almost always none at all: a
 * card is sized by the shorter of what its row's height and its own width
 * allow, and height is what binds except for an unusually long surname.
 */
const CARD_WIDTH_SHARE = 0.9;
const WIDTH_FILL = 0.98;
const HEIGHT_FILL = 0.96;
const MEASURE_FONT_PX = 100;
const SLOTS = Array.from({ length: MAX_NAMES_ON_SCREEN }, (_, slot) => slot);

/** The row that owns a card's height share. */
function rowOf(card: CardFields): HTMLElement {
  return card.root.parentElement as HTMLElement;
}

/**
 * Sizes each shown card to fill its row, capped so the longest surname still
 * fits across. Writes, then one layout read, then writes, the same shape the
 * bare names used.
 *
 * The whole card is sized in em, so its width at font-size 1 is a constant
 * (CARD_EM_CHROME) plus the width of its text. Measuring the text spans
 * once at MEASURE_FONT_PX gives that, and the font size that fits follows by
 * division. Nothing here changes the geometry of anything the ResizeObserver
 * watches: only the cards' font size is written, and the stage is a fixed box
 * with overflow hidden, so a fit can never trigger another one.
 */
function fitCards(stage: HTMLElement, cards: CardFields[]) {
  const shown = cards.filter((card) => !card.root.hidden);
  if (shown.length === 0) return;

  for (const card of shown) card.root.style.fontSize = `${MEASURE_FONT_PX}px`;

  // The one layout read. A hidden span measures 0 and so costs the card nothing.
  // Height is measured rather than assumed, because a card with three stat
  // lines on it is taller than one with none.
  const measured = shown.map((card) => ({
    text:
      card.first.getBoundingClientRect().width +
      card.last.getBoundingClientRect().width +
      card.spelled.getBoundingClientRect().width +
      card.vitals.getBoundingClientRect().width,
    // Measured rather than read off `hidden`: a compact card hides it in CSS.
    spelledShown: card.spelled.getBoundingClientRect().width > 0,
    height: card.root.getBoundingClientRect().height,
    // The card's own width, not the row's: it is narrower than its row by the
    // stagger, and that is the width its name has to fit across.
    available: card.root.getBoundingClientRect().width,
    rowHeight: rowOf(card).clientHeight,
  }));

  shown.forEach((card, index) => {
    const { text, spelledShown, height, available, rowHeight } = measured[index];
    // The card's width in em, which is what the available width divides by.
    // A pronunciation puts a third span in the name row, and with it a third gap.
    const emWidth = CARD_EM_CHROME + (spelledShown ? EXTRA_NAME_GAP_EM : 0) + text / MEASURE_FONT_PX;
    const room = Math.max(1, available * WIDTH_FILL - CARD_BORDER_PX);
    const byWidth = emWidth > 0 ? room / emWidth : Infinity;
    const byHeight = height > 0 ? (rowHeight * HEIGHT_FILL * MEASURE_FONT_PX) / height : Infinity;
    card.root.style.fontSize = `${Math.max(1, Math.floor(Math.min(byWidth, byHeight)))}px`;
  });
}

interface NameDisplayProps {
  ref: Ref<NameDisplayHandle>;
  dimmed: boolean;
  placeholder: string;
}

/**
 * Up to MAX_NAMES_ON_SCREEN matched players, newest on top and largest, each
 * shown as their card. The newest is the whole card; the ones behind it are
 * compact, which is what keeps them readable at a quarter of the stage. React renders only empty cards: a match is written into
 * them imperatively from the socket handler, so it reaches the DOM without
 * waiting for a React render. Cards stay up until pushed off by newer matches.
 * No timer clears them.
 */
export function NameDisplay({ ref, dimmed, placeholder }: NameDisplayProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const placeholderRef = useRef<HTMLParagraphElement>(null);
  // Resolved once from the rendered markup, so the hot path never queries the DOM.
  const cardsRef = useRef<CardFields[] | null>(null);

  const cards = (): CardFields[] | null => {
    const list = listRef.current;
    if (!list) return null;
    cardsRef.current ??= Array.from(list.children).map((row, slot) =>
      // Compactness is fixed per slot for the card's whole life, so it is
      // resolved here rather than read back off the DOM in the hot path.
      cardFields(row.firstElementChild as HTMLElement, isCompactSlot(slot)),
    );
    return cardsRef.current;
  };

  useImperativeHandle(
    ref,
    () => ({
      show(players, colors, tonight) {
        const stage = stageRef.current;
        const placeholderEl = placeholderRef.current;
        const fields = cards();
        if (!stage || !placeholderEl || !fields) return;

        fields.forEach((card, slot) => {
          const player = players[slot];
          writeCard(
            card,
            player,
            player && colors ? colors[player.side] : null,
            player && tonight ? tonight.get(player) : undefined,
          );
          // Fixed per slot, so this only ever writes on the first show. Setting
          // an attribute that already holds the value would still be cheap, but
          // the check keeps the card's own markup the one place it is decided.
          const compact = isCompactSlot(slot) ? "true" : "false";
          if (card.root.getAttribute(COMPACT_ATTRIBUTE) !== compact) {
            card.root.setAttribute(COMPACT_ATTRIBUTE, compact);
          }
          const row = rowOf(card);
          // The row carries the height share, so it hides with its card.
          row.hidden = player === undefined;
          if (player) {
            card.root.style.width = `${CARD_WIDTH_SHARE * 100}%`;
            // Away to the left, home to the right, matching the halves of the
            // screen behind them and the order of the boxes on the game menu.
            row.style.justifyContent = player.side === "A" ? "flex-start" : "flex-end";
          }
        });
        placeholderEl.hidden = players.length > 0;
        fitCards(stage, fields);
      },
    }),
    [],
  );

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new ResizeObserver(() => {
      const fields = cards();
      if (fields) fitCards(stage, fields);
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={stageRef} className={`relative h-full w-full overflow-hidden ${dimmed ? "opacity-30" : ""}`}>
      <div ref={listRef} className="flex h-full flex-col gap-2 py-2" data-testid="spotted-names">
        {SLOTS.map((slot) => (
          <div
            key={slot}
            hidden
            className="flex min-h-0 items-center justify-center"
            style={{ flex: `${slot === 0 ? NEWEST_WEIGHT : 1} 1 0` }}
          >
            {/* The digit that takes this card down, so the keys are learnable
                from the screen. Slots count from the top, keys from 1. */}
            <PlayerCard hint={slot + 1} />
          </div>
        ))}
      </div>
      <p
        ref={placeholderRef}
        className="absolute inset-0 flex items-center justify-center px-6 text-center text-2xl text-neutral-400"
      >
        {placeholder}
      </p>
    </div>
  );
}
