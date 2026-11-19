import type { SampleCard } from "@/lib/demo/sample";
import { itemText } from "@/lib/cards/lines";
import { teamChipColors } from "@/components/ui/TeamChip";

// =============================================================================
// A small, still picture of a player card (the Broadcast look, Nov 19), for
// the dashboard's empty states and the landing page: "this is what your
// screen shows". Built from the card's own `face` (toCardPlayer), drawn with
// plain React. Never the live card: it imports nothing from PlayerCard or
// NameDisplay, and the stage's rules (fixed slots, direct writes) do not apply.
// =============================================================================

/** At most this many stats, in the card's own order: enough to read as a card. */
export const MINI_STATS = 6;

export function MiniCard({ card, className = "" }: { card: SampleCard; className?: string }) {
  const face = card.player.face;
  if (!face) return null;
  const slab = teamChipColors(card.color);
  const respelled = face.stressed.length > 0;
  const fact = face.facts?.[0] ?? "";
  const stats = face.season.slice(0, MINI_STATS);
  return (
    <figure
      aria-label={`A player card: ${[card.player.first_name, card.player.last_name].filter(Boolean).join(" ")}, number ${face.jersey}`}
      className={`flex min-w-0 overflow-hidden rounded-[6px] border border-line bg-surface shadow-panel ${className}`.trim()}
    >
      <div className="flex w-[84px] shrink-0 flex-col items-center justify-center py-2" style={slab}>
        <span className="font-num text-[38px] font-bold leading-none">{face.jersey}</span>
        <span className="mt-1 text-[13px] font-semibold">{face.position}</span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center px-3 py-2">
        <span className="truncate text-[24px] leading-tight text-ink">
          {respelled ? (
            <>
              {face.before}
              <b className="font-bold uppercase">{face.stressed}</b>
              {face.after}
            </>
          ) : (
            <b className="font-bold">{face.plain}</b>
          )}
        </span>
        <span className="truncate text-[15px] text-ink-2">
          {face.smallFirst}
          {face.smallLast && <b className="font-semibold">{face.smallLast}</b>}
        </span>
        {fact && <span className="truncate text-[13px] text-muted">{fact}</span>}
      </div>
      {stats.length > 0 && (
        <div className="hidden w-[210px] shrink-0 flex-col justify-center border-l border-line px-3 py-2 sm:flex">
          <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">Season</span>
          <ul className="mt-0.5 grid grid-cols-2 gap-x-3 font-num text-[13px] leading-snug text-ink">
            {stats.map((item, index) => (
              <li key={index} className="whitespace-nowrap">
                {itemText(item)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </figure>
  );
}
