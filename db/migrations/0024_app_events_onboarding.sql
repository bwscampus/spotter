-- Seven more analytics event names (Nov 3): onboarding and draft games. Codes
-- and counts only, never a name, a school or anything typed:
--   onboarding.about_saved    how many sports and kinds of announcing were
--                             picked, and a yes/no for each kind
--   onboarding.about_skipped  "About you" skipped
--   onboarding.step_done      a step of "Set up your next game" finished
--                             (step: date, away, home)
--   onboarding.skipped        "Skip for now" on that walkthrough (step)
--   game.draft_saved          a draft game saved (from: setup, walkthrough)
--   game.draft_started        a draft started (from: setup, games, home)
--   game.draft_deleted        a draft deleted
--
-- The list is closed on purpose, so adding names is the same constraint,
-- longer. It must equal EVENT_NAMES in lib/analytics/events.ts exactly.

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
    'game.draft_saved',
    'game.draft_started',
    'game.draft_deleted'
  )
);
