"use client";

import { useImperativeHandle, useEffect, useRef, type Ref } from "react";
import { PlayerCard, cardFields, writeBigLine, writeCard, writeStatLines, type CardFields } from "@/components/PlayerCard";
import { measureBigLines } from "@/components/measureBigLine";
import { stageFont } from "@/components/stageFont";
import {
  baseFontPx,
  HERO_HEIGHT_EM,
  HERO_WIDTH_EM,
  SMALL_GAP_EM,
  SMALL_SCALE,
  STAGE_GAP_EM,
  STAGE_MARGIN_EM,
  type BigLineFit,
} from "@/lib/cards/bigLine";
import type { CardLines } from "@/lib/cards/lines";
import type { SideLook } from "@/lib/game/colors";
import { MAX_NAMES_ON_SCREEN } from "@/lib/matching/SpotterEngine";
import type { WatchlistPlayer } from "@/lib/watchlist";

// =============================================================================
// The stage (docs/CARD_SPEC.md): one grey box, the newest player's card wide
// across it, and the two before as the same card at half size, side by side
// under it, newest first from the left (Jed, Oct 4: "much more horizontal",
// and the 2nd and 3rd cards showing more).
//
// Everything on it is in em of one base size, set on the stage from its own
// box and from nothing a card says, so the cards scale together and never
// resize to fit their text. The base size is recomputed only when the stage
// itself changes size.
// =============================================================================

/** How each side's slabs look, settled when the game opened. */
export type SideLooks = Record<"H" | "A", SideLook>;

/**
 * What each player's card says with tonight in it (the season with tonight
 * added, and tonight's line), by player object rather than by key.
 *
 * Identity, not a string: the WatchlistPlayer objects in the jersey index are
 * the same objects for the whole game, so this is exactly as positional as the
 * slot key would be, and neither show nor writeCard has to learn what a slot
 * key is. Anything that ever spreads a player between the index and here makes
 * the lookup miss silently, which is what the test pinning it by reference is
 * for. A player missing from the map shows what the card was built with.
 */
export type CardStatLines = ReadonlyMap<WatchlistPlayer, CardLines>;

export interface NameDisplayHandle {
  /** Writes players (newest first) straight into the DOM, synchronously. Empty shows the placeholder. */
  show(players: WatchlistPlayer[], looks?: SideLooks, lines?: CardStatLines): void;
  /**
   * Live stats changed: rewrites the stat lines of the cards already up.
   * Never adds, removes, reorders or resizes a card (docs/V3_DEFINITION.md
   * G3): no card is shown or hidden, and the lines are fixed sections. After
   * paint only, never from the hot path.
   */
  restat(lines: CardStatLines): void;
  /**
   * The players this game can put up: their big lines are measured against the
   * card's font once it loads, and kept for show() to read. Off the hot path.
   */
  prepare(players: readonly WatchlistPlayer[]): void;
}

/** The older cards: every slot but the newest. */
const SMALL_SLOTS = Array.from({ length: MAX_NAMES_ON_SCREEN - 1 }, (_, slot) => slot);

const NO_FITS: ReadonlyMap<WatchlistPlayer, BigLineFit> = new Map();

interface NameDisplayProps {
  ref: Ref<NameDisplayHandle>;
  dimmed: boolean;
  placeholder: string;
  /** A game with live stats on: every card has a TONIGHT section. Fixed for the game. */
  tonight: boolean;
  /** The diagonal behind the cards from the two team colours (splitBackground), or null for plain grey. */
  background?: string | null;
}

/**
 * Up to MAX_NAMES_ON_SCREEN matched players. React renders only the empty
 * cards: a match is written into them imperatively from the socket handler,
 * so it reaches the DOM without waiting for a React render. Cards stay up
 * until pushed off by newer matches. No timer clears them.
 */
export function NameDisplay({ ref, dimmed, placeholder, tonight, background = null }: NameDisplayProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const placeholderRef = useRef<HTMLParagraphElement>(null);
  // Resolved once from the rendered markup, so the hot path never queries the DOM.
  // Newest first: the hero, then the older cards from the left.
  const cardsRef = useRef<CardFields[] | null>(null);
  // Who is up now, newest first, so restat and a late fit know whose card it is.
  const shownRef = useRef<WatchlistPlayer[]>([]);
  // Each player's big line, fitted once the font loaded. Read, never computed, by show().
  const fitsRef = useRef<ReadonlyMap<WatchlistPlayer, BigLineFit>>(NO_FITS);
  const prepareRef = useRef(0);
  const columnRef = useRef<HTMLDivElement>(null);
  // Which side the cards were last put against, so a write happens only on a change.
  const anchoredRef = useRef<"H" | "A" | null>(null);

  const cards = (): CardFields[] | null => {
    const hero = heroRef.current?.firstElementChild as HTMLElement | null | undefined;
    const row = rowRef.current;
    if (!hero || !row) return null;
    cardsRef.current ??= [
      cardFields(hero),
      ...Array.from(row.children).map((slot) => cardFields(slot.firstElementChild as HTMLElement)),
    ];
    return cardsRef.current;
  };

  useImperativeHandle(
    ref,
    () => ({
      show(players, looks, lines) {
        const placeholderEl = placeholderRef.current;
        const fields = cards();
        if (!placeholderEl || !fields) return;
        shownRef.current = players;

        fields.forEach((card, slot) => {
          const player = players[slot];
          writeCard(
            card,
            player,
            player && looks ? looks[player.side] : null,
            player && lines ? lines.get(player) : undefined,
            player ? fitsRef.current.get(player) : undefined,
          );
        });
        placeholderEl.hidden = players.length > 0;

        // Away cards against the left edge, home against the right (Jed, Oct 5):
        // the whole column, hero and the two under it, follows the newest card's side.
        const newest = players[0];
        const column = columnRef.current;
        const hero = heroRef.current;
        if (newest && column && hero && anchoredRef.current !== newest.side) {
          anchoredRef.current = newest.side;
          column.style.alignItems = newest.side === "A" ? "flex-start" : "flex-end";
          hero.style.justifyContent = newest.side === "A" ? "flex-start" : "flex-end";
        }
      },

      restat(lines) {
        const fields = cards();
        if (!fields) return;
        fields.forEach((card, slot) => {
          const player = shownRef.current[slot];
          if (!player) return;
          const entry = lines.get(player);
          if (entry) writeStatLines(card, entry.season, "", entry.tonight);
          else writeStatLines(card, player.face?.season ?? [], player.face?.seasonText ?? player.stat_lines.join("\n"), []);
        });
      },

      prepare(players) {
        const run = ++prepareRef.current;
        void measureBigLines(players).then((fits) => {
          // A newer game, or a refresh, asked since: its own measure wins.
          if (!fits || run !== prepareRef.current) return;
          fitsRef.current = fits;
          // Cards already up get their fitted line: text and one size, and a card's size is fixed.
          const fields = cards();
          if (!fields) return;
          fields.forEach((card, slot) => {
            const player = shownRef.current[slot];
            if (player) writeBigLine(card, player, fits.get(player));
          });
        });
      },
    }),
    [],
  );

  // The base size: the largest that fits STAGE_WIDTH_EM (and room to anchor) across and
  // STAGE_HEIGHT_EM down. Only when the stage's own box changes, and never
  // from what a card says. Read from the observer's entry, not from layout.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[entries.length - 1]?.contentRect;
      if (box) stage.style.fontSize = `${baseFontPx(box.width, box.height)}px`;
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={stageRef}
      className={`relative h-full w-full overflow-hidden bg-[#6B6B6B] ${stageFont.className}`}
      style={{ fontVariantNumeric: "tabular-nums lining-nums", lineHeight: 1, ...(background ? { backgroundImage: background } : {}) }}
    >
      <div
        ref={columnRef}
        className={`absolute inset-0 flex flex-col items-center ${dimmed ? "opacity-30" : ""}`}
        style={{ padding: `${STAGE_MARGIN_EM}em`, gap: `${STAGE_GAP_EM}em` }}
        data-testid="spotted-names"
      >
        {/* The newest player, centred in the space above the older two. */}
        <div ref={heroRef} className="flex min-h-0 w-full flex-1 items-center justify-center">
          <PlayerCard tonight={tonight} />
        </div>
        {/* The two before, newest first from the left: the same card at SMALL_SCALE.
            A fixed box, empty or not, so the hero never moves when they go up. */}
        <div
          ref={rowRef}
          className="flex flex-none"
          style={{ width: `${HERO_WIDTH_EM}em`, height: `${HERO_HEIGHT_EM * SMALL_SCALE}em`, gap: `${SMALL_GAP_EM}em` }}
        >
          {SMALL_SLOTS.map((slot) => (
            <div key={slot} className="flex-none" style={{ fontSize: `${SMALL_SCALE}em` }}>
              <PlayerCard small tonight={tonight} />
            </div>
          ))}
        </div>
      </div>
      <p
        ref={placeholderRef}
        className="absolute inset-0 flex items-center justify-center px-6 text-center font-sans text-2xl text-neutral-200"
      >
        {placeholder}
      </p>
    </div>
  );
}
