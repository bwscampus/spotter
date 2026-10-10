# The spotting card

The card and the live stage as built on `testrun` from Jed's card research brief (Oct 3), then made horizontal, with tonight back and more on the older two cards (Oct 4), then given two stat columns and a storyline under the name (Oct 7). The card is read in a 300 to 800 ms glance from 2 to 3 feet away, often off to the side, mid-sentence: what the announcer has to say as the biggest text, and the jersey number as the first thing the eye lands on.

Code: `components/PlayerCard.tsx` (markup and the writers), `components/NameDisplay.tsx` (the stage), `lib/cards/cardFace.ts` (the strings), `lib/cards/bigLine.ts` (geometry, in its TUNING block, and the big-line fit), `lib/cards/lines.ts` (stat lines), `lib/game/colors.ts` (slab colour, ink, hatching, school codes).

## Rules that hold everywhere

| Rule | How |
|---|---|
| No animation, transition or motion | Cards are written into place; nothing animates. The row of older cards is a fixed box, so the hero never moves when it fills. |
| A card never changes size once up | Every card is a fixed 32em by 6.4em of its own size. Stats update in place inside fixed sections. |
| Every size is em of one base size | The base size F is set on the stage. No px inside the cards. |
| Smallest text is 0.4em of F | A half-size card draws its labels and school code at 0.82em of itself, which is 0.41em of F. |
| Which cards go up, when, and in what order is unchanged | The engine and keys are untouched; `npm run check:cards` passes on real logs. |

## The stage

| Element | Spec |
|---|---|
| Background | #6B6B6B, with the diagonal back (Jed, Oct 5): away's colour on the left, home's on the right, each its own colour darkened by `STAGE_DARKEN` (35%) rather than mixed with grey, divided by V2's leaning line made a hard edge with a thin white line down it, so the two sides read as two colours and not a blur (`splitBackground` in `lib/game/colors.ts`). A side with no colour stays grey, and a game with neither is plain grey. |
| Font | Atkinson Hyperlegible Next, weights 500, 700, 800, through `next/font/google` (self-hosted, nothing fetched at game time). Fallback "Fira Sans", system-ui, sans-serif. Stage only. `font-variant-numeric: tabular-nums lining-nums`. Line height 1 unless stated. |
| Base size F | `floor(min(stage width / 36, stage height / 11.075))` px (33em for the cards plus `STAGE_ANCHOR_ROOM_EM`, 3em, to move across), set as the stage's font size, recomputed only when the stage box changes size (its ResizeObserver). Never depends on what a card says. |
| Slot 0, the hero | The card at F: 32em by 6.4em in the space above the older two, 0.5em from the stage's edges, against the left edge for an away player and the right edge for a home player (Jed, Oct 5). The hero and the two cards under it move together, and only when the newest card changes side. |
| Slots 1 and 2 | The same card at `SMALL_SCALE` (0.496), side by side under the hero, newest first from the left, 0.25em apart, together exactly as wide as the hero, 0.5em under it. |
| Players on screen | Up to `MAX_NAMES_ON_SCREEN` (3). X and 1 take down the hero; 2 and 3 take down the left and right half-size card. |

## The card

The same markup for all three, white #FFFFFF, text #111111, no borders. Left to right: the slab, the name, the stats column.

| Part | Spec |
|---|---|
| Slab | 5.8em wide, full height, background the team's colour. |
| Jersey number | 4em, weight 800, centred. Three or more characters: 2.9em. No jersey: "–". |
| Position | Under the number, 0.9em, weight 700, as saved ("RB"). None: empty, slab the same size. |
| Slab ink | #111111 or #FFFFFF by the ink rule below. |
| Away marker | 45 degree hatching over the slab at 12% of the ink colour, and the school code (0.45em on the hero, 0.82em on a half-size card), weight 700, letter spacing 0.04em, under the position. |
| Name | Padding 0 0.6em, centred vertically, 0.2em between lines. Column 13.5em. |
| Big line | 1.8em, line height 1.05, letter spacing 0.01em. With a respelling: the respelling, weight 500, the stressed syllable in caps at weight 800 and letter spacing 0.03em. Without: the surname, weight 700. |
| Storyline (Oct 7) | Under the small line: the player's storyline from the team page (`roster_players.storyline`, at most 80 characters), weight 500, #333333, line height 1.15, 0.68em on the hero and 0.82em on a half-size card, two lines at most and cut with an ellipsis (a CSS line clamp: no layout read). None: hidden, taking no room. |
| Small line | 1em, line height 1.2, letter spacing 0.01em. With a respelling: first name weight 500, a space, surname weight 700 ("Dario Quellenbach"). Without: the first name, weight 500. No first name: the surname with a respelling, nothing without. |
| Stats column | 11.5em wide. Each section is a fixed box padded 0.12em 0.5em: a label (0.5em on the hero, 0.82em on a half-size card, weight 700, letter spacing 0.08em, #555555, line height 1.2) 0.1em over a grid of rows. Without live stats SEASON is the whole 6.4em; with them SEASON is 3.712em and TONIGHT 2.688em (`TONIGHT_SHARE`, 0.42). |
| Rows (Jed, Oct 8: "No stats should get cut off! ... Rows should be organized!") | Every stat the line has, none hidden and none clipped (`lib/cards/statLayout.ts`). Each group (passing, rushing, defense, ...) starts at the top of its own column, the biggest group first, and runs down it in spoken order; a group longer than the rows continues in the next column. The row count and the text size are chosen together for each player and section: every row count is tried, the text as big as lets every column fit the box's width and every row its height, never past 0.85em of the hero (0.9em of a half-size card), and the most rows whose size is within `KEEP_ROWS_SHARE` (0.9) of the biggest wins, so a group stays in one column unless splitting it buys real size. Widths are the stage font's own advance widths (measured in Chrome, the wider of weights 500 and 700, 6% margin), so nothing reads layout. Rows are line height 1.1 of the stat size; columns 0.5 of it apart. Unused slots (40 a section) are hidden. Checked in Chrome on Oct 8 at base sizes 16 to 56px: no row of any test player, a player with every football stat included, past its section. |
| SEASON | The top section, on white: the season line, with tonight added during a game. |
| TONIGHT | The bottom section, on #F0F0F0, drawn on every card of a game with live stats, empty until the player does something tonight: its rows are tonight's, by the same rules. A game without live stats has no TONIGHT section, and SEASON takes the column. |

## Text rules

All worked out when the game is built or the rosters are refreshed (`cardFace`, `assembleGame`), never inside `writeCard`, and stored on the watchlist player as `face`.

| Rule | Spec |
|---|---|
| Respelling | The player's first pronunciation note, if it is 24 characters or fewer and only letters, hyphens, spaces and apostrophes. Split once: before, stressed (the first run of two or more capitals), after; before and after lowercased. No capital run: the whole note is before. A note that fails is not shown and the player has no respelling. "kwell-en-BAHK" is "kwell-en-", "BAHK", "". |
| Title case | A name saved ALL CAPS is converted, capitalising the first letter after a space, hyphen or apostrophe. Anything else is left as saved. Never forced into capitals. |
| Big-line fit | Too wide for the 13.5em column at 1.8em: break once at a hyphen (kept on the first line) or a space. Still too wide: 1.55em, then 1.3em. In em of the card, so a half-size card fits the same way. Never smaller, never an ellipsis. Measured with canvas `measureText` against the loaded font, once per player, off the hot path, and kept in a map keyed by the player object that `show()` reads. |

## Stat lines

| Rule | Spec |
|---|---|
| Shape | `lib/cards/lines.ts` returns items `{ value, label, estimated, group }`: every group the player has, `group` 0 the biggest, each in spoken order. The card renders 40 slots a section and `writeCard` places each item by `layoutStats` (column and row set on its slot, the size on the grid). Lines saved Oct 5 to 8 also carry a `rank`, which nothing reads now; one saved before groups is one group. |
| Style | Values weight 700; labels weight 500 at 0.85 of the row's size; one item a row. Outside the card (the review table, the saved text) a line is written with " · " between items. |
| Wording | The way it is said: "420 yds · 5 TD", "22 rec · 310 yds", "88-140 · 9 TD", "41 tkl · 3 sk", "7-9 FG · long 42". Lowercase labels except TD, INT, FG, PBU. Thousands get a comma. Anything zero is left out. |
| Length | Every item, however many or however long (Oct 8: before, five a group and none past 10 characters). The card makes the text smaller to fit; a two-way player with four groups is still at least half the usual size on the hero. |
| Order | Each group in the order it is said: rushing car, yds, TD; receiving rec, yds, TD; passing completions-attempts, yds, TD, INT; defense tkl, sk, INT, PBU, ff, fr, TD; kicking FG, long, xp, punts, yds; returns kr, yds, pr, yds, TD. The first item of each names its group ("64 car", "45 tkl", "7-9 FG", "22 rec"), so its yards are never read as another group's. |
| Which groups | All of them, the one the player did the most of first (Oct 8; Oct 7 to 8 it was the two biggest, and before that only the biggest). |
| No words in the line | The card labels its SEASON and TONIGHT sections (Oct 4), so the lines themselves carry no such word. |
| Estimates | Marked "~" before the value, in the same black as everything else (Jed, Oct 3: not greyed), on both lines: yards worked out from yard lines or phrasing, and every stat from a play Claude rated as unsure. *Jed kept the ~ and asked for it black (Oct 3); the brief had "est" after the label, greyed, on tonight only. `ESTIMATE_MARK` in `lib/cards/lines.ts` is the one place to change it.* |
| Other sports | Every saved stat line (up to three), each its own group, split into items where it lists things (a comma followed by a space, " · ", ";" or "|"; "1,204" stays whole), and a phrase longer than 16 characters (`WRITTEN_ROW_CHARS`) broken at its spaces into rows. Laid out like football's, at weight 700. |
| Live stats | Never put up, take down, move or resize a card. A card already up, the hero or a half-size one, is rewritten by `writeStatLines`, the same exported function `writeCard` uses. |
| Gone from the card | The " · " between items (Oct 5: a row each), the third stat line, the "as of" date, the 5 second delta chip, vitals (grade, height, weight). The stats strip's text is unchanged. |

## Team colour and the away marker

| Rule | Spec |
|---|---|
| Where it is stored | `rosters.primary_color`, nullable, lowercase `#rrggbb` with a check constraint (migration `20261003205012_v3_roster_color.sql`, Oct 3). No new migration for this card. |
| Slab ink | WCAG relative luminance L of the team colour: L > 0.179 uses #111111, otherwise #FFFFFF (`slabInk`). Gold #FFB612 gets #111111; navy #0B2545 gets #FFFFFF. |
| No colour set | Home slab #111111 with white ink; away slab #E6E6E6 with #111111 ink. |
| Away is never colour alone | Away always has the hatching and the school code. |
| School code | Initials of up to three words, uppercase, skipping "High", "School", "HS", "of" and "the" ("Castellan Prep" is CP). One word: its first three letters ("Estancia" is EST). Both teams the same: the first three letters of each school's first word. |

## Also removed

The card's black borders, the uppercase surname, the corner key-hint digits, the compact-card CSS, `fitCards` and its per-card text measuring, and `readableInk` with the red fallback for the number. On Oct 4, the Oct 3 chips (number, surname and one stat, with a first name for a shared surname): the older two are the whole card at half size.

## Hot path

| Rule | How it is held |
|---|---|
| `writeCard` is text, hidden flags and a few style writes on elements that already exist | No element created, no layout read, no await, no storage. `test/cardPathIsolation.test.ts` reads its source and `show`'s and `restat`'s. |
| `NameDisplay.show()` stays synchronous and renders empty cards once | All three cards are rendered up front and filled imperatively. |
| The function that handles Deepgram results | Unchanged. |
| The card path never imports `lib/livestats/` | `test/cardPathIsolation.test.ts`, extended to the new card files. |
