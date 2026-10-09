-- Raises the spend guard's caps and takes out the waits between calls
-- (Jed, Oct 8: "Let's make it $8, with $1000 on all accounts. Also, get rid
-- of the slow down"). Imports were refused with 429s during a day of real
-- testing: the $3 a day cap filled on a few big PDFs, and the 15 s gap
-- between imports answered "Slow down a moment" to a second try.
--
-- Replaces usage_begin from 0009_usage_limits.sql. Same arguments, same
-- answers; only the TUNING block and the two checks it drives change:
--   - $8 a day per account (was $3) and $1,000 a day for everyone (was $50);
--   - no least gap between two calls on any route (was 2 to 15 s);
--   - no count cap on the routes the dollar caps already stop (live stats
--     900 a day, roster and stats imports 40 a day each), so dollars are
--     their one limit.
-- The two Deepgram routes keep their counts (180 tokens an hour, 60 keyterm
-- checks a day): the dollar caps do not stop them, so the counts are the
-- only bound on them, and a game never comes near either.
--
-- usage_finish, the usage table and admin.usage_by_user are unchanged.

create or replace function public.usage_begin(p_owner uuid, p_route text)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  -- =========================================================================
  -- TUNING (Jed, Oct 8: $8 a day per account, $1,000 a day across everyone).
  --
  -- Per route:
  --   v_window_max  calls allowed in v_window, or null for no count limit
  --   v_window      a rolling window, or null for "today" (the UTC day)
  --   v_dollars     whether the dollar caps stop this route
  --
  -- The two Deepgram routes cost $0 in this ledger (they are limited by
  -- count) and are what name-spotting runs on, so the dollar caps do not
  -- stop them: an account that spent its $8 on live stats keeps its cards.
  -- deepgram_token allows 180 an hour because the silence alarm reconnects
  -- every 30 s through a long outage, and a refused token means no cards.
  -- =========================================================================
  c_user_daily_usd   constant numeric := 8.00;
  c_global_daily_usd constant numeric := 1000.00;

  v_window_max int;
  v_window     interval;
  v_dollars    boolean;
  -- =========================================================================

  v_owner     uuid := p_owner;
  v_now       timestamptz := now();
  v_day_start timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  v_to_midnight int;
  v_approved  boolean;
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
      v_window_max := 180;  v_window := interval '1 hour'; v_dollars := false;
    when 'deepgram_keyterms' then
      v_window_max := 60;   v_window := null;              v_dollars := false;
    when 'livestats' then
      v_window_max := null; v_window := null;              v_dollars := true;
    when 'roster_import' then
      v_window_max := null; v_window := null;              v_dollars := true;
    when 'stats_import' then
      v_window_max := null; v_window := null;              v_dollars := true;
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

  -- Too many in the window.
  if v_window_max is null then
    null;
  elsif v_window is null then
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
