-- Metric views: the six views in docs/V3_DEFINITION.md section 10.3, from V3's
-- 20260930042300. Read them as the database owner (Railway's database tab, or
-- any SQL client with MIGRATION_DATABASE_URL), in the schema named admin.
--
-- WHERE THEY LIVE: the admin schema, on which the app's role (app_rw) has no
-- rights at all: scripts/migrate.mjs grants it the public schema only. Nobody
-- using the app can query or even see them. They cover every account.
--
-- PRIVACY: nothing here reads a player name, jersey, word or note. app_events
-- holds codes and counts only, game_feedback is read for its rating and chips,
-- and the free-text note is left out on purpose.
--
-- PRODUCTION ONLY: every view counts events with env = 'production'. Feedback has
-- no env of its own, so it counts only games that also have a production event.
-- Testing on staging never reaches these numbers.
--
-- WEEKS start on Monday in Pacific time, because that is when the games are
-- played: a Friday night game and the Sunday after land in the same week, and
-- a game that ends after midnight UTC does not slide into the next one.
--
-- Column names are plain on purpose. docs/METRICS.md says what each view tests
-- and how to read it.

create schema if not exists admin;

revoke all on schema admin from public;
-- Anything created here later starts closed too.
alter default privileges in schema admin revoke all on tables from public;
alter default privileges in schema admin revoke all on functions from public;

-- The Monday a moment falls in, in Pacific time.
create function admin.week_starting(moment timestamptz)
returns date
language sql
stable
set search_path = ''
as $$
  select date_trunc('week', moment at time zone 'America/Los_Angeles')::date
$$;

revoke all on function admin.week_starting(timestamptz) from public;

-- ---------------------------------------------------------------------------
-- metrics_activation: sign-ups by the week they signed up, and how far each
-- cohort got. Job story 6 (spreading).
-- ---------------------------------------------------------------------------
create view admin.metrics_activation as
with signups as (
  select e.owner_id, e.at as signed_up_at, admin.week_starting(e.at) as week_starting
  from public.app_events e
  where e.env = 'production' and e.name = 'account.signed_up'
),
first_roster as (
  select owner_id, min(at) as at
  from public.app_events
  where env = 'production' and name = 'prep.roster_saved'
  group by owner_id
),
first_game as (
  select owner_id, min(at) as at
  from public.app_events
  where env = 'production' and name = 'game.started'
  group by owner_id
),
steps as (
  select
    s.week_starting,
    s.owner_id,
    p.approved_at,
    r.at as roster_at,
    g.at as game_at,
    extract(epoch from (p.approved_at - s.signed_up_at)) / 3600 as hours_to_approval,
    extract(epoch from (r.at - s.signed_up_at)) / 3600 as hours_to_roster,
    extract(epoch from (g.at - r.at)) / 3600 as hours_roster_to_game
  from signups s
  left join public.users p on p.id = s.owner_id and p.approved
  left join first_roster r on r.owner_id = s.owner_id
  left join first_game g on g.owner_id = s.owner_id
)
select
  week_starting,
  count(*) as signed_up,
  count(approved_at) as approved,
  count(roster_at) as saved_a_roster,
  count(game_at) as called_a_game,
  round(100.0 * count(approved_at) / count(*), 0) as approved_pct,
  round(100.0 * count(roster_at) / count(*), 0) as saved_a_roster_pct,
  round(100.0 * count(game_at) / count(*), 0) as called_a_game_pct,
  round((percentile_cont(0.5) within group (order by hours_to_approval)
    filter (where hours_to_approval is not null))::numeric, 1) as median_hours_to_approval,
  round((percentile_cont(0.5) within group (order by hours_to_roster)
    filter (where hours_to_roster is not null))::numeric, 1) as median_hours_signup_to_first_roster,
  round((percentile_cont(0.5) within group (order by hours_roster_to_game)
    filter (where hours_roster_to_game is not null))::numeric, 1) as median_hours_first_roster_to_first_game
from steps
group by week_starting
order by week_starting desc;

-- ---------------------------------------------------------------------------
-- metrics_prep: import success, time to a saved roster, and what got fixed.
-- Job story 1 (prep).
-- ---------------------------------------------------------------------------
create view admin.metrics_prep as
with imports as (
  select
    admin.week_starting(at) as week_starting,
    props->>'kind' as kind,
    props->>'format' as format,
    (props->>'ok')::boolean as ok,
    (props->>'ms')::numeric as ms
  from public.app_events
  where env = 'production' and name = 'prep.import_finished'
),
import_weeks as (
  select
    week_starting,
    count(*) filter (where kind = 'roster') as roster_imports,
    round(100.0 * count(*) filter (where kind = 'roster' and ok)
      / nullif(count(*) filter (where kind = 'roster'), 0), 0) as roster_import_success_pct,
    round(100.0 * count(*) filter (where kind = 'roster' and format = 'pdf' and ok)
      / nullif(count(*) filter (where kind = 'roster' and format = 'pdf'), 0), 0) as pdf_success_pct,
    round(100.0 * count(*) filter (where kind = 'roster' and format = 'image' and ok)
      / nullif(count(*) filter (where kind = 'roster' and format = 'image'), 0), 0) as image_success_pct,
    round(100.0 * count(*) filter (where kind = 'roster' and format = 'text' and ok)
      / nullif(count(*) filter (where kind = 'roster' and format = 'text'), 0), 0) as text_success_pct,
    round(100.0 * count(*) filter (where kind = 'roster' and format = 'csv' and ok)
      / nullif(count(*) filter (where kind = 'roster' and format = 'csv'), 0), 0) as csv_success_pct,
    round(100.0 * count(*) filter (where kind = 'roster' and format = 'xlsx' and ok)
      / nullif(count(*) filter (where kind = 'roster' and format = 'xlsx'), 0), 0) as xlsx_success_pct,
    round((percentile_cont(0.5) within group (order by ms)
      filter (where kind = 'roster' and ms is not null) / 1000)::numeric, 1) as median_roster_import_seconds,
    count(*) filter (where kind = 'stats') as stats_imports,
    round(100.0 * count(*) filter (where kind = 'stats' and ok)
      / nullif(count(*) filter (where kind = 'stats'), 0), 0) as stats_import_success_pct
  from imports
  group by week_starting
),
saves as (
  select
    admin.week_starting(e.at) as week_starting,
    (e.props->>'players')::numeric as players,
    (e.props->>'rows_edited')::numeric as rows_edited,
    (e.props->>'minutes_from_first_import')::numeric as minutes_from_first_import,
    (e.props->>'exact_only_set')::numeric as exact_only_set,
    (e.props->>'spotting_off_set')::numeric as spotting_off_set,
    (e.props->>'pronunciations_added')::numeric as pronunciations_added,
    coalesce((
      select sum(w.value::numeric)
      from jsonb_each_text(e.props) w
      where w.key like 'warn\_%'
    ), 0) as warnings_left
  from public.app_events e
  where e.env = 'production' and e.name = 'prep.roster_saved'
),
save_weeks as (
  select
    week_starting,
    count(*) as rosters_saved,
    round((percentile_cont(0.5) within group (order by minutes_from_first_import)
      filter (where minutes_from_first_import is not null))::numeric, 1) as median_minutes_to_saved_roster,
    sum(players) as players_saved,
    round(100.0 * sum(rows_edited) / nullif(sum(players), 0), 0) as rows_edited_pct,
    sum(warnings_left) as warnings_left_at_save,
    sum(exact_only_set) as exact_only_set,
    sum(pronunciations_added) as pronunciations_added,
    sum(spotting_off_set) as spotting_off_set
  from saves
  group by week_starting
)
select
  coalesce(i.week_starting, s.week_starting) as week_starting,
  i.roster_imports,
  i.roster_import_success_pct,
  i.pdf_success_pct,
  i.image_success_pct,
  i.text_success_pct,
  i.csv_success_pct,
  i.xlsx_success_pct,
  i.median_roster_import_seconds,
  i.stats_imports,
  i.stats_import_success_pct,
  s.rosters_saved,
  s.median_minutes_to_saved_roster,
  s.players_saved,
  s.rows_edited_pct,
  s.warnings_left_at_save,
  s.exact_only_set,
  s.pronunciations_added,
  s.spotting_off_set
from import_weeks i
full join save_weeks s on s.week_starting = i.week_starting
order by 1 desc;

-- ---------------------------------------------------------------------------
-- metrics_names: how often a card was wrong, by what put it up, and how fast.
-- Job stories 2 (live ID) and 5 (trust).
--
-- The rate is cards removed over cards shown, per week and worst single game.
-- Cards shown is only counted for a whole game, not by cue, so the split by cue
-- and by exact or near is counts of removals, not rates.
-- ---------------------------------------------------------------------------
create view admin.metrics_names as
with ended as (
  select
    admin.week_starting(at) as week_starting,
    (props->>'cards_shown')::numeric as cards_shown,
    (props->>'cards_removed')::numeric as cards_removed,
    (props->>'card_latency_p50_ms')::numeric as latency_p50,
    (props->>'card_latency_p95_ms')::numeric as latency_p95
  from public.app_events
  where env = 'production' and name = 'game.ended'
),
game_weeks as (
  select
    week_starting,
    count(*) as games,
    sum(cards_shown) as cards_shown,
    sum(cards_removed) as cards_removed,
    round(100.0 * sum(cards_removed) / nullif(sum(cards_shown), 0), 1) as wrong_card_rate_pct,
    round(max(100.0 * cards_removed / nullif(cards_shown, 0)), 1) as worst_game_wrong_card_rate_pct,
    round((percentile_cont(0.5) within group (order by latency_p50)
      filter (where latency_p50 is not null))::numeric, 0) as median_card_latency_p50_ms,
    round((percentile_cont(0.5) within group (order by latency_p95)
      filter (where latency_p95 is not null))::numeric, 0) as median_card_latency_p95_ms
  from ended
  group by week_starting
),
removals as (
  select
    admin.week_starting(at) as week_starting,
    props->>'key' as key,
    props->>'cue' as cue,
    props->>'match' as match,
    (props->>'seconds_since_shown')::numeric as seconds_since_shown
  from public.app_events
  where env = 'production' and name = 'names.card_removed'
),
removal_weeks as (
  select
    week_starting,
    count(*) as removals,
    round(100.0 * count(*) filter (where key = 'x') / count(*), 0) as removed_with_x_pct,
    round(100.0 * count(*) filter (where key in ('1', '2', '3')) / count(*), 0) as removed_with_digit_pct,
    count(*) filter (where cue = 'name') as removed_after_name,
    count(*) filter (where cue = 'number_explicit') as removed_after_number_said,
    count(*) filter (where cue = 'number_surname') as removed_after_number_with_surname,
    count(*) filter (where cue = 'number_team') as removed_after_number_with_team,
    count(*) filter (where match = 'exact') as removed_exact_match,
    count(*) filter (where match = 'near') as removed_near_match,
    round(100.0 * count(*) filter (where match = 'near') / count(*), 0) as near_match_pct_of_removals,
    round((percentile_cont(0.5) within group (order by seconds_since_shown)
      filter (where seconds_since_shown is not null))::numeric, 0) as median_seconds_card_was_up_before_removed
  from removals
  group by week_starting
)
select
  coalesce(g.week_starting, r.week_starting) as week_starting,
  g.games,
  g.cards_shown,
  g.cards_removed,
  g.wrong_card_rate_pct,
  g.worst_game_wrong_card_rate_pct,
  r.removed_with_x_pct,
  r.removed_with_digit_pct,
  r.removed_after_name,
  r.removed_after_number_said,
  r.removed_after_number_with_surname,
  r.removed_after_number_with_team,
  r.removed_exact_match,
  r.removed_near_match,
  r.near_match_pct_of_removals,
  r.median_seconds_card_was_up_before_removed,
  g.median_card_latency_p50_ms,
  g.median_card_latency_p95_ms
from game_weeks g
full join removal_weeks r on r.week_starting = g.week_starting
order by 1 desc;

-- ---------------------------------------------------------------------------
-- metrics_stats: how often live stats were undone, by play type. Job story 3
-- (live stats). Empty until item 12 and 13 emit the stats events.
--
-- One row per week and play type, plus one row per week with play_type
-- 'whole week', which carries the numbers that are not about a play type.
--
-- The property names it reads are the contract with the stats events:
--   stats.play_applied: play_type, events, and any number of dropped_<rule>
--   stats.play_undone: play_type, actions, seconds_since_applied
--   game.started: stats (true or false)
--   game.ended: stats_off_mid_game, tokens_in, tokens_out, tokens_cached
--   stats.call_failed: no properties needed
-- A property that is missing simply leaves its column empty.
-- ---------------------------------------------------------------------------
create view admin.metrics_stats as
with applied as (
  select
    admin.week_starting(e.at) as week_starting,
    coalesce(e.props->>'play_type', 'unknown') as play_type,
    (e.props->>'events')::numeric as events,
    coalesce((
      select sum(d.value::numeric) from jsonb_each_text(e.props) d where d.key like 'dropped\_%'
    ), 0) as dropped_events,
    e.props
  from public.app_events e
  where e.env = 'production' and e.name = 'stats.play_applied'
),
applied_types as (
  select
    week_starting,
    play_type,
    count(*) as plays_applied,
    sum(events) as events_applied,
    sum(dropped_events) as dropped_events
  from applied
  group by week_starting, play_type
),
dropped_rules as (
  select a.week_starting, a.play_type, d.key, sum(d.value::numeric) as total
  from applied a, jsonb_each_text(a.props) d
  where d.key like 'dropped\_%'
  group by a.week_starting, a.play_type, d.key
),
dropped_by_rule as (
  select week_starting, play_type,
    jsonb_object_agg(regexp_replace(key, '^dropped_', ''), total) as by_rule
  from dropped_rules
  group by week_starting, play_type
),
undone_types as (
  select
    admin.week_starting(at) as week_starting,
    coalesce(props->>'play_type', 'unknown') as play_type,
    count(*) as plays_undone,
    sum((props->>'actions')::numeric) as events_undone,
    round((percentile_cont(0.5) within group (order by (props->>'seconds_since_applied')::numeric)
      filter (where props->>'seconds_since_applied' is not null))::numeric, 0) as median_seconds_before_undo
  from public.app_events
  where env = 'production' and name = 'stats.play_undone'
  group by 1, 2
),
by_type as (
  select
    coalesce(a.week_starting, u.week_starting) as week_starting,
    coalesce(a.play_type, u.play_type) as play_type,
    a.plays_applied,
    u.plays_undone,
    round(100.0 * coalesce(u.plays_undone, 0) / nullif(a.plays_applied, 0), 1) as undo_rate_pct,
    a.events_applied,
    u.events_undone,
    a.dropped_events,
    r.by_rule as dropped_by_rule,
    u.median_seconds_before_undo
  from applied_types a
  full join undone_types u on u.week_starting = a.week_starting and u.play_type = a.play_type
  left join dropped_by_rule r on r.week_starting = a.week_starting and r.play_type = a.play_type
),
game_week as (
  select
    admin.week_starting(at) as week_starting,
    count(*) filter (where props->>'stats' = 'true') as games_with_stats
  from public.app_events
  where env = 'production' and name = 'game.started'
  group by 1
),
ended_week as (
  select
    admin.week_starting(at) as week_starting,
    count(*) filter (where props->>'stats_off_mid_game' = 'true') as stats_turned_off_mid_game,
    round((percentile_cont(0.5) within group (order by (props->>'tokens_in')::numeric)
      filter (where props->>'tokens_in' is not null))::numeric, 0) as median_tokens_in_per_game,
    round((percentile_cont(0.5) within group (order by (props->>'tokens_out')::numeric)
      filter (where props->>'tokens_out' is not null))::numeric, 0) as median_tokens_out_per_game,
    round((percentile_cont(0.5) within group (order by (props->>'tokens_cached')::numeric)
      filter (where props->>'tokens_cached' is not null))::numeric, 0) as median_tokens_cached_per_game
  from public.app_events
  where env = 'production' and name = 'game.ended'
  group by 1
),
failed_week as (
  select admin.week_starting(at) as week_starting, count(*) as stats_calls_failed
  from public.app_events
  where env = 'production' and name = 'stats.call_failed'
  group by 1
),
stats_weeks as (
  -- A week is worth a row only if stats did something in it.
  select week_starting from by_type
  union
  select week_starting from game_week where games_with_stats > 0
  union
  select week_starting from failed_week
)
select
  week_starting,
  play_type,
  plays_applied,
  plays_undone,
  undo_rate_pct,
  events_applied,
  events_undone,
  dropped_events,
  dropped_by_rule,
  median_seconds_before_undo,
  null::bigint as games_with_stats,
  null::bigint as stats_turned_off_mid_game,
  null::bigint as stats_calls_failed,
  null::numeric as median_tokens_in_per_game,
  null::numeric as median_tokens_out_per_game,
  null::numeric as median_tokens_cached_per_game
from by_type
union all
select
  w.week_starting,
  'whole week',
  null, null, null, null, null, null, null, null,
  g.games_with_stats,
  e.stats_turned_off_mid_game,
  f.stats_calls_failed,
  e.median_tokens_in_per_game,
  e.median_tokens_out_per_game,
  e.median_tokens_cached_per_game
from stats_weeks w
left join game_week g on g.week_starting = w.week_starting
left join ended_week e on e.week_starting = w.week_starting
left join failed_week f on f.week_starting = w.week_starting
order by week_starting desc, play_type;

-- ---------------------------------------------------------------------------
-- metrics_retention: who is calling games, and who comes back. Job story 6
-- (spreading), and whether the others hold.
-- ---------------------------------------------------------------------------
create view admin.metrics_retention as
with started as (
  select owner_id, admin.week_starting(at) as week_starting, count(*) as games
  from public.app_events
  where env = 'production' and name = 'game.started'
  group by owner_id, admin.week_starting(at)
),
first_week as (
  select owner_id, min(week_starting) as first_week
  from started
  group by owner_id
)
select
  s.week_starting,
  count(*) as active_callers,
  sum(s.games) as games_started,
  round(sum(s.games)::numeric / count(*), 1) as games_per_caller,
  count(*) filter (where s.week_starting = f.first_week) as new_callers,
  count(*) filter (where s.week_starting > f.first_week) as returning_callers,
  -- Empty for the current week: nobody can have come back to a week that has not happened.
  case when s.week_starting + 7 <= admin.week_starting(now()) then
    count(*) filter (where exists (
      select 1 from started n where n.owner_id = s.owner_id and n.week_starting = s.week_starting + 7
    ))
  end as came_back_next_week,
  case when s.week_starting + 7 <= admin.week_starting(now()) then
    round(100.0 * count(*) filter (where exists (
      select 1 from started n where n.owner_id = s.owner_id and n.week_starting = s.week_starting + 7
    )) / count(*), 0)
  end as came_back_next_week_pct
from started s
join first_week f on f.owner_id = s.owner_id
group by s.week_starting
order by s.week_starting desc;

-- ---------------------------------------------------------------------------
-- metrics_feedback: the end-of-game rating and what got in the way. Job stories
-- 3 and 4 (the chips), and the general question of whether it is working.
--
-- Only games that also have a production event count, since feedback has no env
-- of its own. The free-text note is left out: read those in game_feedback.
-- ---------------------------------------------------------------------------
create view admin.metrics_feedback as
with feedback as (
  select f.rating, f.blockers, f.note, admin.week_starting(f.created_at) as week_starting
  from public.game_feedback f
  where exists (
    select 1 from public.app_events e
    where e.env = 'production' and e.game_id = f.game_id and e.name in ('game.started', 'game.ended')
  )
)
select
  w.week_starting,
  count(*) as responses,
  round(avg(w.rating), 2) as average_rating,
  round(100.0 * count(*) filter (where w.rating >= 4) / count(*), 0) as rated_4_or_5_pct,
  count(*) filter (where 'wrong_names' = any(w.blockers)) as wrong_names,
  count(*) filter (where 'missing_names' = any(w.blockers)) as missing_names,
  count(*) filter (where 'slow' = any(w.blockers)) as slow,
  count(*) filter (where 'stats_wrong' = any(w.blockers)) as stats_wrong,
  count(*) filter (where 'stats_missing' = any(w.blockers)) as stats_missing,
  count(*) filter (where 'too_much_on_screen' = any(w.blockers)) as too_much_on_screen,
  count(*) filter (where 'nothing' = any(w.blockers)) as nothing_in_the_way,
  (
    select b
    from feedback f2, unnest(f2.blockers) b
    where f2.week_starting = w.week_starting and b <> 'nothing'
    group by b
    order by count(*) desc, b
    limit 1
  ) as top_blocker,
  count(*) filter (where w.note is not null) as notes_left
from feedback w
group by w.week_starting
order by w.week_starting desc;

-- Closed to the app, however the schema or its views were created.
revoke all on all tables in schema admin from public;
