-- set_season_stats refuses stats for players the team no longer has (audit, Nov 1).
--
-- It updated the ids it could find, then cleared every player whose id was not
-- in the payload, and committed. A stats review opened before the roster was
-- saved again (in another tab, or on the stats page) carries the old ids, so
-- it matched nobody and wiped every player's saved stats, and the page said
-- "Saved stats for 0 of N players". Now, when any entry names a player this
-- team does not have, it raises a sentence for the announcer and the whole
-- call rolls back: nothing is written or cleared.
--
-- Otherwise unchanged from 0002_rosters.sql.

create or replace function public.set_season_stats(p_owner uuid, p_roster_id uuid, p_stats jsonb)
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_as_of date := nullif(btrim(p_stats ->> 'as_of'), '')::date;
  v_entries jsonb := case
    when jsonb_typeof(p_stats -> 'players') = 'array' then p_stats -> 'players'
    else '[]'::jsonb
  end;
  v_matched int;
begin
  if p_owner is null then
    raise exception 'Sign in to save stats.';
  end if;

  if not exists (select 1 from public.rosters where id = p_roster_id and owner_id = p_owner) then
    raise exception 'That team no longer exists.';
  end if;

  with wanted as (
    select (entry ->> 'id')::uuid as player_id,
           public.clean_season_stats(entry -> 'stats') as stats,
           case
             when jsonb_typeof(entry -> 'lines') = 'array'
               then array(select jsonb_array_elements_text(entry -> 'lines'))
             else '{}'::text[]
           end as lines
    from jsonb_array_elements(v_entries) as rows (entry)
  )
  update public.roster_players p
     set season_stats = w.stats,
         season_lines = w.lines,
         stats_as_of = v_as_of
    from wanted w
   where p.roster_id = p_roster_id and p.id = w.player_id;

  get diagnostics v_matched = row_count;

  if v_matched < jsonb_array_length(v_entries) then
    raise exception 'The roster was saved again since these stats were read, so they no longer match its players. Nothing was changed. Drop the stats sheet in again.';
  end if;

  update public.roster_players
     set season_stats = null,
         season_lines = '{}'::text[],
         stats_as_of = null
   where roster_id = p_roster_id
     and (season_stats is not null or season_lines <> '{}'::text[] or stats_as_of is not null)
     and id not in (
       select (entry ->> 'id')::uuid
       from jsonb_array_elements(v_entries) as rows (entry)
       where entry ->> 'id' is not null
     );

  update public.rosters set updated_at = now() where id = p_roster_id;

  return v_matched;
end;
$$;
