# Spotter V3: Metrics

> **On the class stack:** the views move with the migrations into the `admin` schema of Railway Postgres. Read them as the database owner in Railway's database tab (or any SQL client with `MIGRATION_DATABASE_URL`); the app's role has no grant on that schema. Where this page says Supabase, read Railway.

Six views answer the job stories in `docs/V3_DEFINITION.md` section 10.4. They are read in the Supabase dashboard: **Table Editor, then switch the schema dropdown (top left) from `public` to `admin`.** Each row is one week (Monday to Sunday, Pacific time), newest first.

They live in a schema the app cannot reach, so nobody using Spotter can query them, and they cover every account. They count **production events only**, so testing on a branch link never shows up. Nothing in them holds a player name, a jersey, a heard word or a note. Until people use Spotter on your domain they are empty, and that is correct.

Small numbers lie. A percentage from two games is a story, not a trend. Read the counts beside every percentage.

## metrics_activation

**Tests job story 6 (spreading): sign-up to a called game within a week.** One row per sign-up week, following that group of people forward. `signed_up` is how many joined; `approved`, `saved_a_roster` and `called_a_game` are how many of them got that far, with `_pct` beside each. The three `median_hours_` columns say how long each step took: sign-up to approval (mostly how long you took to click), sign-up to first saved roster, and first saved roster to first game. Read down the percentages for where people stop. A recent week is still filling in, so judge it a week later.

## metrics_prep

**Tests job story 1 (prep): cut prep from about 3 hours to under 1.** The `_success_pct` columns are roster imports that read cleanly, overall and by format (`pdf`, `image`, `text`, `csv`, `xlsx`), and `median_roster_import_seconds` is how long a read took. `median_minutes_to_saved_roster` is the headline: minutes from the first import to a saved roster, so under 60 means the story holds. `rows_edited_pct` is how much of each roster had to be fixed by hand, which is how good the reading is (lower is better). `warnings_left_at_save` are warnings still showing when the roster was saved; `exact_only_set`, `pronunciations_added` and `spotting_off_set` are what got done about names. Warnings up and fixes flat means the warnings are being ignored.

## metrics_names

**Tests job story 2 (live ID) and job story 5 (trust).** `wrong_card_rate_pct` is cards taken down over cards shown, all games that week; `worst_game_wrong_card_rate_pct` is the single worst game. Sept 25 was about 10 percent, and the go/no-go bar is at or below that. `removed_with_x_pct` and `removed_with_digit_pct` say which key gets used. The `removed_after_` and `removed_exact_match` and `removed_near_match` columns split the removals by what put the card up. **Those are counts of removals, not rates**, because cards shown is only counted for a whole game, not by cue, so you can see what gets taken down most but not how often each cue is wrong. `median_seconds_card_was_up_before_removed` is how long a wrong card stayed before it was fixed, and `median_card_latency_p50_ms` and `p95` are how fast cards appeared (surnames were measured at about 1200 ms, which is the number to compare against).

## metrics_stats

**Tests job story 3 (live stats): a busy back's running total, without keeping a sheet.** Empty until live stats exist. One row per week and play type (`run`, `pass` and so on), with `undo_rate_pct`, the share of applied plays you undid, which is the best accuracy signal there is. `events_undone` says how many player changes those undos reversed, `dropped_events` and `dropped_by_rule` say which of the stat rules threw events away, and `median_seconds_before_undo` says how fast the mistake was noticed. A row with play type `whole week` carries what is not about a play type: `games_with_stats`, `stats_turned_off_mid_game` (people giving up on it), `stats_calls_failed`, and the median tokens per game. **The columns read these properties, which the stats events (items 12 and 13) must send with these names:** `stats.play_applied` with `play_type`, `events` and `dropped_<rule>`; `stats.play_undone` with `play_type`, `actions` and `seconds_since_applied`; `game.ended` with `stats_off_mid_game`, `tokens_in`, `tokens_out` and `tokens_cached`. A property with another name leaves its column empty.

Since Oct 2 every play waits for your OK before it counts (docs/V3_DEFINITION.md 8.6), so a wrong play is usually thrown away or fixed before it is applied, and `undo_rate_pct` understates how often Spotter read a play wrong. That signal now lives in `stats.play_discarded` (one per play thrown away, with `play_type`, `events`, `confidence_bucket` and `seconds_pending`) and in `corrected` and `seconds_pending` on `stats.play_applied`. The view does not read them yet; adding a discard rate and a corrected rate to it is a small follow-up.

## metrics_retention

**Tests job story 6 (spreading), and whether people stay.** `active_callers` is how many accounts started a game that week, `games_per_caller` how many each, `new_callers` first-timers and `returning_callers` everyone else. `came_back_next_week` and its `_pct` say how many of this week's callers also called a game the week after, which is empty for the current week because it has not happened yet. Look for the percentage holding above zero after the first month; a week of new callers and no return is a leak.

## metrics_feedback

**Tests job stories 3 and 4 (stats in context), and the plain question of whether it is working.** From the end-of-game card. `average_rating` and `rated_4_or_5_pct` are the mood, and the columns `wrong_names`, `missing_names`, `slow`, `stats_wrong`, `stats_missing`, `too_much_on_screen` and `nothing_in_the_way` count how many people picked each chip, with `top_blocker` naming the most common complaint. `notes_left` counts notes; read them in the `game_feedback` table, which the view leaves out on purpose. It only counts games that also have a production event, since feedback carries no environment of its own. A skipped card counts as nothing at all, so ratings come from people who chose to answer.
