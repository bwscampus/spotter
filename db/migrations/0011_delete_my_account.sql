-- Delete my account (V3's pre-launch audit B3). From V3's
-- 20261007060000_v3_delete_my_account.sql.
--
-- Deletes p_owner's shared game logs (found by owner_hash, since a shared log
-- has no owner id) and then the users row. Every table with an owner_id
-- references users (id) on delete cascade, so that one delete removes the
-- sessions, rosters, players, games, feedback, analytics events, usage rows and
-- client errors with it.
--
-- p_owner: the signed-in user's id, from the session. Raises 42501
-- 'signed_out' with no owner. Returns nothing, like V3's; deleting an account
-- that is already gone is a no-op.

create function public.delete_my_account(p_owner uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_owner is null then
    raise exception 'signed_out' using errcode = '42501';
  end if;

  delete from public.shared_game_logs
  where owner_hash = public.shared_log_owner_hash(p_owner);

  delete from public.users where id = p_owner;
end;
$$;
