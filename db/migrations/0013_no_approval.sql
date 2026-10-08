-- Every sign-up is approved at once (Jed, Oct 7). From V3's
-- 20261007234005_v3_approve_all_signups.sql.
--
-- approved stays as an off switch: setting users.approved to false by hand
-- still shuts an account out of everything that costs money (usage_begin
-- answers not_approved) and out of sharing a game log. The spend guard
-- (usage_begin: $3 a day per account, $50 a day for everyone) is what limits a
-- new account now. approved_at is still stamped by users_stamp_approval (0001).
--
-- V3's other change in that file, handle_new_user(), was Supabase's trigger
-- making a profile per auth user; the app inserts users here, and the default
-- below is what makes a new one approved.

alter table users alter column approved set default true;

-- Everyone already waiting. users_stamp_approval stamps approved_at.
update users set approved = true where not approved;
