-- About you's "Other" sports, typed (Nov 4, Jed: "Make other autofill
-- suggestion based on what they are typing"). The question lists nine sports;
-- anything else the announcer calls is typed into one box, which suggests
-- sports as they type (wrestling, track and field, ...) and keeps what they
-- pick, or what they typed, here. users.sports keeps 'other' whenever this has
-- any, so the new-team Sport list still puts Other among the announcer's own.
--
-- The announcer's own words about themselves, read by Jed as the database
-- owner and shown back to them in Settings. Never in analytics (a count only).

-- True when every label is 1 to 40 characters. Immutable, so a check can use it.
create function public.short_labels(labels text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(bool_and(char_length(label) between 1 and 40), true) from unnest(labels) as label;
$$;

alter table users
  add column other_sports text[] not null default '{}'
    constraint users_other_sports_check check (cardinality(other_sports) <= 10 and public.short_labels(other_sports));
