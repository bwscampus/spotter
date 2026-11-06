-- Ice hockey as a sport of its own (Nov 6, Jed: an announcer who uploads a
-- hockey roster, skater and goalie stats and a schedule should get cards that
-- read the way hockey is called).
--
-- 1. 'ice_hockey' joins every list of sports: a team's sport, a game's, a
--    shared log's and the sports an announcer calls (users.sports, now up to
--    ten). Until now a hockey team could only be saved as 'other'.
-- 2. clean_season_stats keeps hockey's numbers too (lib/cards/sportStats.ts
--    HOCKEY_STAT_KEYS): skaters' goals, assists, points, penalty minutes,
--    plus/minus, shots on goal and power play, short handed and game winning
--    goals, and goalies' wins, losses, ties, overtime losses, shots against,
--    goals against, saves, shutouts and minutes. Every hockey key starts h_
--    so none is read as another sport's (volleyball's assists, basketball's
--    pts); gp is shared and means games played, as everywhere. Plus/minus may
--    be negative. Totals only: GAA and save percentage are worked out on the
--    card, never stored.
-- 3. An announcer who typed "Ice hockey" under Other in About you (Nov 4 to
--    Nov 6) gets the Ice hockey box ticked instead, the way a typed listed
--    sport is saved (normalizeAbout), and "other" stays only if anything else
--    was typed. Teams already saved as 'other' are left alone: nothing says
--    which sport they are.
--
-- Only adds: an old replica's inserts and the live screen are unaffected.

alter table rosters drop constraint rosters_sport_check;
alter table rosters add constraint rosters_sport_check check (
  sport in (
    'volleyball', 'football', 'basketball', 'soccer', 'baseball',
    'softball', 'water_polo', 'lacrosse', 'ice_hockey', 'other'
  )
);

alter table called_games drop constraint called_games_sport_check;
alter table called_games add constraint called_games_sport_check check (
  sport in (
    'volleyball', 'football', 'basketball', 'soccer', 'baseball',
    'softball', 'water_polo', 'lacrosse', 'ice_hockey', 'other'
  )
);

alter table shared_game_logs drop constraint shared_game_logs_sport_check;
alter table shared_game_logs add constraint shared_game_logs_sport_check check (
  sport in (
    'volleyball', 'football', 'basketball', 'soccer', 'baseball',
    'softball', 'water_polo', 'lacrosse', 'ice_hockey', 'other'
  )
);

alter table users drop constraint users_sports_check;
alter table users add constraint users_sports_check check (
  sports <@ array[
    'volleyball', 'football', 'basketball', 'soccer', 'baseball',
    'softball', 'water_polo', 'lacrosse', 'ice_hockey', 'other'
  ]::text[]
  and cardinality(sports) <= 10
);

-- "Ice hockey" typed under Other becomes the box.
update users
set other_sports = array(select label from unnest(other_sports) as label where lower(label) <> 'ice hockey'),
    sports = array(
      select code from unnest(array[
        'volleyball', 'football', 'basketball', 'soccer', 'baseball',
        'softball', 'water_polo', 'lacrosse', 'ice_hockey', 'other'
      ]) as code
      where code = 'ice_hockey'
         or (code = 'other' and exists (select 1 from unnest(other_sports) as label where lower(label) <> 'ice hockey'))
         or (code <> 'other' and code = any (sports))
    )
where exists (select 1 from unnest(other_sports) as label where lower(label) = 'ice hockey');

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
          'punts', 'punt_yds',
          'min', 'pts', 'fg_made', 'fg_att', 'three_made', 'three_att', 'ft_made', 'ft_att',
          'oreb', 'dreb', 'reb', 'ast', 'stl', 'blk', 'tov', 'pf',
          'sets', 'kills', 'attack_err', 'attack_att', 'assists', 'aces', 'serve_err', 'digs',
          'solo_blocks', 'block_assists', 'blocks', 'recv_err',
          'h_goals', 'h_assists', 'h_points', 'h_pim', 'h_plus_minus', 'h_sog', 'h_ppg', 'h_shg', 'h_gwg',
          'h_wins', 'h_losses', 'h_ties', 'h_otl', 'h_shots_against', 'h_goals_against', 'h_saves',
          'h_shutouts', 'h_minutes'
        ])
    )
  end
$$;
