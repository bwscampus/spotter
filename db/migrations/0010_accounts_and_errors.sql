-- Upload consent, browser crash reports, and two admin views (V3's pre-launch
-- audit H5, M5, H14). From V3's
--   20261007044924_v3_accounts_and_errors.sql
--   20261007045325_v3_client_errors_cleanup_job.sql (a pg_cron job; here the
--     plain function public.delete_old_client_errors(), which the app or a
--     Railway cron calls once a day, as V3's job did at 09:23 UTC)
--
-- Functions that read auth.uid() in V3 take the owner explicitly (p_owner: the
-- signed-in user's id, from the session) and return what V3's returned.

-- -----------------------------------------------------------------------------
-- Upload consent: when the account ticked "I have the right to use this roster
-- or stats sheet". Set through accept_upload_terms(); the first time is kept.
-- -----------------------------------------------------------------------------

alter table users add column accepted_upload_terms_at timestamptz;

-- Raises 42501 'signed_out' with no owner. Returns the consent time, or null
-- when there is no such user.
create function public.accept_upload_terms(p_owner uuid)
returns timestamptz
language plpgsql
set search_path = ''
as $$
declare
  stamped timestamptz;
begin
  if p_owner is null then
    raise exception 'signed_out' using errcode = '42501';
  end if;

  update public.users
  set accepted_upload_terms_at = coalesce(accepted_upload_terms_at, now())
  where id = p_owner
  returning accepted_upload_terms_at into stamped;

  return stamped;
end;
$$;

-- -----------------------------------------------------------------------------
-- Client errors: a crash report from the browser (name, first line of the
-- message, path without its query, digest). Written through
-- record_client_error(), at most 20 an hour per account. Kept 90 days.
-- -----------------------------------------------------------------------------

create table client_errors (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  owner_id uuid references users (id) on delete cascade,
  env text check (env in ('production', 'preview')),
  app_version text check (char_length(app_version) <= 40),
  path text check (char_length(path) <= 200),
  name text check (char_length(name) <= 80),
  message text check (char_length(message) <= 300),
  digest text check (char_length(digest) <= 100)
);

create index client_errors_owner_idx on client_errors (owner_id, at);
create index client_errors_at_idx on client_errors (at);

-- Writes one report for p_owner, unless that account already sent 20 in the
-- last hour. Returns whether it was written. Cuts every field to its limit, so
-- an oversized report is shortened rather than refused.
create function public.record_client_error(
  p_owner uuid,
  p_env text,
  p_app_version text,
  p_path text,
  p_name text,
  p_message text,
  p_digest text
)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
  if p_owner is null then
    return false;
  end if;
  if p_env is null or p_env not in ('production', 'preview') then
    return false;
  end if;

  -- One report at a time per account, so a burst cannot slip past the 20.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('record_client_error:' || p_owner::text));

  if (
    select count(*) from public.client_errors
    where owner_id = p_owner and at > now() - interval '1 hour'
  ) >= 20 then
    return false;
  end if;

  insert into public.client_errors (owner_id, env, app_version, path, name, message, digest)
  values (
    p_owner,
    p_env,
    left(p_app_version, 40),
    left(p_path, 200),
    left(p_name, 80),
    left(p_message, 300),
    left(p_digest, 100)
  );
  return true;
end;
$$;

-- Deletes reports older than 90 days. Call once a day (the app or a Railway
-- cron). Same name and return as V3's.
create function public.delete_old_client_errors()
returns void
language sql
set search_path = ''
as $$
  delete from public.client_errors where at < now() - interval '90 days';
$$;

-- -----------------------------------------------------------------------------
-- Admin views, read as the database owner. No grants (0005).
-- -----------------------------------------------------------------------------

-- Accounts switched off (approved = false), oldest first. Every sign-up is
-- approved since 0013, so this is empty unless someone was turned off.
create view admin.pending_approvals as
  select p.email, p.created_at
  from public.users p
  where not p.approved
  order by p.created_at;

-- The last 7 days of browser crashes, newest first.
create view admin.recent_client_errors as
  select e.at, e.env, e.app_version, e.path, e.name, e.message, e.digest, p.email
  from public.client_errors e
  left join public.users p on p.id = e.owner_id
  where e.at > now() - interval '7 days'
  order by e.at desc;

revoke all on admin.pending_approvals from public;
revoke all on admin.recent_client_errors from public;
