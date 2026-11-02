-- Basketball and volleyball season stats as numbers (Nov 2).
--
-- clean_season_stats keeps the keys a season stats sheet can fill and drops
-- everything else. Until now that was football's 38 keys (0006). It now keeps
-- basketball's and volleyball's too, so those sports' imports save numbers,
-- like football's, instead of written lines.
--
-- No key is shared with football except gp (games played, the same meaning in
-- all three): basketball's field goals are fg_made and fg_att because
-- football's fgm and fga are kicks. A row only ever holds its own sport's keys,
-- because the import cleans by sport (lib/cards/sportStats.ts cleanStatsFor),
-- so one union list here is enough. lib/cards/sportStats.ts SEASON_STAT_KEYS
-- is the same list, and test/statKeys.test.ts compares them.
--
-- save_roster and set_season_stats call this function, so nothing else changes.

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
          'solo_blocks', 'block_assists', 'blocks', 'recv_err'
        ])
    )
  end
$$;
