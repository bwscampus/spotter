"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { PlayerCard, cardFields, writeCard } from "@/components/PlayerCard";
import { measureBigLines } from "@/components/measureBigLine";
import { stageFont } from "@/components/stageFont";
import { track } from "@/lib/analytics/track";
import { SMALL_SCALE, STAGE_ANCHOR_ROOM_EM, STAGE_WIDTH_EM, type BigLineFit } from "@/lib/cards/bigLine";
import { sideLook, schoolCode } from "@/lib/game/colors";
import type { SpotMode } from "@/lib/rosters/types";
import type { WatchlistPlayer } from "@/lib/watchlist";

// =============================================================================
// TUNING: how big a previewed card is drawn.
// =============================================================================

/** The largest base size a preview gets. Big enough to judge, small enough to scroll a roster. */
const MAX_PREVIEW_FONT_PX = 30;

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
 * Every player's card, drawn by the live screen's own PlayerCard, writeCard
 * and big-line fit, on the stage's grey, with the TONIGHT section a stats
 * game has. The toggles show the half-size card the two older players on
 * screen use, and the card as the away team, hatched and carrying the school
 * code. Like the live screen, a home card sits against the right edge and an
 * away card against the left.
 */
export function CardsPreview({
  cards,
  color = null,
  school = "",
}: {
  cards: PreviewCard[];
  color?: string | null;
  school?: string;
}) {
  const [small, setSmall] = useState(false);
  const [away, setAway] = useState(false);
  const [fits, setFits] = useState<ReadonlyMap<WatchlistPlayer, BigLineFit> | null>(null);
  const counted = useRef(false);

  useEffect(() => {
    // Once per visit, even under Strict Mode's double effect.
    if (counted.current) return;
    counted.current = true;
    track("prep.cards_previewed", { players: cards.length });
  }, [cards.length]);

  // The big lines, fitted against the loaded font exactly as the live screen fits them.
  useEffect(() => {
    let current = true;
    void measureBigLines(cards.map(({ card }) => card)).then((measured) => {
      if (current && measured) setFits(measured);
    });
    return () => {
      current = false;
    };
  }, [cards]);

  const look = useMemo(() => sideLook(color, away ? "A" : "H", schoolCode(school)), [color, away, school]);

  if (cards.length === 0) {
    return <p className="text-sm text-neutral-600">No players on this team yet. Import or type the roster first.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-neutral-700">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={small} onChange={(event) => setSmall(event.target.checked)} />
          Show the half-size card the two older players on screen use
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={away} onChange={(event) => setAway(event.target.checked)} />
          Show as the away team
        </label>
      </div>
      <ol className="flex flex-col gap-5">
        {cards.map(({ card, spotMode }, index) => (
          <li key={`${card.jersey ?? "none"}-${card.last_name}-${index}`}>
            <PreviewSlot player={card} small={small} away={away} look={look} fit={fits?.get(card)} />
            {SPOT_NOTES[spotMode] && <p className="mt-1 text-xs font-semibold text-neutral-500">{SPOT_NOTES[spotMode]}</p>}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** One card on its own patch of stage, written exactly as a spot on the live screen writes it. */
function PreviewSlot({
  player,
  small,
  away,
  look,
  fit,
}: {
  player: WatchlistPlayer;
  small: boolean;
  away: boolean;
  look: ReturnType<typeof sideLook>;
  fit: BigLineFit | undefined;
}) {
  const slot = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const stage = slot.current;
    const root = stage?.querySelector<HTMLElement>('[data-card="card"]');
    if (!stage || !root) return;
    // The live screen's base size, from this patch's width alone, with the same room to sit against a side.
    const across = STAGE_WIDTH_EM + STAGE_ANCHOR_ROOM_EM;
    stage.style.fontSize = `${Math.max(8, Math.min(MAX_PREVIEW_FONT_PX, Math.floor(stage.clientWidth / across)))}px`;
    writeCard(cardFields(root), player, look, undefined, fit);
  }, [player, small, look, fit]);

  return (
    <div
      ref={slot}
      className={`flex w-full bg-[#6B6B6B] ${away ? "justify-start" : "justify-end"} ${stageFont.className}`}
      style={{ padding: "0.5em", fontVariantNumeric: "tabular-nums lining-nums", lineHeight: 1 }}
    >
      <div style={{ fontSize: small ? `${SMALL_SCALE}em` : "1em" }}>
        <PlayerCard key={small ? "small" : "hero"} small={small} />
      </div>
    </div>
  );
}
