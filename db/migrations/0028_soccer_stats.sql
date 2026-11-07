-- Soccer season stats as numbers (Nov 7, Jed: soccer to the same standard
-- as ice hockey).
--
-- clean_season_stats keeps soccer's keys too (lib/cards/sportStats.ts
-- SOCCER_STAT_KEYS): a field player's minutes, goals, assists, points, game
-- winning goals, penalty kick goals, shots, shots on goal and yellow and red
-- cards, and a goalkeeper's wins, losses, ties, shots faced, saves, goals
-- against and shutouts. Every soccer key starts s_ so none is read as another
-- sport's; gp is shared and means games played, as everywhere. Totals only:
-- goals against average and save percentage are worked out on the card.
--
-- Soccer is already one of the sports, so no check changes. A soccer team
-- saved before keeps its written lines until its stats are imported again.

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
          'h_goals', 'h_assists', 'h_points', 'h_ppg', 'h_shg', 'h_gwg', 'h_sog', 'h_plus_minus', 'h_pim',
          'h_wins', 'h_losses', 'h_ties', 'h_otl', 'h_shots_against', 'h_goals_against', 'h_saves',
          'h_shutouts', 'h_minutes',
          's_minutes', 's_goals', 's_assists', 's_points', 's_gwg', 's_pk_goals', 's_shots', 's_sog',
          's_yellow', 's_red', 's_wins', 's_losses', 's_ties', 's_shots_faced', 's_saves',
          's_goals_against', 's_shutouts'
        ])
    )
  end
$$;
