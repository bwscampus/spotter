-- A team's season schedule (Oct 28): the games it has played and has still to
-- play, imported on the Team page's Schedule screen and shown in the live
-- screen's team panel (docs/PANEL_SPEC.md). One team has many games, and
-- deleting the team deletes its games.
--
-- Written only through set_schedule, which replaces the team's whole schedule
-- in one transaction, so saving the same schedule twice leaves one copy of it.
-- Like every owner's table here, the app scopes reads by owner_id
-- (lib/server/repo/schedule.ts), and the composite foreign key makes the
-- database refuse a game under another owner's team.

create table schedule_games (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null,
  owner_id uuid not null references users (id) on delete cascade,
  -- A calendar date: no time and no time zone, so nothing can move it a day.
  game_date date not null,
  opponent text not null check (char_length(btrim(opponent)) between 1 and 100),
  -- H home, A away, N a neutral site.
  site text not null check (site in ('H', 'A', 'N')),
  -- This team's score and the opponent's. Null: not played yet. Both or neither.
  team_score int check (team_score between 0 and 999),
  opponent_score int check (opponent_score between 0 and 999),
  is_league boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((team_score is null) = (opponent_score is null)),
  -- A game belongs to a team of the same owner, or the row is refused.
  foreign key (team_id, owner_id) references rosters (id, owner_id) on delete cascade
);

create index schedule_games_team_idx on schedule_games (team_id, game_date);
create index schedule_games_owner_id_idx on schedule_games (owner_id);

comment on table schedule_games is
  'A team''s season schedule: one row a game. Written only by set_schedule, which replaces the team''s whole list.';

-- Replaces p_team_id's schedule with p_games.
--
-- p_games: [{ game_date: "YYYY-MM-DD", opponent: text, site: "H"|"A"|"N",
--             team_score: int|null, opponent_score: int|null, is_league: bool }]
-- p_owner is the signed-in user's id, from the session, never the request.
-- Returns how many games the team now has. A bad entry fails the whole save
-- with the table's own check, so a half-saved schedule is impossible.
create function public.set_schedule(p_owner uuid, p_team_id uuid, p_games jsonb)
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_entries jsonb := case when jsonb_typeof(p_games) = 'array' then p_games else '[]'::jsonb end;
  v_saved int;
begin
  if p_owner is null then
    raise exception 'Sign in to save a schedule.';
  end if;

  if not exists (select 1 from public.rosters where id = p_team_id and owner_id = p_owner) then
    raise exception 'That team no longer exists.';
  end if;

  if jsonb_array_length(v_entries) > 80 then
    raise exception 'A schedule has at most 80 games.';
  end if;

  delete from public.schedule_games where team_id = p_team_id and owner_id = p_owner;

  insert into public.schedule_games (team_id, owner_id, game_date, opponent, site, team_score, opponent_score, is_league)
  select p_team_id,
         p_owner,
         (entry ->> 'game_date')::date,
         btrim(entry ->> 'opponent'),
         entry ->> 'site',
         (entry ->> 'team_score')::int,
         (entry ->> 'opponent_score')::int,
         coalesce((entry ->> 'is_league')::boolean, false)
  from jsonb_array_elements(v_entries) as rows (entry);

  get diagnostics v_saved = row_count;

  update public.rosters set updated_at = now() where id = p_team_id;

  return v_saved;
end;
$$;
