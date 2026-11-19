import { normalizeHex, schoolCode, slabInk } from "@/lib/game/colors";

// =============================================================================
// A team's chip (the Broadcast look, Nov 19): its school code on its own
// colour, by the card's own rules (schoolCode, slabInk), so a team looks the
// same in every list as it does on the stage. A team with no colour gets the
// neutral ink. Decoration beside the school's name, never in place of it.
// =============================================================================

/** The slab colour for a team with none saved. */
export const NO_TEAM_COLOR = "#3d444c";

export function teamChipColors(color: string | null | undefined): {
  background: string;
  color: string;
} {
  const background = normalizeHex(color) ?? NO_TEAM_COLOR;
  return { background, color: slabInk(background) };
}

export function TeamChip({
  school,
  color,
  size = "md",
  className = "",
}: {
  school: string;
  color?: string | null;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const box =
    size === "lg" ? "h-10 min-w-12 px-2 text-[15px]" : size === "sm" ? "h-[22px] min-w-8 px-1 text-[11px]" : "h-7 min-w-10 px-1.5 text-[13px]";
  return (
    <span
      aria-hidden
      data-team-chip
      className={`inline-flex shrink-0 items-center justify-center rounded-[4px] font-num font-bold tracking-[0.04em] ${box} ${className}`.trim()}
      style={teamChipColors(color)}
    >
      {schoolCode(school)}
    </span>
  );
}

/** "AWY at HOM" as two chips, for a game's row. Null schools draw nothing on that side. */
export function MatchupChips({
  away,
  home,
  size = "md",
}: {
  away: { school: string | null; color?: string | null };
  home: { school: string | null; color?: string | null };
  size?: "sm" | "md" | "lg";
}) {
  if (!away.school && !home.school) return null;
  return (
    <span aria-hidden className="inline-flex shrink-0 items-center gap-1.5">
      {away.school && <TeamChip school={away.school} color={away.color} size={size} />}
      {away.school && home.school && <span className="text-[13px] font-medium text-muted">at</span>}
      {home.school && <TeamChip school={home.school} color={home.color} size={size} />}
    </span>
  );
}
