-- Rosters: a team and its players, private to the account that saved them.
--
-- V3's tables (JedSandler/Spotter supabase/migrations 20260928205542 and
-- 20260928214842) without Supabase's auth schema or row level security. The
-- app's queries scope every read and write by owner (lib/server/repo/), and the
-- composite foreign keys below make the database refuse a player under someone
-- else's roster, which V3's policies did with exists() checks.
--
-- Writes go through save_roster and set_season_stats, so a half-saved roster is
-- impossible. Both take the owner explicitly; the caller passes the signed-in
-- user's id from the session, never from the request.

create table rosters (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users (id) on delete cascade,
  school text not null,
  mascot text,
  sport text not null check (
    sport in (
      'volleyball', 'football', 'basketball', 'soccer', 'baseball',
      'softball', 'water_polo', 'lacrosse', 'other'
    )
  ),
  gender text check (gender in ('boys', 'girls', 'coed')),
  level text check (level in ('varsity', 'jv', 'freshman')),
  season text,
  -- Lowercased school|sport|gender|level|season, built in save_roster.
  -- Re-importing the same team replaces its roster instead of adding a second one.
  roster_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Also the index every "my rosters" query uses, since owner_id leads.
  unique (owner_id, roster_key),
  -- Target of the composite foreign keys that pin children to the same owner.
  unique (id, owner_id)
);

create table roster_players (
  id uuid primary key default gen_random_uuid(),
  roster_id uuid not null,
  owner_id uuid not null references users (id) on delete cascade,
  sort_order int not null,
  -- Text, not int: "0" and "00" are different jerseys.
  jersey text,
  first_name text,
  -- The full surname as printed on the roster.
  last_name text not null,
  position text,
  grade text,
  height text,
  weight text,
  -- Typed by hand ("oh-soo-EH-tuh"). Kept apart from spoken_forms so editing a
  -- surname, which rebuilds the derived forms, never throws them away.
  pronunciations text[] not null default '{}',
  -- Normalized forms the matcher compares against, built in the browser.
  spoken_forms text[] not null default '{}',
  -- off: saved and can be credited with stats, but never puts a card up.
  -- exact_only: near-sound matches for this player are dropped.
  spot_mode text not null default 'normal' check (spot_mode in ('normal', 'exact_only', 'off')),
  -- Football: numbers keyed by the stat keys in docs/V3_DEFINITION.md 9.2, so
  -- tonight's plays can add to them. Other sports use season_lines.
  season_stats jsonb check (season_stats is null or jsonb_typeof(season_stats) = 'object'),
  season_lines text[] not null default '{}',
  stats_as_of date,
  -- A player belongs to a roster of the same owner, or the row is refused.
  foreign key (roster_id, owner_id) references rosters (id, owner_id) on delete cascade
);

create index roster_players_roster_id_idx on roster_players (roster_id);
create index roster_players_owner_id_idx on roster_players (owner_id);

-- Keeps only the football stat keys in docs/V3_DEFINITION.md 9.2, and only
-- when the value is a number. Numbers have to be numbers so tonight's plays
-- can add to them; anything else is dropped rather than failing the save.
-- An empty result is null, which the card treats as "no season stats".
create function public.clean_season_stats(p_stats jsonb)
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
          'int_ret_yds', 'pbu', 'ff', 'fr', 'fr_ret_yds', 'fum', 'fum_lost', 'kr', 'kr_yds',
          'kr_td', 'pr', 'pr_yds', 'pr_td', 'fgm', 'fga', 'fg_long', 'xpm', 'xpa', 'punts',
          'punt_yds'
        ])
    )
  end
$$;

-- Saves a whole roster in one transaction: upsert the roster, drop its old
-- players, insert the new ones. A failed insert rolls the delete back, so a
-- half-saved roster is impossible.
--
-- p_owner: the signed-in user's id, from the session.
-- p_roster: { id?, school, mascot, sport, gender, level, season }
-- p_players: [{ jersey, first_name, last_name, position, grade, height, weight,
--   pronunciations: [text], spoken_forms: [text], spot_mode,
--   season_stats: {key: number}, season_lines: [text], stats_as_of: "YYYY-MM-DD" }]
--
-- Without an id it matches by roster_key, so importing the same team again
-- replaces its roster. With the id of a team the owner already has, that team is
-- renamed in place; renaming onto another saved team is refused rather than
-- silently merging the two. Every lookup is scoped by p_owner, which is what
-- row level security did in V3.
create function public.save_roster(p_owner uuid, p_roster jsonb, p_players jsonb)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_owner uuid := p_owner;
  v_id uuid := nullif(btrim(p_roster ->> 'id'), '')::uuid;
  v_school text := nullif(btrim(p_roster ->> 'school'), '');
  v_mascot text := nullif(btrim(p_roster ->> 'mascot'), '');
  v_sport text := lower(nullif(btrim(p_roster ->> 'sport'), ''));
  v_gender text := lower(nullif(btrim(p_roster ->> 'gender'), ''));
  v_level text := lower(nullif(btrim(p_roster ->> 'level'), ''));
  v_season text := nullif(btrim(p_roster ->> 'season'), '');
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
           updated_at = now()
     where id = v_id and owner_id = v_owner
    returning id into v_roster_id;

    if v_roster_id is null then
      raise exception 'That team no longer exists.';
    end if;
  else
    insert into public.rosters (owner_id, school, mascot, sport, gender, level, season, roster_key)
    values (v_owner, v_school, v_mascot, v_sport, v_gender, v_level, v_season, v_roster_key)
    on conflict (owner_id, roster_key) do update
      set school = excluded.school,
          mascot = excluded.mascot,
          sport = excluded.sport,
          gender = excluded.gender,
          level = excluded.level,
          season = excluded.season,
          updated_at = now()
    returning id into v_roster_id;
  end if;

  delete from public.roster_players where roster_id = v_roster_id;

  insert into public.roster_players (
    roster_id, owner_id, sort_order, jersey, first_name, last_name,
    position, grade, height, weight, pronunciations, spoken_forms, spot_mode,
    season_stats, season_lines, stats_as_of
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
    nullif(btrim(entry ->> 'stats_as_of'), '')::date
  from jsonb_array_elements(coalesce(p_players, '[]'::jsonb)) with ordinality as rows (entry, ordinality)
  where nullif(btrim(entry ->> 'last_name'), '') is not null;

  return v_roster_id;
end;
$$;

-- Attaches season stats to a roster that already exists. Narrow on purpose: it
-- only writes season_stats, season_lines and stats_as_of, so a stats import can
-- never disturb a name, a jersey or a spotting setting that was reviewed.
--
-- p_stats: { as_of: "YYYY-MM-DD" | null,
--            players: [{ id: uuid, stats: {key: number}, lines: [text] }] }
-- p_owner is the signed-in user's id, from the session.
-- Every entry carries a player id: the caller matches stats to players first.
-- A new import replaces the old numbers, so players not named are cleared
-- rather than left showing last week's.
create function public.set_season_stats(p_owner uuid, p_roster_id uuid, p_stats jsonb)
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
