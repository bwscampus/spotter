-- Analytics events, designed around the job stories in docs/V3_DEFINITION.md
-- section 10. From V3's 20260928205620 (live stats' stats.play_discarded is not
-- here; it comes back with live stats).
--
-- PRIVACY: codes and counts only. No player names, jerseys, heard words,
-- transcript or file contents, ever. props is filtered before it gets here
-- (lib/analytics/events.ts, on both the browser and the server); the size check
-- below is a backstop, not the rule.
--
-- Rows arrive through POST /api/events, which stamps env from the server's own
-- Railway environment (staging is recorded as 'preview') and drops anything from
-- localhost. The metric views count production only, so testing on staging does
-- not pollute them. Deleting an account removes its events by cascade.

create table app_events (
  id bigint generated always as identity primary key,
  owner_id uuid not null references users (id) on delete cascade,
  at timestamptz not null default now(),

  -- A closed vocabulary, so a typo cannot quietly create an event that no view
  -- reports. Adding an event is a one-line migration.
  name text not null check (
    name in (
      'account.signed_up',
      'prep.import_started',
      'prep.import_finished',
      'prep.roster_saved',
      'prep.cards_previewed',
      'game.started',
      'game.mic_started',
      'game.mic_stopped',
      'game.ended',
      'names.card_removed',
      'names.roster_refreshed',
      'stats.play_applied',
      'stats.play_undone',
      'stats.toggled',
      'stats.call_failed'
    )
  ),

  env text not null check (env in ('production', 'preview')),
  -- The git commit the browser's code was built from.
  app_version text not null check (char_length(app_version) between 1 and 40),
  -- One per browser tab, so a sitting can be read as a sequence.
  session_id uuid not null,
  -- Set while a game is running. Not a foreign key on purpose: a batch must not
  -- fail because its game row did not write, and a deleted game should not
  -- rewrite the history of what happened during it.
  game_id uuid,

  -- Numbers, booleans and short enum codes only.
  props jsonb not null default '{}'::jsonb check (
    jsonb_typeof(props) = 'object' and pg_column_size(props) <= 2048
  )
);

-- Every query is "my events, newest first" or "this event over time".
create index app_events_owner_at_idx on app_events (owner_id, at desc);
create index app_events_name_at_idx on app_events (name, at desc);
create index app_events_game_id_idx on app_events (game_id) where game_id is not null;

-- One sign-up per account, however many times the browser thinks it saw one.
create unique index app_events_signed_up_once_idx on app_events (owner_id)
  where name = 'account.signed_up';
