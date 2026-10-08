-- V3's migrations after the port's base (ad934d3 .. c607645), part 1: two more
-- football stat keys, a team colour, and "heard as" forms. From V3's
--   20260930214906_v3_return_td_keys.sql
--   20261003205012_v3_roster_color.sql
--   20261004210919_v3_heard_as.sql
--
-- The rest of V3's new migrations are 0007 to 0013:
--   0007_app_events_names.sql        20261002031051, 20261004213450
--   0008_shared_game_logs.sql        20261005235549, 20261006045051, 20261007051643, 20261007052059
--   0009_usage_limits.sql            20261007043948
--   0010_accounts_and_errors.sql     20261007044924, 20261007045325
--   0011_delete_my_account.sql       20261007060000
--   0012_save_roster_whole.sql       20261007060100, 20261007203248
--   0013_no_approval.sql             20261007234005
--
-- WHAT HAS NO COUNTERPART HERE, AND WHY. Everything below existed in V3 only
-- because it ran on Supabase:
--   * Every grant and revoke to anon and authenticated, every row level
--     security policy, and security definer used to get past one. Here the app
--     connects as app_rw, which scripts/migrate.mjs grants rows on the public
--     schema and nothing else, and every function takes the owner explicitly.
--   * 20261005235549's pg_cron job 'delete-expired-shared-logs' and
--     20261007045325's 'delete-old-client-errors'. Railway Postgres has no
--     pg_cron. The two functions they ran are kept as plain SQL functions,
--     public.delete_expired_shared_logs() and public.delete_old_client_errors(),
--     and the app or a Railway cron calls them (once a day is plenty).
--   * 20261007052320_v3_tighten_grants.sql: revokes TRUNCATE, REFERENCES and
--     TRIGGER that Supabase grants anon and authenticated by default, and
--     rls_auto_enable(). app_rw never had those (scripts/check-app-role.mjs
--     proves truncate is refused), and there is no rls_auto_enable here.
--   * 20261007060200_v3_drop_v2.sql: drops V2's tables, views and functions.
--     This database never had V2.
--   * 20261007234005's handle_new_user() change: Supabase's trigger that made
--     a profile per auth user. Users are inserted by the app at sign-in here;
--     0013 makes approved default true, which is the part that matters.
--   * 20261007051643/20261007052059's `set local lock_timeout`: a guard for a
--     live Supabase table. shared_game_logs is new here and empty.

-- ---------------------------------------------------------------------------
-- 20260930214906: int_td and fr_td, a touchdown on an interception or fumble
-- return (docs/V3_DEFINITION.md 9.2). Same function and signature as 0002;
-- only the list of keys it keeps grows.
-- ---------------------------------------------------------------------------
create or replace function public.clean_season_stats(p_stats jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case
    when p_stats is null or jsonb_typeof(p_stats) <> 'object' then null
    else (
      select jsonb_object_agg(key, value)
      from jsonb_each(p_stats)
      where jsonb_typeof(value) = 'number'
        and key = any (array[
          'gp', 'rush_att', 'rush_yds', 'rush_td', 'pass_cmp', 'pass_att', 'pass_yds', 'pass_td',
          'pass_int', 'rec', 'rec_yds', 'rec_td', 'tkl', 'sacks', 'sack_yds', 'def_int',
          'int_ret_yds', 'int_td', 'pbu', 'ff', 'fr', 'fr_ret_yds', 'fr_td', 'fum', 'fum_lost',
          'kr', 'kr_yds', 'kr_td', 'pr', 'pr_yds', 'pr_td', 'fgm', 'fga', 'fg_long', 'xpm', 'xpa',
          'punts', 'punt_yds'
        ])
    )
  end
$$;

-- ---------------------------------------------------------------------------
-- 20261003205012: a team colour. The live screen builds CSS out of it, so it is
-- held to a lowercase hex triple and a stray value is refused, not displayed.
-- Written by save_roster (0012) with the rest of the team.
-- ---------------------------------------------------------------------------
alter table rosters add column primary_color text
  check (primary_color is null or primary_color ~ '^#[0-9a-f]{6}$');

comment on column rosters.primary_color is
  'The team''s colour, "#rrggbb". Behind the live screen and in the jersey numbers. Null: no colour.';

-- ---------------------------------------------------------------------------
-- 20261004210919: "heard as" forms, words Deepgram writes for a surname that
-- are not how it is spelled ("fafitaga" for Fifita). Kept apart from
-- pronunciations and from spoken_forms, which every save rebuilds.
-- ---------------------------------------------------------------------------
alter table roster_players add column heard_as text[] not null default '{}';
