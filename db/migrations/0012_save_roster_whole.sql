-- One save, one transaction (V3's pre-launch audit M12, with M4's roster
-- caps), and a storyline per player. From V3's
--   20261007060100_v3_save_roster_whole.sql
--   20261007203248_v3_player_storyline.sql
--
-- save_roster keeps 0002's signature, save_roster(p_owner, p_roster,
-- p_players), and now also takes, in the same call and the same transaction:
--
--   p_roster.primary_color   "#rrggbb" or null. Only when the key is present:
--                            a client that does not send it leaves the
--                            team's colour as it was.
--   p_players[].heard_as     text[]. Only when the key is present: an entry
--                            without it keeps the forms the same player had
--                            (same surname and jersey, the identity a
--                            re-import keys by, playerIdentity in
--                            lib/rosters/identity.ts), instead of the empty
--                            column a delete and insert would leave.
--   p_players[].storyline    text, at most 80 characters. Only when the key is
--                            present, the same way: an entry without it keeps
--                            the same player's storyline. V3's save_roster did
--                            not know the column and V3's editor wrote it with
--                            a second update after the save (rewriteAfterSave);
--                            here it is part of the one transaction, so that
--                            second write is not needed.
--
-- And it refuses, with a sentence for the announcer, a roster over 300
-- players, a school, mascot or player name over 80 characters, more than 8
-- heard-as forms on a player or one over 40 characters (MAX_HEARD_AS_FORMS and
-- MAX_HEARD_AS_LENGTH in lib/rosters/heardAs.ts), a storyline over 80
-- characters (MAX_STORYLINE_CHARS in lib/cards/cardFace.ts), and a 61st team.
-- Saving over a team the owner already has is never refused by the team cap.
--
-- set_season_stats is unchanged: V3 never changed it, and the int_td and fr_td
-- keys it now keeps come from clean_season_stats (0006).

-- ---------------------------------------------------------------------------
-- 20261007203248: one short line about the player, shown under the name on
-- the card. Empty means none.
-- ---------------------------------------------------------------------------
alter table roster_players
  add column storyline text not null default ''
  constraint roster_players_storyline_length check (char_length(storyline) <= 80);

comment on column roster_players.storyline is
  'One short line about the player, shown under the name on the card. At most 80 characters; empty means none.';

-- ---------------------------------------------------------------------------
-- The surname and jersey as lib/rosters/identity.ts writes them: each word of
-- the surname folded to a to z (accents dropped, a possessive 's dropped), the
-- words joined, then "|" and the jersey without a leading "#".
-- ---------------------------------------------------------------------------
create function public.roster_player_identity(p_last_name text, p_jersey text)
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce((
           select string_agg(
                    regexp_replace(
                      regexp_replace(lower(normalize(word, NFD)), '[''’]s$', ''),
                      '[^a-z]', '', 'g'
                    ),
                    '' order by n
                  )
           from regexp_split_to_table(coalesce(p_last_name, ''), '\s+') with ordinality as words (word, n)
         ), '')
         || '|'
         || regexp_replace(btrim(coalesce(p_jersey, '')), '^#', '');
$$;

-- p_owner: the signed-in user's id, from the session. Every lookup is scoped
-- by it, which is what row level security did in V3.
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
    season_stats, season_lines, stats_as_of, heard_as, storyline
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
    end
  from jsonb_array_elements(v_players) with ordinality as rows (entry, ordinality)
  where nullif(btrim(entry ->> 'last_name'), '') is not null;

  return v_roster_id;
end;
$$;
