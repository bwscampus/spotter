-- Four more analytics event names. From V3's
--   20261002031051_v3_app_events_discarded.sql  stats.play_discarded: a play
--     the announcer threw away instead of confirming (live stats wait for his
--     OK on every play, docs/V3_DEFINITION.md 8.6).
--   20261004213450_v3_app_events_heard_as.sql   prep.heard_as_suggested,
--     prep.heard_as_accepted, prep.heard_as_skipped: counts only, never the
--     form or the name.
--
-- The list is closed on purpose (a typo cannot make an event no view
-- reports), so adding names is the same constraint, longer. It must equal
-- EVENT_NAMES in lib/analytics/events.ts exactly.

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
    'stats.call_failed'
  )
);
