-- Volleyball (Jed, Oct 21): a player's season stats as labelled values.
--
-- Volleyball is prep and spot only: the announcer uploads a roster with its
-- season stats, and the card shows them, unchanged, all match. A volleyball
-- stats sheet has no fixed set of columns (MaxPreps prints some, a coach's
-- spreadsheet others), so a player's stats are kept as the sheet printed
-- them: an ordered list of { label, value } pairs, the known stats under the
-- abbreviations in lib/cards/volleyball.ts (K, E, TA, PCT, ...) and any other
-- column under its own header, rather than one column per stat. Values are
-- text, as printed (".312", "3.45", "1,024").
--
-- Football is untouched: it keeps season_stats (numbers on the 9.2 keys) and
-- never sends season_values, so its players' new column is null, which is
-- what every existing row gets too. No existing row or game is changed.
--
-- save_roster and set_season_stats are the 0012 and 0002 functions with one
-- more column each:
--   save_roster        p_players[].season_values  [{label, value}], or absent
--   set_season_stats   p_stats.players[].values   [{label, value}], or absent
-- and set_season_stats clears season_values, with the rest, for a player the
-- new import does not name. called_games.sport already takes 'volleyball'
-- (0003), so a game needs nothing new.

alter table roster_players
  add column season_values jsonb
  constraint roster_players_season_values_shape check (season_values is null or jsonb_typeof(season_values) = 'array');

comment on column roster_players.season_values is
  'Volleyball season stats as printed: [{"label": "K", "value": "245"}, ...]. Null for football and for a player with none.';

-- Keeps entries that are an object with a text label (1 to 24 characters) and
-- a text or number value (1 to 16 characters, numbers kept as written), the
-- first for each label, at most 40, in order. Anything else is dropped rather
-- than failing the save, as clean_season_stats does. Empty is null. The
-- browser applies the same rules first (cleanStatValues).
create function public.clean_season_values(p_values jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case
    when p_values is null or jsonb_typeof(p_values) <> 'array' then null
    else (
      select jsonb_agg(jsonb_build_object('label', label, 'value', value) order by n)
      from (
        select label, value, n
        from (
          select distinct on (lower(label)) label, value, n
          from (
            select btrim(entry ->> 'label') as label,
                   btrim(entry ->> 'value') as value,
                   n
            from jsonb_array_elements(p_values) with ordinality as rows (entry, n)
            where jsonb_typeof(entry) = 'object'
              and jsonb_typeof(entry -> 'label') = 'string'
              and jsonb_typeof(entry -> 'value') in ('string', 'number')
          ) as raw
          where char_length(label) between 1 and 24
            and char_length(value) between 1 and 16
          order by lower(label), n
        ) as firsts
        order by n
        limit 40
      ) as kept
    )
  end
$$;

-- ---------------------------------------------------------------------------
-- save_roster: 0012's, writing season_values.
-- ---------------------------------------------------------------------------
create or replace function public.save_roster(p_owner uuid, p_roster jsonb, p_players jsonb)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  -- TUNING: the caps. M4 in V3's docs/PRE_LAUNCH_AUDIT.md.
  c_max_players constant int := 300;
  c_max_name_chars constant int := 80;
  c_max_rosters constant int := 60;
  c_max_heard_as constant int := 8;
  c_max_heard_as_chars constant int := 40;
  c_max_storyline_chars constant int := 80;

  v_owner uuid := p_owner;
  v_id uuid := nullif(btrim(p_roster ->> 'id'), '')::uuid;
  v_school text := nullif(btrim(p_roster ->> 'school'), '');
  v_mascot text := nullif(btrim(p_roster ->> 'mascot'), '');
  v_sport text := lower(nullif(btrim(p_roster ->> 'sport'), ''));
  v_gender text := lower(nullif(btrim(p_roster ->> 'gender'), ''));
  v_level text := lower(nullif(btrim(p_roster ->> 'level'), ''));
  v_season text := nullif(btrim(p_roster ->> 'season'), '');
  v_has_color boolean := p_roster ? 'primary_color';
  v_color text := lower(nullif(btrim(p_roster ->> 'primary_color'), ''));
  v_players jsonb := coalesce(p_players, '[]'::jsonb);
  v_old_heard_as jsonb;
  v_old_storyline jsonb;
  v_roster_key text;
  v_roster_id uuid;
begin
  if v_owner is null then
    raise exception 'Sign in to save a roster.';
  end if;
  if v_school is null then
    raise exception 'Add the school name before saving.';
  end if;
  if v_sport is null then
    raise exception 'Pick a sport before saving.';
  end if;

  if jsonb_typeof(v_players) <> 'array' then
    raise exception 'The players did not arrive as a list. Reload the page and save again.';
  end if;
  if jsonb_array_length(v_players) > c_max_players then
    raise exception 'A roster can have at most % players. This one has %.', c_max_players, jsonb_array_length(v_players);
  end if;
  if char_length(v_school) > c_max_name_chars or char_length(coalesce(v_mascot, '')) > c_max_name_chars then
    raise exception 'Keep the school and the mascot to % characters or fewer.', c_max_name_chars;
  end if;
  if exists (
    select 1
    from jsonb_array_elements(v_players) as rows (entry)
    where char_length(coalesce(entry ->> 'first_name', '')) > c_max_name_chars
       or char_length(coalesce(entry ->> 'last_name', '')) > c_max_name_chars
  ) then
    raise exception 'Keep each player''s first and last name to % characters or fewer.', c_max_name_chars;
  end if;
  if exists (
    select 1
    from jsonb_array_elements(v_players) as rows (entry)
    where entry ? 'heard_as'
      -- A case, because "or" does not promise to stop before
      -- jsonb_array_length meets something that is not a list.
      and case
        when jsonb_typeof(entry -> 'heard_as') = 'null' then false
        when jsonb_typeof(entry -> 'heard_as') <> 'array' then true
        when jsonb_array_length(entry -> 'heard_as') > c_max_heard_as then true
        else exists (
          select 1
          from jsonb_array_elements(entry -> 'heard_as') as forms (form)
          where case
            when jsonb_typeof(form) <> 'string' then true
            else char_length(form #>> '{}') > c_max_heard_as_chars
          end
        )
      end
  ) then
    raise exception 'Each player can have at most % heard-as forms, each % characters or fewer.', c_max_heard_as, c_max_heard_as_chars;
  end if;
  if exists (
    select 1
    from jsonb_array_elements(v_players) as rows (entry)
    where jsonb_typeof(entry -> 'storyline') = 'string'
      and char_length(btrim(entry ->> 'storyline')) > c_max_storyline_chars
  ) then
    raise exception 'Keep each storyline to % characters or fewer.', c_max_storyline_chars;
  end if;
  -- The same shape the column's check takes, said in words rather than as a
  -- constraint violation.
  if v_has_color and v_color is not null and v_color !~ '^#[0-9a-f]{6}$' then
    raise exception 'The team colour must look like #1a2b3c.';
  end if;

  v_roster_key := lower(
    v_school || '|' || v_sport || '|' ||
    coalesce(v_gender, '') || '|' || coalesce(v_level, '') || '|' || coalesce(v_season, '')
  );

  if v_id is not null then
    if exists (select 1 from public.rosters where owner_id = v_owner and roster_key = v_roster_key and id <> v_id) then
      raise exception 'You already have a team with this school, sport, gender, level and season. Open that team instead, or change one of them.';
    end if;

    update public.rosters
       set school = v_school,
           mascot = v_mascot,
           sport = v_sport,
           gender = v_gender,
           level = v_level,
           season = v_season,
           roster_key = v_roster_key,
           primary_color = case when v_has_color then v_color else primary_color end,
           updated_at = now()
     where id = v_id and owner_id = v_owner
    returning id into v_roster_id;

    if v_roster_id is null then
      raise exception 'That team no longer exists.';
    end if;
  else
    -- One save at a time per account, so two tabs cannot both make the 61st team.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('save_roster:' || v_owner::text));
    if not exists (select 1 from public.rosters where owner_id = v_owner and roster_key = v_roster_key)
       and (select count(*) from public.rosters where owner_id = v_owner) >= c_max_rosters then
      raise exception 'You have % teams saved, the most Spotter keeps. Delete one you no longer call before adding another.', c_max_rosters;
    end if;

    insert into public.rosters as saved (owner_id, school, mascot, sport, gender, level, season, roster_key, primary_color)
    values (
      v_owner, v_school, v_mascot, v_sport, v_gender, v_level, v_season, v_roster_key,
      case when v_has_color then v_color else null end
    )
    on conflict (owner_id, roster_key) do update
      set school = excluded.school,
          mascot = excluded.mascot,
          sport = excluded.sport,
          gender = excluded.gender,
          level = excluded.level,
          season = excluded.season,
          primary_color = case when v_has_color then excluded.primary_color else saved.primary_color end,
          updated_at = now()
    returning id into v_roster_id;
  end if;

  -- Heard-as forms and storylines the players already have, by identity, for
  -- entries that do not say their own (an older client). Taken before the
  -- delete below. v_roster_id is the owner's (checked or inserted above).
  select coalesce(jsonb_object_agg(identity, forms), '{}'::jsonb)
    into v_old_heard_as
  from (
    select distinct on (public.roster_player_identity(last_name, jersey))
           public.roster_player_identity(last_name, jersey) as identity,
           to_jsonb(heard_as) as forms
    from public.roster_players
    where roster_id = v_roster_id and owner_id = v_owner and heard_as <> '{}'::text[]
    order by public.roster_player_identity(last_name, jersey), sort_order
  ) as old;

  select coalesce(jsonb_object_agg(identity, line), '{}'::jsonb)
    into v_old_storyline
  from (
    select distinct on (public.roster_player_identity(last_name, jersey))
           public.roster_player_identity(last_name, jersey) as identity,
           to_jsonb(storyline) as line
    from public.roster_players
    where roster_id = v_roster_id and owner_id = v_owner and storyline <> ''
    order by public.roster_player_identity(last_name, jersey), sort_order
  ) as old;

  delete from public.roster_players where roster_id = v_roster_id and owner_id = v_owner;

  insert into public.roster_players (
    roster_id, owner_id, sort_order, jersey, first_name, last_name,
    position, grade, height, weight, pronunciations, spoken_forms, spot_mode,
    season_stats, season_lines, stats_as_of, heard_as, storyline, season_values
  )
  select
    v_roster_id,
    v_owner,
    (ordinality - 1)::int,
    nullif(btrim(entry ->> 'jersey'), ''),
    nullif(btrim(entry ->> 'first_name'), ''),
    btrim(entry ->> 'last_name'),
    nullif(btrim(entry ->> 'position'), ''),
    nullif(btrim(entry ->> 'grade'), ''),
    nullif(btrim(entry ->> 'height'), ''),
    nullif(btrim(entry ->> 'weight'), ''),
    case
      when jsonb_typeof(entry -> 'pronunciations') = 'array'
        then array(select jsonb_array_elements_text(entry -> 'pronunciations'))
      else '{}'::text[]
    end,
    case
      when jsonb_typeof(entry -> 'spoken_forms') = 'array'
        then array(select jsonb_array_elements_text(entry -> 'spoken_forms'))
      else '{}'::text[]
    end,
    -- An unknown value fails the check constraint, and with it the whole save.
    coalesce(lower(nullif(btrim(entry ->> 'spot_mode'), '')), 'normal'),
    public.clean_season_stats(entry -> 'season_stats'),
    case
      when jsonb_typeof(entry -> 'season_lines') = 'array'
        then array(select jsonb_array_elements_text(entry -> 'season_lines'))
      else '{}'::text[]
    end,
    nullif(btrim(entry ->> 'stats_as_of'), '')::date,
    case
      when jsonb_typeof(entry -> 'heard_as') = 'null'
        then '{}'::text[]
      when entry ? 'heard_as'
        then array(
          select btrim(form)
          from jsonb_array_elements_text(entry -> 'heard_as') as forms (form)
          where btrim(form) <> ''
        )
      when v_old_heard_as ? public.roster_player_identity(btrim(entry ->> 'last_name'), nullif(btrim(entry ->> 'jersey'), ''))
        then array(
          select jsonb_array_elements_text(
            v_old_heard_as -> public.roster_player_identity(btrim(entry ->> 'last_name'), nullif(btrim(entry ->> 'jersey'), ''))
          )
        )
      else '{}'::text[]
    end,
    case
      when jsonb_typeof(entry -> 'storyline') = 'string'
        then btrim(entry ->> 'storyline')
      when entry ? 'storyline'
        -- Sent as null (or anything that is not text): cleared.
        then ''
      else coalesce(
        v_old_storyline ->> public.roster_player_identity(btrim(entry ->> 'last_name'), nullif(btrim(entry ->> 'jersey'), '')),
        ''
      )
    end,
    -- Volleyball's labelled values (0020). Football never sends them, so its
    -- players keep null, which is what they had before the column existed.
    public.clean_season_values(entry -> 'season_values')
  from jsonb_array_elements(v_players) with ordinality as rows (entry, ordinality)
  where nullif(btrim(entry ->> 'last_name'), '') is not null;

  return v_roster_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- set_season_stats: 0002's, writing season_values from each entry's values.
-- ---------------------------------------------------------------------------
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
           end as lines,
           public.clean_season_values(entry -> 'values') as season_values
    from jsonb_array_elements(v_entries) as rows (entry)
  )
  update public.roster_players p
     set season_stats = w.stats,
         season_lines = w.lines,
         season_values = w.season_values,
         stats_as_of = v_as_of
    from wanted w
   where p.roster_id = p_roster_id and p.id = w.player_id;

  get diagnostics v_matched = row_count;

  update public.roster_players
     set season_stats = null,
         season_lines = '{}'::text[],
         season_values = null,
         stats_as_of = null
   where roster_id = p_roster_id
     and (season_stats is not null or season_lines <> '{}'::text[] or season_values is not null or stats_as_of is not null)
     and id not in (
       select (entry ->> 'id')::uuid
       from jsonb_array_elements(v_entries) as rows (entry)
       where entry ->> 'id' is not null
     );

  update public.rosters set updated_at = now() where id = p_roster_id;

  return v_matched;
end;
$$;
