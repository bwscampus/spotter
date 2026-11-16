-- One more analytics event name (Nov 15): names.scoring_view, sent when a card
-- turns to its scoring view (a scoring word said beside the name, or the S
-- key). Its props are where the word was (before, after, or the key) and the
-- sport, never a name, a jersey or a word heard.
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
    'game.draft_deleted',
    'names.scoring_view'
  )
);
