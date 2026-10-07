"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  CARD_BORDER_PX,
  CARD_EM_CHROME,
  COMPACT_ATTRIBUTE,
  EXTRA_NAME_GAP_EM,
  PlayerCard,
  cardFields,
  writeCard,
} from "@/components/PlayerCard";
import { track } from "@/lib/analytics/track";
import type { SpotMode } from "@/lib/rosters/types";
import type { WatchlistPlayer } from "@/lib/watchlist";

// =============================================================================
// TUNING: how big a previewed card is drawn.
// =============================================================================

/** The largest a previewed card gets. Big enough to judge, small enough to scroll a roster. */
const MAX_PREVIEW_FONT_PX = 44;

/** Measured at this size, the same way the live screen's fit does. */
const MEASURE_FONT_PX = 100;

// =============================================================================

export interface PreviewCard {
  card: WatchlistPlayer;
  spotMode: SpotMode;
}

const SPOT_NOTES: Partial<Record<SpotMode, string>> = {
  off: "Spotting off: this card never goes on screen. The player can still be credited with stats.",
  exact_only: "Exact only: only the surname said cleanly puts this card up.",
};

/**
 * Every player's card, drawn by the live screen's own PlayerCard and writeCard.
 * The toggle shows the compact version the two older cards on screen use.
 */
export function CardsPreview({ cards }: { cards: PreviewCard[] }) {
  const [compact, setCompact] = useState(false);
  const counted = useRef(false);

  useEffect(() => {
    // Once per visit, even under Strict Mode's double effect.
    if (counted.current) return;
    counted.current = true;
    track("prep.cards_previewed", { players: cards.length });
  }, [cards.length]);

  if (cards.length === 0) {
    return <p className="text-sm text-neutral-600">No players on this team yet. Import or type the roster first.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <label className="flex items-center gap-2 text-sm text-neutral-700">
        <input type="checkbox" checked={compact} onChange={(event) => setCompact(event.target.checked)} />
        Show the compact card the older cards on screen use
      </label>
      <ol className="flex flex-col gap-5">
        {cards.map(({ card, spotMode }, index) => (
          <li key={`${card.jersey ?? "none"}-${card.last_name}-${index}`}>
            <PreviewSlot player={card} compact={compact} />
            {SPOT_NOTES[spotMode] && <p className="mt-1 text-xs font-semibold text-neutral-500">{SPOT_NOTES[spotMode]}</p>}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** One card, written into the DOM exactly as a spot on the live screen writes it, then sized to fit. */
function PreviewSlot({ player, compact }: { player: WatchlistPlayer; compact: boolean }) {
  const slot = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const root = slot.current?.firstElementChild as HTMLElement | null;
    if (!root) return;
    root.setAttribute(COMPACT_ATTRIBUTE, String(compact));
    const fields = cardFields(root, compact);
    writeCard(fields, player);

    // The live screen's width fit, without its height share: measure the text
    // at a known size, then divide the room by the card's width in em.
    root.style.fontSize = `${MEASURE_FONT_PX}px`;
    const spelled = fields.spelled.getBoundingClientRect().width;
    const text =
      fields.first.getBoundingClientRect().width +
      fields.last.getBoundingClientRect().width +
      spelled +
      fields.vitals.getBoundingClientRect().width;
    // Measured rather than read off `hidden`: a compact card hides it in CSS.
    const emWidth = CARD_EM_CHROME + (spelled > 0 ? EXTRA_NAME_GAP_EM : 0) + text / MEASURE_FONT_PX;
    const room = (slot.current?.clientWidth ?? 0) - CARD_BORDER_PX;
    const size = Math.min(MAX_PREVIEW_FONT_PX, Math.floor(room / emWidth));
    root.style.fontSize = `${Math.max(10, size)}px`;
  }, [player, compact]);

  return (
    <div ref={slot} className="w-full">
      <PlayerCard />
    </div>
  );
}
