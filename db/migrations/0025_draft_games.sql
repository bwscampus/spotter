-- Draft games (Nov 3, Jed): a game set up but not started, kept in the
-- account so it can be prepped on one computer and started on another.
--
-- A draft is a called_games row with status 'draft'. Starting it turns that
-- same row into the live game (status 'live', started_at now, the schools and
-- sport copied in at Start, as a game started from setup always was), so the
-- draft's id becomes the game's id and there is never a second row. End game
-- sets 'ended'.
--
-- A draft points at the two teams and never copies a player: Start builds the
-- game from the rosters as they are then, so a roster or stats edit made after
-- the draft was saved is what the game uses.
--
-- PRIVACY, unchanged: nothing here says who was spotted. A draft holds a date,
-- up to two roster ids, a sport, what each side is wearing ("white"), and
-- whether to share the game's log. No player names, no player ids.

alter table called_games
  -- 'live' by default, so a replica still running the code before this
  -- migration keeps inserting games that are not drafts.
  add column status text not null default 'live',
  add column game_date date,
  add column wearing_home text check (char_length(wearing_home) <= 40),
  add column wearing_away text check (char_length(wearing_away) <= 40),
  add column share_log boolean not null default true;

-- Every game so far: still open (never ended) is live, the rest ended.
update called_games set status = case when ended_at is null then 'live' else 'ended' end;

alter table called_games
  add constraint called_games_status_check check (status in ('draft', 'live', 'ended')),
  -- A draft has not started; the existing insert path keeps now() as its default.
  alter column started_at drop not null,
  -- A draft can be missing either team.
  alter column home_school drop not null,
  alter column away_school drop not null,
  add constraint called_games_started_check check (
    status = 'draft' or (started_at is not null and home_school is not null and away_school is not null)
  ),
  add constraint called_games_draft_check check (
    status <> 'draft' or (game_date is not null and started_at is null and ended_at is null)
  ),
  add constraint called_games_ended_check check (status <> 'ended' or ended_at is not null),
  -- A draft's two sides are two different teams (setup refuses the same team twice too).
  add constraint called_games_draft_teams_check check (
    status <> 'draft' or home_roster_id is null or away_roster_id is null or home_roster_id <> away_roster_id
  );

-- "My drafts, soonest first" (lib/server/repo/games.ts listDrafts).
create index called_games_owner_drafts_idx on called_games (owner_id, game_date) where status = 'draft';

-- Drafts more than 14 days past their date and never started. Run once a day
-- by lib/server/housekeeping.ts; deleting what is already gone is a no-op.
create function public.delete_stale_drafts()
returns void
language sql
set search_path = ''
as $$
  delete from public.called_games where status = 'draft' and game_date < current_date - 14;
$$;
