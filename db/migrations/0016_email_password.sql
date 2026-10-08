-- Email and password sign-in, beside Google (Production Standard AUTH-1, AUTH-2,
-- AUTH-5, AUTH-7, DB-8).
--
-- A user now signs in with Google (google_sub), a password (password_hash), or
-- both. Google accounts are still found by sub first; an email only joins a
-- Google identity to a password account when Google has verified that email,
-- under the rules in app/api/auth/google/route.ts.
--
-- email_verified_at is when the account proved it holds its address: Google
-- vouches for it at sign-in, a password account opens the emailed link. Nothing
-- that spends money opens before it (requireVerifiedUser in lib/server/auth.ts).

alter table users alter column google_sub drop not null;

-- scrypt$N$r$p$salt$key from lib/server/password.ts; never a plain password.
alter table users add column password_hash text
  check (password_hash is null or (password_hash like 'scrypt$%' and char_length(password_hash) <= 512));

alter table users add column email_verified_at timestamptz;

-- Every account that exists today came through Google, which verified its email.
update users set email_verified_at = coalesce(last_sign_in_at, created_at, now()) where google_sub is not null;

-- One account per address, whatever its case. Sign-in looks accounts up by
-- lower(email), and sign-up relies on this index to refuse a second account
-- even when two arrive at once. If this fails on deploy, two existing accounts
-- share an address: the migration rolls back whole, and they need sorting out by hand.
create unique index users_email_lower_key on users (lower(email));

-- An account with no way in is a mistake: Google sign-in clears a password
-- only in the same statement that sets google_sub.
alter table users add constraint users_has_sign_in
  check (google_sub is not null or password_hash is not null);

-- Emailed single-use links: confirming an address, resetting a password. The
-- link carries 32 random bytes; only their SHA-256 is stored (DB-8), so a
-- leaked database or backup holds no working link. A link is spent by setting
-- used_at in the same statement that checks it.
create table email_tokens (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid not null references users (id) on delete cascade,
  purpose text not null check (purpose in ('verify', 'reset')),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);

create index email_tokens_user_id_idx on email_tokens (user_id);
create index email_tokens_expires_at_idx on email_tokens (expires_at);
