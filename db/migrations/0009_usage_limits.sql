-- Spend limits and cost per user (V3's docs/PRE_LAUNCH_AUDIT.md B1, H1, H15,
-- M1). From V3's 20261007043948_v3_usage_limits.sql.
--
-- Every paid route (Deepgram token, keyterm check, live stats, roster import,
-- stats import) calls usage_begin right after its sign-in check
-- (lib/server/usage.ts). It either refuses (too fast, or a daily cap is
-- reached) or writes a reservation row and hands the route its id and a nonce.
-- When the call to Anthropic, OpenRouter or Deepgram is over, the route calls
-- usage_finish with the real token counts and a cost worked out on the server.
-- The nonce goes from the database to the route and back, never to the
-- browser.
--
-- Both functions take the owner explicitly (p_owner: the signed-in user's id,
-- from the session), where V3 read auth.uid(); their return shapes are V3's,
-- which lib/usage/limits.ts parses.
--
-- PRIVACY: counts, codes and dollars only. No request or reply content, no
-- file, no transcript, no player name.
--
-- WHO READS IT: admin.usage_by_user (below), as the database owner. The app
-- only goes through the two functions.

create table usage (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users (id) on delete cascade,
  at timestamptz not null default now(),
  route text not null check (
    route in ('deepgram_token', 'deepgram_keyterms', 'livestats', 'roster_import', 'stats_import')
  ),
  -- Handed to the route only. usage_finish needs it, so nothing that did not
  -- reserve a row can finish (or rewrite) it.
  nonce uuid not null default gen_random_uuid(),
  finished_at timestamptz,
  ok boolean,
  provider text check (provider is null or char_length(provider) <= 40),
  input_tokens int check (input_tokens is null or input_tokens >= 0),
  output_tokens int check (output_tokens is null or output_tokens >= 0),
  cached_tokens int check (cached_tokens is null or cached_tokens >= 0),
  cost_usd numeric(10, 5) check (cost_usd is null or cost_usd >= 0),
  ms int check (ms is null or ms >= 0)
);

-- "This owner's calls on this route, newest first" (the rate limits) and
-- "everything today" (the caps and the admin view).
create index usage_owner_route_at_idx on usage (owner_id, route, at desc);
create index usage_at_idx on usage (at);

-- ---------------------------------------------------------------------------
-- usage_begin: may this account make this call now? Refuses without writing
-- anything, or reserves a row and returns its id and nonce.
--
-- Returns one of
--   {"ok": true,  "id": <uuid>, "nonce": <uuid>}
--   {"ok": false, "code": "rate_limited" | "daily_cap" | "global_cap"
--                        | "signed_out" | "not_approved" | "unknown_route",
--    "retry_after_s": <int>}
--
-- not_approved: the account is switched off (users.approved = false; every
-- sign-up is approved since 0013) or does not exist.
--
-- Checked in this order: the route's short gap between calls, the route's
-- hourly or daily count, the account's dollars today, everyone's dollars
-- today. "Today" is the UTC day, so every cap resets at midnight UTC.
-- ---------------------------------------------------------------------------
create function public.usage_begin(p_owner uuid, p_route text)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  -- =========================================================================
  -- TUNING (Jed, Oct 7: $3 a day per account, $50 a day across everyone).
  --
  -- Per route:
  --   v_gap         the least time between two calls
  --   v_window_max  calls allowed in v_window
  --   v_window      a rolling window, or null for "today" (the UTC day)
  --   v_dollars     whether the dollar caps stop this route
  --
  -- The two Deepgram routes cost $0 in this ledger (they are limited by
  -- count) and are what name-spotting runs on, so the dollar caps do not
  -- stop them: an account that spent its $3 on live stats keeps its cards.
  -- deepgram_token allows 180 an hour because the silence alarm reconnects
  -- every 30 s through a long outage, and a refused token means no cards.
  -- =========================================================================
  c_user_daily_usd   constant numeric := 3.00;
  c_global_daily_usd constant numeric := 50.00;

  v_gap        interval;
  v_window_max int;
  v_window     interval;
  v_dollars    boolean;
  -- =========================================================================

  v_owner     uuid := p_owner;
  v_now       timestamptz := now();
  v_day_start timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  v_to_midnight int;
  v_approved  boolean;
  v_last      timestamptz;
  v_count     int;
  v_oldest    timestamptz;
  v_spent     numeric;
  v_row       public.usage%rowtype;
begin
  if v_owner is null then
    return jsonb_build_object('ok', false, 'code', 'signed_out', 'retry_after_s', 0);
  end if;

  case p_route
    when 'deepgram_token' then
      v_gap := interval '2 seconds';  v_window_max := 180; v_window := interval '1 hour'; v_dollars := false;
    when 'deepgram_keyterms' then
      v_gap := interval '5 seconds';  v_window_max := 60;  v_window := null;              v_dollars := false;
    when 'livestats' then
      v_gap := interval '5 seconds';  v_window_max := 900; v_window := null;              v_dollars := true;
    when 'roster_import' then
      v_gap := interval '15 seconds'; v_window_max := 40;  v_window := null;              v_dollars := true;
    when 'stats_import' then
      v_gap := interval '15 seconds'; v_window_max := 40;  v_window := null;              v_dollars := true;
    else
      return jsonb_build_object('ok', false, 'code', 'unknown_route', 'retry_after_s', 0);
  end case;

  -- The off switch: an account set to approved = false, or one that is gone.
  select u.approved into v_approved from public.users u where u.id = v_owner;
  if not coalesce(v_approved, false) then
    return jsonb_build_object('ok', false, 'code', 'not_approved', 'retry_after_s', 0);
  end if;

  -- One decision at a time per account and route, so two requests sent
  -- together cannot both pass the same check.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_owner::text || ':' || p_route, 0));

  v_to_midnight := greatest(1, ceil(extract(epoch from (v_day_start + interval '1 day' - v_now)))::int);

  -- Too soon after the last call.
  select max(u.at) into v_last
  from public.usage u
  where u.owner_id = v_owner and u.route = p_route and u.at > v_now - v_gap;
  if v_last is not null then
    return jsonb_build_object(
      'ok', false, 'code', 'rate_limited',
      'retry_after_s', greatest(1, ceil(extract(epoch from (v_last + v_gap - v_now)))::int)
    );
  end if;

  -- Too many in the window.
  if v_window is null then
    select count(*) into v_count
    from (
      select 1 from public.usage u
      where u.owner_id = v_owner and u.route = p_route and u.at >= v_day_start
      limit v_window_max
    ) s;
    if v_count >= v_window_max then
      return jsonb_build_object('ok', false, 'code', 'daily_cap', 'retry_after_s', v_to_midnight);
    end if;
  else
    -- The newest v_window_max calls: when the oldest of them leaves the
    -- window, one more is allowed.
    select count(*), min(s.at) into v_count, v_oldest
    from (
      select u.at from public.usage u
      where u.owner_id = v_owner and u.route = p_route and u.at > v_now - v_window
      order by u.at desc
      limit v_window_max
    ) s;
    if v_count >= v_window_max then
      return jsonb_build_object(
        'ok', false, 'code', 'rate_limited',
        'retry_after_s', greatest(1, ceil(extract(epoch from (v_oldest + v_window - v_now)))::int)
      );
    end if;
  end if;

  if v_dollars then
    select coalesce(sum(u.cost_usd), 0) into v_spent
    from public.usage u
    where u.owner_id = v_owner and u.at >= v_day_start;
    if v_spent >= c_user_daily_usd then
      return jsonb_build_object('ok', false, 'code', 'daily_cap', 'retry_after_s', v_to_midnight);
    end if;

    select coalesce(sum(u.cost_usd), 0) into v_spent
    from public.usage u
    where u.at >= v_day_start;
    if v_spent >= c_global_daily_usd then
      return jsonb_build_object('ok', false, 'code', 'global_cap', 'retry_after_s', v_to_midnight);
    end if;
  end if;

  insert into public.usage (owner_id, route) values (v_owner, p_route)
  returning * into v_row;

  return jsonb_build_object('ok', true, 'id', v_row.id, 'nonce', v_row.nonce);
end;
$$;

-- ---------------------------------------------------------------------------
-- usage_finish: records how a reserved call went. Only p_owner's own
-- unfinished row with the matching nonce changes; anything else is a no-op.
-- Negative counts become 0, and a cost is held to what one call on that route
-- can really cost, so a bad number cannot push anyone's day over its cap.
-- ---------------------------------------------------------------------------
create function public.usage_finish(
  p_owner uuid,
  p_id uuid,
  p_nonce uuid,
  p_ok boolean,
  p_provider text,
  p_input int,
  p_output int,
  p_cached int,
  p_cost numeric,
  p_ms int
)
returns void
language plpgsql
volatile
set search_path = ''
as $$
declare
  -- TUNING: the most one call on a route can be recorded as costing. Far
  -- above any real call (a roster import is well under $1, a live stats read
  -- a fraction of a cent), and never more than $100.
  c_max_call_usd constant numeric := 100.00;
begin
  update public.usage u
  set
    finished_at   = now(),
    ok            = coalesce(p_ok, false),
    provider      = left(nullif(btrim(p_provider), ''), 40),
    input_tokens  = greatest(coalesce(p_input, 0), 0),
    output_tokens = greatest(coalesce(p_output, 0), 0),
    cached_tokens = greatest(coalesce(p_cached, 0), 0),
    cost_usd      = least(
      greatest(coalesce(p_cost, 0), 0),
      c_max_call_usd,
      case u.route
        when 'deepgram_token' then 0
        when 'deepgram_keyterms' then 0
        when 'livestats' then 1.00
        else 5.00
      end
    ),
    ms            = greatest(coalesce(p_ms, 0), 0)
  where u.id = p_id
    and u.nonce = p_nonce
    and u.owner_id = p_owner
    and u.finished_at is null;
end;
$$;

-- ---------------------------------------------------------------------------
-- admin.usage_by_user: cost per account per day per route, read as the
-- database owner. The admin schema is closed to the app (0005); no grants.
-- ---------------------------------------------------------------------------
create view admin.usage_by_user as
select
  p.email,
  (u.at at time zone 'utc')::date as day,
  u.route,
  count(*) as calls,
  count(*) filter (where u.ok) as ok_calls,
  count(*) filter (where u.finished_at is null) as unfinished_calls,
  coalesce(sum(u.input_tokens), 0) as input_tokens,
  coalesce(sum(u.output_tokens), 0) as output_tokens,
  coalesce(sum(u.cached_tokens), 0) as cached_tokens,
  coalesce(sum(u.cost_usd), 0) as cost_usd,
  round(avg(u.ms)) as avg_ms
from public.usage u
left join public.users p on p.id = u.owner_id
group by p.email, (u.at at time zone 'utc')::date, u.route;

revoke all on admin.usage_by_user from public;

-- ---------------------------------------------------------------------------
-- app_events: at most 5,000 rows per account per UTC day (M1: stops a flood).
-- Counted by the time the database received the row, which the trigger
-- stamps, because `at` is the browser's own clock.
-- ---------------------------------------------------------------------------
alter table app_events add column received_at timestamptz not null default now();

create index app_events_owner_received_idx on app_events (owner_id, received_at);

create function public.app_events_daily_cap()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  -- TUNING: events one account may record in a UTC day. A busy real game
  -- sends a few hundred.
  c_max_per_day constant int := 5000;
  v_count int;
begin
  new.received_at := now();
  select count(*) into v_count
  from (
    select 1 from public.app_events e
    where e.owner_id = new.owner_id
      and e.received_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'
    limit c_max_per_day
  ) s;
  if v_count >= c_max_per_day then
    raise exception 'app_events daily cap reached' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger app_events_daily_cap
  before insert on app_events
  for each row execute function public.app_events_daily_cap();
