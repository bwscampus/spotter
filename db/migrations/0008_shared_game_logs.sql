-- Scrubbed game logs people choose to share (Jed, Oct 5): so the failure
-- points of a real game can be read. On by default at game setup, off with one
-- click, and a copy only leaves the browser at End game. From V3's
--   20261005235549_v3_shared_game_logs.sql      the table and the 90-day expiry
--   20261006045051_v3_shared_game_logs_comment.sql  what a row holds
--   20261007051643_v3_shared_logs_owner_hash.sql    owner_hash
--   20261007052059_v3_shared_logs_limits.sql        6 million characters, 5 a day
--
-- PRIVACY: a log is a recording of somebody naming minors, so what lands here
-- is a copy scrubbed in the browser (lib/log/scrub.ts): last names kept, first
-- names and schools replaced by roster tags, times relative, no audio. There is
-- deliberately NO owner id and no game id: a row cannot be joined back to an
-- account, a game or a school. owner_hash is a sha256 of the sharer's user id,
-- so delete_my_account (0011) can find one account's logs and the daily limit
-- can count them, while reading a row still names nobody.
--
-- WRITES go through public.share_game_log(p_owner, ...) below, which checks the
-- account is approved (V3's insert policy), works out owner_hash on the server
-- (V3's column default read auth.uid()) and inserts. Nothing in the app reads
-- the table; it is read as the database owner.
--
-- EXPIRY: V3 deleted expired rows with a nightly pg_cron job. Railway Postgres
-- has no pg_cron, so public.delete_expired_shared_logs() is a plain function
-- the app or a Railway cron calls once a day.

create table shared_game_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '90 days',
  sport text check (
    sport in (
      'volleyball', 'football', 'basketball', 'soccer', 'baseball',
      'softball', 'water_polo', 'lacrosse', 'other'
    )
  ),
  stats_enabled boolean not null default false,
  -- Which version of the scrub made this copy (lib/log/scrub.ts SCRUB_VERSION).
  scrub_version int not null check (scrub_version >= 1),
  records int not null check (records >= 0),
  -- Strings that had a name masked in them.
  masked int not null default 0 check (masked >= 0),
  -- Interim results left out, because the whole log was too big to send.
  interims_dropped boolean not null default false,
  -- The scrubbed log as JSON, gzipped and base64 encoded in the browser.
  -- lib/log/shareLog.ts MAX_SHARE_CHARS: the browser never sends more.
  log_gz_b64 text not null constraint shared_game_logs_log_gz_b64_check
    check (char_length(log_gz_b64) between 1 and 6000000),
  -- public.shared_log_owner_hash(owner). V3 let rows from before Oct 7 keep a
  -- null here; this table starts empty, so every row has one.
  owner_hash text not null check (owner_hash ~ '^[0-9a-f]{64}$')
);

create index shared_game_logs_expires_idx on shared_game_logs (expires_at);
create index shared_game_logs_owner_idx on shared_game_logs (owner_hash, created_at);

comment on table shared_game_logs is
  'Scrubbed game logs shared at End game while the setup switch is on. Last names kept as said and as spelled, with every way Deepgram wrote them and each player''s pronunciation note; first names and schools replaced by roster tags; times relative; no audio; no owner, game or school id. Deleted after 90 days. Read only as the database owner.';

-- The one way an account's id becomes owner_hash: sha256 of the id as text, in
-- hex. Exactly V3's column default, so the two hash the same account the same.
create function public.shared_log_owner_hash(p_owner uuid)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(p_owner::text, 'UTF8')), 'hex')
$$;

-- At most 5 shared logs per account in any 24 hours (V3's trigger). On the
-- table, so it holds however a row arrives.
create function public.limit_shared_game_logs()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (
    select count(*) from public.shared_game_logs
    where owner_hash = new.owner_hash and created_at > now() - interval '24 hours'
  ) >= 5 then
    raise exception 'shared_log_daily_limit' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger shared_game_logs_daily_limit
  before insert on shared_game_logs
  for each row execute function public.limit_shared_game_logs();

-- Shares one scrubbed log for p_owner (the signed-in user's id, from the
-- session). The columns are the ones V3 granted the browser to insert; id,
-- created_at, expires_at and owner_hash are the database's.
--
-- Refuses, as V3 did, with:
--   42501 'signed_out'             no owner
--   42501 'not_approved'           the account is switched off (V3's policy)
--   P0001 'shared_log_daily_limit' a 6th log inside 24 hours (the trigger)
--   23514                          a value outside a check (too big a log, ...)
-- Returns the new row's id.
create function public.share_game_log(
  p_owner uuid,
  p_sport text,
  p_stats_enabled boolean,
  p_scrub_version int,
  p_records int,
  p_masked int,
  p_interims_dropped boolean,
  p_log_gz_b64 text
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_owner is null then
    raise exception 'signed_out' using errcode = '42501';
  end if;
  if not coalesce((select u.approved from public.users u where u.id = p_owner), false) then
    raise exception 'not_approved' using errcode = '42501';
  end if;

  -- One share at a time per account, so two at once cannot both be the 5th.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('share_game_log:' || p_owner::text));

  insert into public.shared_game_logs (
    sport, stats_enabled, scrub_version, records, masked, interims_dropped, log_gz_b64, owner_hash
  )
  values (
    p_sport,
    coalesce(p_stats_enabled, false),
    p_scrub_version,
    p_records,
    coalesce(p_masked, 0),
    coalesce(p_interims_dropped, false),
    p_log_gz_b64,
    public.shared_log_owner_hash(p_owner)
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- Deletes logs past their 90 days. Call once a day (the app or a Railway cron);
-- V3 ran it from pg_cron at 09:17 UTC. Same name and return as V3's.
create function public.delete_expired_shared_logs()
returns void
language sql
set search_path = ''
as $$
  delete from public.shared_game_logs where expires_at < now();
$$;
