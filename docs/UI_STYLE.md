# The dashboard's style

Every Spotter screen except the live one (Oct 5): Home, Teams, a team, its season stats and cards preview, New game and its Names page, Past games, sign in and reset password. Boring, dense and flat, like a spreadsheet. The live screen and its stage keep their own look (`docs/CARD_SPEC.md`).

## The header

One header, identical on every screen: the same items, in the same order and the same places, the same 40px, at every width, signed in or signed out.

- `components/SiteHeader.tsx` takes **no children** and no page content. Its only inputs are which of the four links is current and the signed-in email. A page's own links and actions go in that page's toolbar. `test/siteHeader.test.ts` renders it every way and reads every file under `app/` and `components/` to hold this.
- It is drawn once, by `components/SiteChrome.tsx` in the root layout, which works out the current link from the path (`placeFor` in `lib/ui/nav.ts`).
- Left to right: SPOTTER (13px/700, 0.1em, links to /), Home, New game, Teams, Past games (13px/500, ink-2, 0 12px, full height; the current one ink with a 2px ink underline and `aria-current="page"`; every link carries a 2px transparent top and bottom border so being current moves nothing), at least 24px of space, the email (12px muted), Sign out (12px/500, posts to `/auth/signout`).
- Current: Home on /; New game on setup, its Names page and the sound check; Teams on every /teams page; Past games on /games; none on sign in and reset password.
- Signed out (sign in, reset password): the wordmark and links stay where they are, in the disabled colour and not clickable; the email and Sign out keep their space with `visibility: hidden`.
- Too narrow: the header scrolls sideways. Nothing wraps, hides, reorders or collapses.
- The live screen has no header. It keeps its own bar.

## Tokens

In `app/globals.css` (`@theme`). Components use the tokens, never raw hex.

| Token | Hex | For |
|---|---|---|
| ink | #14171A | body text |
| ink-2 | #3D444C | labels, table headers |
| muted | #5B636C | meta, empty states |
| disabled | #9AA1A9 | disabled text |
| line | #D9DCE0 | row and panel borders |
| line-strong | #B8BDC4 | inputs, buttons, the rule under a table header |
| cell-line | #E6E8EB | between editable cells |
| surface | #FFFFFF | |
| surface-2 | #F5F6F7 | toolbar, panel heads, row hover |
| press | #F0F2F4 | an outlined button's hover |
| accent / accent-hover | #0B4F9E / #083A75 | only the one primary button, and links |
| amber-text, amber-dot, amber-fill, amber-line | #8A4B00, #D98A00, #FFF4D6, #E8C27A | warnings |
| red, red-fill, red-line | #B42318, #FEECEB, #F1B5AF | errors, destructive actions |
| green, green-fill, green-line | #1A7F37, #E7F5EB, #A9D8B5 | "ok" |

No other colours. A colour never carries meaning alone: it always comes with words. Light theme only. No gradients, shadows, illustrations or icons, and no animation but a 100 ms colour change on hover.

## Type and sizes

- IBM Plex Sans (400, 500, 600, 700) for text, IBM Plex Mono (400, 500, 600) for jersey numbers, scores, counts, dates and ids, both through `next/font/google` (`components/appFont.ts`), so they are served from Spotter's own build and nothing is fetched from Google at game time. Fallbacks system-ui and ui-monospace. They are CSS variables on `<html>` and applied by the `.dash` class, so they never reach the live stage. `tabular-nums` throughout.
- Page title 15px/600. Body, cells and inputs 13px/400 (600 for emphasis). Table headers, field labels and meta 12px/600. Mono numbers 12px. Panel headings 12px/600 uppercase, 0.04em, ink-2. Badges 11px/600.
- Spacing 4, 8, 12, 16, 24, 32. Header 40px. Toolbar at least 46px. Table rows and panel heads 32px. Buttons, inputs and selects 30px. Badges 18px. Radius 3px (2px on badges). Every border 1px.
- Built for 1024px and up. Under 1024 everything stacks to one column and tables scroll in their own boxes. The page never scrolls sideways.

## Components

Each is built once, in `components/ui/`.

- **Button** (`Button.tsx`): 30px, radius 3. Primary: accent, white, 600, 0 14px; at most one per screen. Outlined: white, line-strong, ink, 500, 0 12px, hover press. Destructive: white, red border and text, hover red-fill; always confirms. Disabled: white, line, disabled text. Text link: accent, underline on hover.
- **Input and select** (`Field.tsx`): 30px, line-strong, radius 3, 0 8px. Every one has a real label. An error is a red border and one red line under it with the cause and the fix.
- **Focus**: a 2px accent outline, 1px offset, on everything focusable (`:focus-visible`); inside an editable cell it sits inside the cell. Enter submits the form it is in. Escape closes anything open: a confirm, the import bar, a row's warnings.
- **Table** (`Table.tsx`): header 32px, 12px/600 ink-2, line-strong under it, sticky while the page scrolls. Rows 32px, line under each, hover surface-2, no zebra. Text left, numbers right and mono. A sortable header is a button with ↕ in the disabled colour; the sorted one shows ↑ or ↓ in ink and sets `aria-sort`. Under 1024 a table scrolls in its own box; the always-wide ones (the roster, the stats review) scroll in their box at every width, which is the one place the header sticks to the box rather than the page.
- **Badge** (`Badge.tsx`): 18px, radius 2, 11px/600. Amber, green, red: fill, line, text. Neutral: white, line-strong, ink-2. The full reason is the tooltip and is read to a screen reader.
- **Warning row** (`Rows.tsx`): 32px, a round 8px amber dot, one line cut with an ellipsis (all of it in the title), the fix as a link at the right. **Error row**: a square 8px red dot and red text.
- **Empty state**: one muted line and the next action as a link. Never a picture.
- **Panel** (`Panel.tsx`): line border, radius 3, a 32px surface-2 head with the heading left and at most one link right.
- **Toolbar** (`Toolbar.tsx`): directly under the header on every page. surface-2, line under it, 8px 16px, 8px gaps, wraps when narrow. The title, or a breadcrumb ending in it, on the left; the page's actions on the right, primary last.
- **Switch** (`Switch.tsx`): a 38 by 20 rectangle, radius 3, a 14px square knob, `role="switch"`. On: green, white knob right, "On". Off: white, line-strong, muted knob left, "Off".
- **Confirm** (`Confirm.tsx`): drawn in place of what asked, never a modal. Escape cancels.
- **Dates**: "Oct 3, 9:12 PM" (`shortDate` in `lib/ui/format.ts`), written in the browser by `LocalDate`, because the server does not know the announcer's time zone. A calendar date ("as of") is "Sep 24" (`dayLabel`), read from the string so no time zone moves it.

## Screens

| Screen | File | Notes |
|---|---|---|
| Home | `app/page.tsx` | Game in progress (`CurrentGame`: Resume, End), Last 5 games, Teams (`HomeTeams`: counts and the stale-stats warning). The build commit at the bottom. |
| Teams | `components/rosters/TeamsTable.tsx` | Search by school or mascot, sortable columns, a stale "as of" in amber with "9 d old". Delete confirms in the row. |
| Team | `components/rosters/RosterEditor.tsx`, `PlayerTable.tsx` | Toolbar: breadcrumb, meta, Season stats, Cards preview, Import, Delete (confirms in the toolbar), Save. The import comes first, above the team details: open and big on a team with no players yet, and one 64px dashed bar on a team that has a roster, until opened (`ImportPanel` `layout="bar"`). The import panel is the one place bigger than the scale here (Jed, Oct 6: it must be the first thing you see): a 300px drop zone with a 20px line and a 44px Choose files button, and a 10-line paste box. Every cell is editable in place, the Storyline box (one line under the name on the card, 80 characters) included; a row's warnings are badges, and a click opens them under the row with the fixes. |
| Season stats | `components/stats/StatsImport.tsx` | The import panel first, big, in a dashed box, then the file bar (name, counts, Replace file, Discard, Stats as of), the unmatched warning, and the review table grouped by stat. |
| New game | `components/game/GameSetup.tsx` | Start in the toolbar. Each team's warnings under its panel and the rest under both (`lib/game/setupWarnings.ts`), one link to the Names page, Wearing tonight, the Live stats switch. |
| Names | `components/game/NamesPage.tsx`, `NamesTables.tsx` | `/games/new/names`. Every name listened for, names that sound alike, first names that are surnames, names that sound like a team, numbers that sound alike, dropped name parts. Built from `loadAssembled`, the same assembled game Start builds, without the keyterm check. |
| Sound check | `components/game/SoundCheck.tsx` | `/games/sound-check`. The name at 120px/700 in the middle, its jersey, first name, school and pronunciation note in mono, the result with its dot, Next, Again, Skip; a status line under a rule with the mic, the connection and "1 of 30". |
| Past games | `components/games/PastGames.tsx` | One table. Download only where this browser has the log; "Words Deepgram got wrong" opens under the row (read from the log on the first click, so the count shows after it); Delete asks twice in the row. |
| Sign in, reset password | `components/auth/LoginForm.tsx`, `ResetPasswordForm.tsx` | One 320px box on surface-2. |
