-- Where sign-ups come from, and the confirm-email step (Nov 19, the UX
-- overhaul's Phase 0: measure before changing anything).
--
-- 1. account.signed_up now carries `from` (landing, demo, login, direct;
--    lib/auth/signupSource.ts), and an email sign-up records it from the
--    server, which alone knows the sign-up made an account (AUTH-7). Before
--    this only Google sign-ups were counted at all.
-- 2. onboarding.confirm_resent counts each "send the link again", to see how
--    often the confirm-email step holds a new announcer up. Counts only.
-- 3. admin.metrics_activation gains four columns at the end: sign-ups from the
--    demo and from the landing page, and how many of the demo's saved a roster
--    and called a game. Existing columns are unchanged.

alter table app_events drop constraint app_events_name_check;

alter table app_events add constraint app_events_name_check check (
  name in (
    'account.signed_up',
    'prep.import_started',
    'prep.import_finished',
    'prep.roster_saved',
    'prep.cards_previewed',
    'prep.heard_as_suggested',
    'prep.heard_as_accepted',
    'prep.heard_as_skipped',
    'game.started',
    'game.mic_started',
    'game.mic_stopped',
    'game.ended',
    'names.card_removed',
    'names.roster_refreshed',
    'stats.play_applied',
    'stats.play_undone',
    'stats.play_discarded',
    'stats.toggled',
    'stats.call_failed',
    'onboarding.about_saved',
    'onboarding.about_skipped',
    'onboarding.step_done',
    'onboarding.skipped',
    'onboarding.confirm_resent',
    'game.draft_saved',
    'game.draft_started',
    'game.draft_deleted',
    'names.scoring_view',
    'booth.invite_created',
    'booth.joined',
    'booth.guest_signed_up',
    'booth.guest_removed'
  )
);

create or replace view admin.metrics_activation as
with signups as (
  select e.owner_id, e.at as signed_up_at, admin.week_starting(e.at) as week_starting, e.props ->> 'from' as came_from
  from public.app_events e
  where e.env = 'production' and e.name = 'account.signed_up'
),
first_roster as (
  select owner_id, min(at) as at
  from public.app_events
  where env = 'production' and name = 'prep.roster_saved'
  group by owner_id
),
first_game as (
  select owner_id, min(at) as at
  from public.app_events
  where env = 'production' and name = 'game.started'
  group by owner_id
),
steps as (
  select
    s.week_starting,
    s.owner_id,
    s.came_from,
    p.approved_at,
    r.at as roster_at,
    g.at as game_at,
    extract(epoch from (p.approved_at - s.signed_up_at)) / 3600 as hours_to_approval,
    extract(epoch from (r.at - s.signed_up_at)) / 3600 as hours_to_roster,
    extract(epoch from (g.at - r.at)) / 3600 as hours_roster_to_game
  from signups s
  left join public.users p on p.id = s.owner_id and p.approved
  left join first_roster r on r.owner_id = s.owner_id
  left join first_game g on g.owner_id = s.owner_id
)
select
  week_starting,
  count(*) as signed_up,
  count(approved_at) as approved,
  count(roster_at) as saved_a_roster,
  count(game_at) as called_a_game,
  round(100.0 * count(approved_at) / count(*), 0) as approved_pct,
  round(100.0 * count(roster_at) / count(*), 0) as saved_a_roster_pct,
  round(100.0 * count(game_at) / count(*), 0) as called_a_game_pct,
  round((percentile_cont(0.5) within group (order by hours_to_approval)
    filter (where hours_to_approval is not null))::numeric, 1) as median_hours_to_approval,
  round((percentile_cont(0.5) within group (order by hours_to_roster)
    filter (where hours_to_roster is not null))::numeric, 1) as median_hours_signup_to_first_roster,
  round((percentile_cont(0.5) within group (order by hours_roster_to_game)
    filter (where hours_roster_to_game is not null))::numeric, 1) as median_hours_first_roster_to_first_game,
  count(*) filter (where came_from = 'demo') as came_from_demo,
  count(*) filter (where came_from = 'landing') as came_from_landing,
  count(*) filter (where came_from = 'demo' and roster_at is not null) as demo_saved_a_roster,
  count(*) filter (where came_from = 'demo' and game_at is not null) as demo_called_a_game
from steps
group by week_starting
order by week_starting desc;
