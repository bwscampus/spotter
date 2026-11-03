-- About you (Nov 3, Jed): a new announcer says which sports they call and what
-- kind of announcing they do, once, right after their first sign-in.
--
-- sports puts the announcer's own sports first on a new team's Sport list.
-- announcer_roles changes nothing in the app yet; it is kept for Jed to read
-- as the database owner. onboarded_at is when they answered or skipped "About
-- you": null means they have not seen it, which is every account that existed
-- before today, so each of them sees it once on their next visit.
--
-- Written only for the signed-in account (lib/server/repo/account.ts takes the
-- session's id first). Codes only, never free text.

alter table users
  add column sports text[] not null default '{}'
    constraint users_sports_check check (
      sports <@ array[
        'volleyball', 'football', 'basketball', 'soccer', 'baseball',
        'softball', 'water_polo', 'lacrosse', 'other'
      ]::text[]
      and cardinality(sports) <= 9
    ),
  add column announcer_roles text[] not null default '{}'
    constraint users_announcer_roles_check check (
      announcer_roles <@ array['public_address', 'tv_pbp', 'tv_color', 'radio_pbp', 'radio_color']::text[]
      and cardinality(announcer_roles) <= 5
    ),
  add column onboarded_at timestamptz;
