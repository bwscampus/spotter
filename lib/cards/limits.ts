// =============================================================================
// TUNING: how much text a card's stat area holds. The card, the line builder,
// the stats prompts and the review screen all read these, so a line Claude
// writes, a line the announcer types and a line built from numbers all fit the
// same slots.
// =============================================================================

/** Lines per player. The card has room for about this many before it crowds the name. */
export const MAX_STAT_LINES = 3;

/** Longer than this stops being glanceable at speed, and the card's slot cuts it off. */
export const MAX_STAT_LINE_LENGTH = 80;
