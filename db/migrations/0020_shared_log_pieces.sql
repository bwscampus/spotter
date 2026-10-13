-- Shared game logs in pieces (Jed, Oct 12: collect game logs for product
-- improvement, kept a year). Until now a log was shared once, whole, at End
-- game, so a closed tab, a crash or a game never ended sent nothing, and a log
-- over 6 million characters lost its interim results. Now the browser sends
-- the scrubbed log in pieces as the game goes (lib/log/sharePieces.ts), each
-- one written here by share_game_log_piece().
--
-- A share is one row in shared_game_logs, the header, found by share_id: a
-- random id the browser makes for the game, never the game id, so a share
-- still cannot be joined to called_games, an account or a school. Its pieces
-- are rows in shared_game_log_pieces and go when the header goes (expiry,
-- delete_my_account, both unchanged: they delete headers by owner_hash and
-- expires_at). A share made before this has no share_id and its whole log in
-- log_gz_b64, as before.
--
-- PRIVACY is as 0008: what lands here is scrubbed in the browser
-- (lib/log/scrub.ts), there is no owner id or game id, and only the database
-- owner reads it. New shares are kept 365 days; rows already shared keep the
-- 90 days they were shared under.
--
-- TUNING (each also named where it is enforced below):
--   365 days kept                  shared_game_logs.expires_at default
--   20 shares per account a day    limit_shared_game_logs()
--   300 pieces per share           shared_game_log_pieces.part
--   2,000,000 characters a piece   shared_game_log_pieces.log_gz_b64
--   60,000,000 characters a share  share_game_log_piece()

alter table shared_game_logs alter column expires_at set default now() + interval '365 days';

-- A header row holds no log of its own; its pieces do.
alter table shared_game_logs alter column log_gz_b64 drop not null;

alter table shared_game_logs
  add column share_id uuid unique,
  -- The build that wrote the log (NEXT_PUBLIC_GIT_COMMIT), so a failure can be tied to its code.
  add column app_commit text check (app_commit is null or app_commit ~ '^[0-9a-f]{7,40}$'),
  -- Settings and environment, no names: lib/log/sharePieces.ts says what. Small by construction.
  add column header jsonb check (header is null or (jsonb_typeof(header) = 'object' and pg_column_size(header) <= 8192)),
  -- The game's counts at End game (lib/game/liveCounts.ts), as game.ended has them.
  add column counts jsonb check (counts is null or (jsonb_typeof(counts) = 'object' and pg_column_size(counts) <= 8192)),
  -- The end-of-game card's rating and chips, never its note.
  add column rating smallint check (rating between 1 and 5),
  add column blockers text[] check (
    blockers <@ array[
      'wrong_names', 'missing_names', 'slow', 'stats_wrong', 'stats_missing',
      'too_much_on_screen', 'nothing'
    ]::text[]
  ),
  -- End game reached this share; one that never does was a closed tab or a crash.
  add column complete boolean not null default false,
  add column pieces int not null default 0 check (pieces between 0 and 300),
  -- Characters stored, whole log or pieces: what the admin view and the size cap count.
  add column chars bigint not null default 0 check (chars >= 0),
  add constraint shared_game_logs_whole_or_pieces check (log_gz_b64 is not null or share_id is not null);

update shared_game_logs set chars = char_length(log_gz_b64) where log_gz_b64 is not null;

comment on table shared_game_logs is
  'Scrubbed game logs shared while the setup switch is on: a whole log (before Oct 12) or a share header whose log is in shared_game_log_pieces. Last names kept as said and as spelled; first names and schools replaced by tags; times relative; no audio; no owner, game or school id. Deleted after 365 days (90 for rows shared before Oct 12). Read only as the database owner.';

create table shared_game_log_pieces (
  share_id uuid not null references shared_game_logs (share_id) on delete cascade,
  -- 0, 1, 2, ... in the order the browser cut them. TUNING: at most 300.
  part int not null check (part between 0 and 299),
  created_at timestamptz not null default now(),
  records int not null check (records >= 0),
  masked int not null default 0 check (masked >= 0),
  -- The piece's scrubbed records as JSON, gzipped and base64 encoded in the browser. TUNING: 2,000,000.
  log_gz_b64 text not null check (char_length(log_gz_b64) between 1 and 2000000),
  primary key (share_id, part)
);

comment on table shared_game_log_pieces is
  'One piece of a shared game log (shared_game_logs.share_id), scrubbed in the browser. Goes with its header. Read only as the database owner.';

-- TUNING: 20 shares per account in any 24 hours (was 5). A share is its
-- header row, however many pieces it has.
create or replace function public.limit_shared_game_logs()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (
    select count(*) from public.shared_game_logs
    where owner_hash = new.owner_hash and created_at > now() - interval '24 hours'
  ) >= 20 then
    raise exception 'shared_log_daily_limit' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- The owner checks every shared-log function makes. Raises 42501 'signed_out'
-- with no owner and 42501 'not_approved' for a switched-off account.
create function public.shared_log_owner_ok(p_owner uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_owner is null then
    raise exception 'signed_out' using errcode = '42501';
  end if;
  if not coalesce((select u.approved from public.users u where u.id = p_owner), false) then
    raise exception 'not_approved' using errcode = '42501';
  end if;
end;
$$;

-- Writes one piece of p_owner's share p_share_id, making the share's header
-- on its first piece (whichever part arrives first). Sending the same part
-- again replaces it, so a retry after a reload is harmless. p_app_commit and
-- p_header are kept when given and never cleared.
--
-- Refuses with:
--   42501 'signed_out' / 'not_approved'   as shared_log_owner_ok
--   P0002 'share_not_found'               the share is another account's
--   P0001 'shared_log_daily_limit'        a 21st share inside 24 hours (the trigger)
--   P0001 'shared_log_too_large'          the share would pass 60,000,000 characters
--   23514                                 a value outside a check (part, size, ...)
create function public.share_game_log_piece(
  p_owner uuid,
  p_share_id uuid,
  p_part int,
  p_sport text,
  p_stats_enabled boolean,
  p_scrub_version int,
  p_records int,
  p_masked int,
  p_log_gz_b64 text,
  p_app_commit text,
  p_header jsonb
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_hash text := public.shared_log_owner_hash(p_owner);
  v_owner text;
  v_chars bigint;
  v_old_chars bigint := 0;
  v_old_records int := 0;
  v_old_masked int := 0;
  v_new_part boolean;
begin
  perform public.shared_log_owner_ok(p_owner);
  if p_share_id is null then
    raise exception 'share_not_found' using errcode = 'P0002';
  end if;

  -- One write at a time per account: the daily limit and the size cap count rows.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('share_game_log:' || p_owner::text));

  select l.owner_hash, l.chars into v_owner, v_chars
  from public.shared_game_logs l where l.share_id = p_share_id for update;

  if not found then
    insert into public.shared_game_logs (
      share_id, sport, stats_enabled, scrub_version, records, masked, owner_hash, app_commit, header
    )
    values (
      p_share_id, p_sport, coalesce(p_stats_enabled, false), p_scrub_version, 0, 0, v_hash, p_app_commit, p_header
    );
    v_chars := 0;
  elsif v_owner <> v_hash then
    raise exception 'share_not_found' using errcode = 'P0002';
  end if;

  select char_length(p.log_gz_b64), p.records, p.masked into v_old_chars, v_old_records, v_old_masked
  from public.shared_game_log_pieces p where p.share_id = p_share_id and p.part = p_part;
  v_new_part := not found;
  if v_new_part then
    v_old_chars := 0;
    v_old_records := 0;
    v_old_masked := 0;
  end if;

  -- TUNING: 60,000,000 characters a share.
  if v_chars - v_old_chars + char_length(p_log_gz_b64) > 60000000 then
    raise exception 'shared_log_too_large' using errcode = 'P0001';
  end if;

  insert into public.shared_game_log_pieces (share_id, part, records, masked, log_gz_b64)
  values (p_share_id, p_part, p_records, coalesce(p_masked, 0), p_log_gz_b64)
  on conflict (share_id, part) do update
    set records = excluded.records, masked = excluded.masked, log_gz_b64 = excluded.log_gz_b64, created_at = now();

  update public.shared_game_logs l
  set pieces = l.pieces + case when v_new_part then 1 else 0 end,
      records = l.records - v_old_records + p_records,
      masked = l.masked - v_old_masked + coalesce(p_masked, 0),
      chars = l.chars - v_old_chars + char_length(p_log_gz_b64),
      app_commit = coalesce(p_app_commit, l.app_commit),
      header = coalesce(p_header, l.header)
  where l.share_id = p_share_id;
end;
$$;

-- End game reached p_owner's share: marks it complete and keeps the game's
-- counts. P0002 'share_not_found' when it is not p_owner's (or not there).
create function public.finish_shared_log(p_owner uuid, p_share_id uuid, p_counts jsonb)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform public.shared_log_owner_ok(p_owner);
  update public.shared_game_logs l
  set complete = true, counts = coalesce(p_counts, l.counts)
  where l.share_id = p_share_id and l.owner_hash = public.shared_log_owner_hash(p_owner);
  if not found then
    raise exception 'share_not_found' using errcode = 'P0002';
  end if;
end;
$$;

-- The end-of-game card's rating and chips on p_owner's share (never the
-- note). P0002 'share_not_found' when it is not p_owner's (or not there).
create function public.rate_shared_log(p_owner uuid, p_share_id uuid, p_rating smallint, p_blockers text[])
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform public.shared_log_owner_ok(p_owner);
  update public.shared_game_logs l
  set rating = p_rating, blockers = coalesce(p_blockers, '{}')
  where l.share_id = p_share_id and l.owner_hash = public.shared_log_owner_hash(p_owner);
  if not found then
    raise exception 'share_not_found' using errcode = 'P0002';
  end if;
end;
$$;

-- What is being collected, a row per day and kind of game. Read as the
-- database owner; the app's role has no rights on the admin schema.
create view admin.shared_logs_summary as
select
  (l.created_at at time zone 'UTC')::date as day,
  l.sport,
  l.stats_enabled,
  l.scrub_version,
  count(*)::int as shares,
  count(*) filter (where l.complete)::int as completed,
  coalesce(sum(l.pieces), 0)::int as pieces,
  coalesce(sum(l.records), 0)::bigint as records,
  round(coalesce(sum(l.chars), 0) / 1e6, 1) as million_chars,
  count(l.rating)::int as rated,
  round(avg(l.rating), 2) as average_rating,
  min(l.expires_at) as first_expires
from public.shared_game_logs l
group by 1, 2, 3, 4
order by 1 desc, 2, 3, 4;
