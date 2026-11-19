-- The daily usage email (Nov 19, Jed): every morning the app emails the owner
-- yesterday's activity (lib/server/usageReport.ts, run by
-- lib/server/housekeeping.ts every 15 minutes once it is past 6:00 AM Pacific).
--
-- One row per Pacific day the report covers. A server claims the day with
-- `insert ... on conflict do nothing` before it sends, so a restart, the deploy
-- overlap or a second replica never sends the same day twice. A failed send
-- deletes its own claim (sent_at still null) so the next check tries again.
--
-- PRIVACY: a date and two times. The report itself (account names and emails)
-- is built in memory, emailed, and never stored or logged.

create table usage_reports (
  report_date date primary key,
  claimed_at timestamptz not null default now(),
  -- Null while a send is in flight, or if it failed and the claim could not be released.
  sent_at timestamptz
);
