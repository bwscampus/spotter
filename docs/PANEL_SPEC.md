# The team panel

A fixed column on the left of the live screen with each team's season schedule and tonight's leaders (Jed, Oct 28). It sits between the top control bar and the bottom transcript bar. The schedule comes from the Schedule import on the Team page (`docs/V3_DEFINITION.md` 6.7).

The cards do not change at all: the same markup, the same layout rules (`docs/CARD_SPEC.md`), the same hero and half-size slots, and the same keys. The only effect on them is that the stage is narrower, so its existing base-size formula, worked out from the stage's own box by its ResizeObserver, gives a slightly smaller base size.

Code:

- `components/panel/`: the panel, its font and its canvas measure.
- `lib/panel/`: the sizes, the fitting rules, the leaders, the half's words and the throttle. All pure and tested.
- `lib/schedule/`: the schedule itself: record, streak, next game, the import's rules.
- `components/live/StageRow.tsx` and `components/live/PanelSwitch.tsx`: the column and the switch on the live screen.

Every size below is a constant in the TUNING block of `lib/panel/layout.ts`, and the component writes them as inline styles.

## Rules that hold everywhere

| Rule | How |
|---|---|
| Not on the card path | `components/livestats/LiveGame.tsx`, where the live screen and live stats meet, builds the panel and hands it to `LiveScreen` as `panel`. `LiveScreen` never imports it; it only shows or hides it. `test/cardPathIsolation.test.ts` holds both directions: the card path never reaches `components/panel/`, and the panel never reaches the cards, the engine, the live screen, `lib/livestats/` or `components/livestats/`. |
| Nothing moves | Nothing in the panel scrolls, moves, resizes or animates during a game. Values change in place. |
| The halves never change size | Two rows of a grid, `minmax(0, 1fr)` each: away on top, home below, the sides the cards use. What is in a half never changes its box. |
| Names are never cut off | No ellipsis and no clipping on a player's name. It steps down to fit, then wraps. |
| The hot path is untouched | `NameDisplay`, `writeCard` and the Deepgram results handler do not change. The panel redraws after paint, at most once every 500ms. |

## Placement

| Element | Spec |
|---|---|
| Column | 360px wide (`PANEL_WIDTH_PX`), a 1px #D9DCE0 line on its right, full height between the top bar and the bottom bar. |
| Stage | Takes the rest of the width. Its ResizeObserver sets the base size as it always has. |
| Alert rows | The silence alarm and the warnings sit over the stage, not the panel, so an alarm never resizes the panel. |
| Panel switch | "Panel On/Off" in the top bar, left of Audio. It gives the keyboard back on a click. |
| P | Shows or hides the panel on every game, under the live keys' rules: one press however long it is held (`event.repeat`), its own 300ms debounce (`PANEL_KEY_DEBOUNCE_MS`), and nothing while typing in a text field (`isTextEntry`). It is `reduceLiveKey` in `lib/keys.ts`. |
| Remembered | Per announcer: localStorage `spotter.livePanel.<account id>` (`lib/game/panelSetting.ts`), on unless it says off. Signing out leaves it, like the device settings. |
| Hidden | The panel stays mounted with `hidden` and takes no room. The stage is full width exactly as before the panel existed. |

## A half

Padding 14px 16px. Three parts with 10px between them: the band, the schedule, the leaders.

### The band

| Part | Spec |
|---|---|
| Box | Full width, 60px tall, 0 12px padding, 12px between left and right. |
| Colour | The game's side look (`sideLooks` in `lib/game/colors.ts`): the team's colour, or the default slab colour when it has none. The ink is the slab ink rule (`slabInk`). The away band carries the away slab's hatching, as every away slab does. |
| Left | "AWAY" or "HOME" (11px, weight 700, letter spacing 0.08em, 85% opacity) over the school name (20px, weight 800). A school too wide for what the record leaves steps down 1px at a time to 12px, then wraps onto two lines. |
| Right | The overall record (28px, weight 800) over the league record ("2-1 league", 12px, weight 600). The league line shows only when a game is marked league. |

### The schedule

| Part | Spec |
|---|---|
| Label row | "SEASON" left, "newest first" right. Labels: 11px, weight 700, letter spacing 0.08em, #555555. The row is 18px. |
| Rows | The played games, newest first, one column. Each row is 21px with a 1px #EEF0F2 line on top. |
| Row grid | The row is a grid with 4px between columns: <ul><li>Date ("Oct 23"): 50px, 12px, muted #5B636C, tabular numbers.</li><li>W, L or T: 16px wide, 13px, weight 800. W is green #145A2B and L is red #B42318, so the letter carries the meaning and colour isn't needed. T is ink.</li><li>"vs" or "@": 24px, 12px, muted. Neutral shows "vs".</li><li>Opponent: the rest, 14px, weight 600.</li><li>Score, this team's first ("24-21"): 52px, 14px, weight 700, right-aligned, tabular numbers.</li></ul> |
| Opponent fit | An opponent too wide steps down 1px at a time to 10px. Only past that does it end in an ellipsis, with the whole name in its title. A 21px row cannot wrap. |
| Rows shown | The newest that fit. The count is worked out once, from the half's fixed height, when the panel's own box is laid out (`rowsThatFit`), never from what a row says. |
| Streak line | Under the rows, 4px gap, 18px line, 13px: the streak in bold, then " · Next: " muted, then the next game. With no next game, the streak only; with no game played, "Next: …" only. Too wide, it steps down to 10px, then ends in an ellipsis with all of it in its title. |
| No schedule | One muted line: "No schedule. Add one on the team page." |

What the words say (`lib/schedule/record.ts`):

- **Record:** W-L, or W-L-T only when there is a tie; "0-0" before a game.
- **League record:** the same, over league games only.
- **Streak:** "Won 3 straight", "Lost 1", "Tied 1".
- **Next game:** the earliest game with no score dated today or later, "Fri Nov 6 vs Coastline" or "Fri Nov 6 @ Coastline".

Every date is read from its "YYYY-MM-DD" string, so no time zone moves it: `dayLabel`, and the weekday from `Date.UTC`. "Today" is the announcer's own (`useToday`).

### The leaders

| Part | Spec |
|---|---|
| Label | "TONIGHT" on a game with live stats; "SEASON LEADERS" with live stats off, when the boxes use the team's season stats instead. Same label style and 18px row. |
| Grid | 2×2, 12px between the columns and 4px between the rows: PASS and RUSH on the top row, REC and TKL on the bottom. |
| Box | 40px tall, a 1px #EEF0F2 line on top. A two-column grid: 58px, then the rest, 8px between them. |
| Left, right-aligned | The big number (26px, weight 800, tabular numbers) over its unit (10px, weight 700, letter spacing 0.06em, muted). <ul><li>PASS: pass yards over "YDS".</li><li>RUSH: rush yards over "YDS".</li><li>REC: receiving yards over "YDS".</li><li>TKL: tackles over "TKL".</li></ul>A number too wide for 58px (a season's "2,431") steps down to as small as 14px. |
| Right | The category and its supporting line. The category is weight 700 and the rest 600, at 11px: "PASS · 9-14", "RUSH · 14 car, 1 TD" (the TD only when there is one), "REC · 3 rec", and just "TKL". Under it is the player's last name, 15px, weight 700. |
| Category fit | The right column is 91px. A category line too wide steps down to 9px. Past that, it breaks once after its last comma onto two lines, at 10px or less, so two lines and the name still fit the 40px box. |
| Name fit | A last name too wide at 15px steps down 1px at a time to 10px. Below that it wraps at its hyphen if it has one ("Vanderkellen-" over "Ruiz"), else at a space, else between letters onto two lines. Never an ellipsis, never clipped. It is measured with canvas `measureText` in the panel's font once it has loaded, once per player when the game opens and again on Refresh rosters, the way `measureBigLines` measures the cards. |
| Who leads | The player on that team with the most of the big number. A tie goes to whoever reached it first: the line (seq) of the counted play or booth line that set their total, then roster order. |
| Estimates | A number with any estimated part has the cards' "~" in front (`ESTIMATE_MARK`), in the same black: one mark for a pair ("~9-14"). |
| No leader | Before anyone has a stat in a category: "–" as the number, the unit, the category alone, and no name. |
| Other sports | A sport without these categories (volleyball, and every sport but football) has no leaders, and the schedule takes the whole half. |

## Data

| What | Where it comes from |
|---|---|
| Schedules | Each side of the game snapshot carries `schedule` (`GameTeam.schedule` in `lib/game/snapshot.ts`), read with the rosters by `GET /api/rosters/game`. So it loads once when the game opens (Start) and again on Refresh rosters, and a reload mid-game needs no network. A schedule that does not read is dropped, never the game. The scrubbed shared log never carries it. |
| Rosters and season stats | The snapshot's `statsRoster`, both full rosters with their season numbers. |
| Tonight | `StatsController.tonightBoard()`: `talliesOf` and `reachedOf` (`lib/livestats/session.ts`), from the same session the cards' tonight lines come from. Change notices come through `bridge.subscribe`, the same ones the cards rebuild on. `LiveGame.tsx` hands them over as a `TonightSource` (`lib/panel/types.ts`). |
| Redraws | After paint (`afterPaint`), at most once every 500ms (`createThrottle`, `PANEL_THROTTLE_MS`): the first change at once, the rest folded into one more at the end of the window. |

## Font and colour

- **Font:** Atkinson Hyperlegible Next, the cards' family, from its own `next/font` loader (`components/panel/panelFont.ts`) with weights 500, 600, 700 and 800. The stage's loader (`components/stageFont.ts`, on the card path) is unchanged. Tabular, lining numbers. The canvas measures every digit as a 0, the width tabular digits share, with a 4% margin.
- **Colours:** ink #111111, muted #5B636C, labels #555555, row lines #EEF0F2, the column's line #D9DCE0, background white, a win #145A2B, a loss #B42318. The live screen keeps its own look, outside the dashboard's tokens.

## Tests

| What | Where |
|---|---|
| Record, league record, streak, next game, newest first, time zones | `test/scheduleRecord.test.ts` |
| Rows that fit, name, category and number fits, leaders (ties, estimates, "–", season, volleyball), `reachedOf`, the half's words, the throttle | `test/panelLogic.test.ts` |
| The halves' fixed boxes, the labels, volleyball, the stage's markup identical with the panel on and off | `test/teamPanel.test.ts` |
| P | `test/liveKeys.test.ts` |
| `tonightBoard` | `test/livestatsController.test.ts` |
| Import, year inference, review, saved web pages, the route | `test/scheduleImport.test.ts` |
| Saving twice, another account, delete cascade | `test/db/schedule.test.ts` |
