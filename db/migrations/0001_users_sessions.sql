-- Accounts, sessions and the approval gate.
--
-- Sign-in is Google only (docs/technical-design.md section 4). A user is keyed on
-- Google's stable subject id, never on email, so changing the address on the
-- Google account cannot hand the Spotter account to someone else (AUTH-2, AUTH-8).
--
-- Every new user starts with approved = false. Jed approves accounts on /admin.
-- Anything that spends money (Anthropic, Deepgram) checks approved on the server
-- first, in lib/server/auth.ts.

create table users (
  id uuid primary key default gen_random_uuid(),
  google_sub text not null unique check (char_length(google_sub) between 1 and 255),
  email text not null check (char_length(email) between 3 and 320),
  name text check (char_length(name) <= 200),
  approved boolean not null default false,
  -- Stamped by the trigger below, so "how long did approval take" is answerable.
  approved_at timestamptz,
  -- Set only by the database owner (see users_guard_admin below).
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  last_sign_in_at timestamptz not null default now()
);

-- approved_at follows approved: set when it turns true, cleared when it turns
-- back to false, so a revoked account does not look approved in the metrics.
create function stamp_user_approval()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.approved and new.approved_at is null then
      new.approved_at := now();
    end if;
  elsif new.approved and not old.approved then
    new.approved_at := now();
  elsif not new.approved and old.approved then
    new.approved_at := null;
  end if;
  return new;
end;
$$;

create trigger users_stamp_approval
  before insert or update on users
  for each row execute function stamp_user_approval();

-- The app's role can write users rows (sign-in, approval), but it can never make
-- anyone an admin: that takes the owner, by hand. If the app is ever tricked into
-- writing is_admin, this refuses the statement.
create function guard_user_admin()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if pg_has_role(current_user, 'app_rw', 'member')
     and new.is_admin is distinct from (case when tg_op = 'INSERT' then false else old.is_admin end) then
    raise exception 'is_admin can only be changed by the database owner';
  end if;
  return new;
end;
$$;

create trigger users_guard_admin
  before insert or update on users
  for each row execute function guard_user_admin();

-- Sessions (AUTH-4, DB-8). The browser holds a random token; only its SHA-256
-- is stored, so a leaked database or backup cannot be replayed to sign in.
create table sessions (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid not null references users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now()
);

create index sessions_user_id_idx on sessions (user_id);
create index sessions_expires_at_idx on sessions (expires_at);
