-- Booth partners (Nov 15, Jed): a host invites up to two other announcers
-- into his game. Each guest has his own account and his own called_games row
-- (booth_guest = true), runs his own mic and engine, and reads the host's two
-- rosters live through his membership while the host's game is a draft or
-- live. Cards spotted on any laptop are relayed live between them and never
-- stored (lib/server/boothBus.ts).
--
-- PRIVACY: nothing here says who was spotted. A membership is two accounts, a
-- game and a time; an invite is a code and a hash; a saved partner is an
-- address and an account. The two new counts are counts.
--
-- OWNERSHIP: no row here lets a guest write anything the host owns. A guest's
-- own game row cannot point at the host's rosters (the composite foreign keys
-- on called_games refuse it), so the guest's reads go through
-- lib/server/repo/booth.ts, which finds the rosters from the host's row.

alter table called_games
  -- A guest's own row: never counted against him by a future live-game
  -- counter, which counts `status <> 'draft' and not booth_guest`, so a booth
  -- game counts once, against the host.
  add column booth_guest boolean not null default false,
  -- The host's row was turned live by a guest's Start. The host's own Start
  -- then adopts the same row (same id, same booth) once, and clears this.
  add column started_by_guest boolean not null default false,
  add column remote_cards_shown int not null default 0 check (remote_cards_shown >= 0),
  add column deduped_cards int not null default 0 check (deduped_cards >= 0);

-- ---------------------------------------------------------------------------
-- Members: one host plus up to two guests per game.
-- ---------------------------------------------------------------------------

create table booth_members (
  host_game_id uuid not null,
  host_id uuid not null,
  guest_id uuid not null references users (id) on delete cascade,
  -- The guest's own called_games row. Null once he deleted it (he left).
  guest_game_id uuid,
  -- 1 or 2: which guest he is, so a card event can say which laptop it came from.
  slot smallint not null check (slot in (1, 2)),
  method text not null check (method in ('code', 'link', 'partner')),
  -- active; removed by the host (cannot rejoin); left (deleted his own row, may rejoin).
  state text not null default 'active' check (state in ('active', 'removed', 'left')),
  joined_at timestamptz not null default now(),
  ended_at timestamptz,
  primary key (host_game_id, guest_id),
  check (guest_id <> host_id),
  foreign key (host_game_id, host_id) references called_games (id, owner_id) on delete cascade,
  foreign key (guest_game_id, guest_id) references called_games (id, owner_id) on delete set null (guest_game_id)
);

-- Two guests at most, as a hard rule: one active member per slot.
create unique index booth_members_slot_idx on booth_members (host_game_id, slot) where state = 'active';
create unique index booth_members_guest_game_idx on booth_members (guest_game_id) where guest_game_id is not null;
create index booth_members_guest_idx on booth_members (guest_id);

-- ---------------------------------------------------------------------------
-- Invites: one code and one link per game, gone when the game ends.
-- ---------------------------------------------------------------------------

create table booth_invites (
  game_id uuid primary key,
  owner_id uuid not null,
  -- Four characters with nothing that reads two ways: no 0, O, 1, I or L.
  -- Held equal to BOOTH_CODE_ALPHABET in lib/booth/code.ts by a test.
  code text not null unique check (code ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$'),
  -- The link's token as SHA-256 only; the token itself is shown once.
  token_hash text unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  foreign key (game_id, owner_id) references called_games (id, owner_id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- Saved booth partners: added by email, accepted once, then added to every
-- new game the host makes (up to two).
-- ---------------------------------------------------------------------------

create table booth_partners (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users (id) on delete cascade,
  email text not null check (char_length(email) between 3 and 320),
  -- Null until accepted.
  partner_id uuid references users (id) on delete cascade,
  -- The emailed link's token as SHA-256 only. Cleared once accepted.
  token_hash text unique check (token_hash ~ '^[0-9a-f]{64}$'),
  auto_add boolean not null default true,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  check (partner_id is null or partner_id <> owner_id),
  check ((partner_id is null) = (accepted_at is null))
);

create unique index booth_partners_email_idx on booth_partners (owner_id, lower(email));
create unique index booth_partners_partner_idx on booth_partners (owner_id, partner_id) where partner_id is not null;
create index booth_partners_partner_lookup_idx on booth_partners (partner_id) where partner_id is not null;

-- ---------------------------------------------------------------------------
-- Joining. Owner first, like every function here. Answers a status rather
-- than raising, so the route can say exactly why: ok, missing (no such game,
-- or the game is a guest's), own_game, over (ended), full, removed.
-- ---------------------------------------------------------------------------

create function public.booth_join(p_guest uuid, p_game uuid, p_method text)
returns table (status text, guest_game_id uuid)
language plpgsql
set search_path = ''
as $$
declare
  v_host public.called_games%rowtype;
  v_member public.booth_members%rowtype;
  v_slot smallint;
  v_row uuid;
begin
  if p_guest is null or p_game is null then
    return query select 'missing'::text, null::uuid;
    return;
  end if;
  -- One join at a time per game, so two guests can never take the last slot together.
  perform pg_advisory_xact_lock(hashtextextended('booth:' || p_game::text, 0));

  select * into v_host from public.called_games g where g.id = p_game and not g.booth_guest;
  if not found then
    return query select 'missing'::text, null::uuid;
    return;
  end if;
  if v_host.owner_id = p_guest then
    return query select 'own_game'::text, null::uuid;
    return;
  end if;
  if v_host.status = 'ended' then
    return query select 'over'::text, null::uuid;
    return;
  end if;

  select * into v_member from public.booth_members m where m.host_game_id = p_game and m.guest_id = p_guest;
  if found then
    if v_member.state = 'removed' then
      return query select 'removed'::text, null::uuid;
      return;
    end if;
    if v_member.state = 'active' and v_member.guest_game_id is not null then
      return query select 'ok'::text, v_member.guest_game_id;
      return;
    end if;
  end if;

  select s.slot into v_slot
    from (values (1::smallint), (2::smallint)) as s (slot)
   where not exists (
     select 1 from public.booth_members m where m.host_game_id = p_game and m.state = 'active' and m.slot = s.slot
   )
   order by s.slot
   limit 1;
  if v_slot is null then
    return query select 'full'::text, null::uuid;
    return;
  end if;

  -- The guest's own row: a draft dated as the host's game, his to start, end,
  -- rate and delete. It never points at the host's rosters.
  insert into public.called_games (owner_id, status, started_at, game_date, sport, booth_guest, share_log)
  values (
    p_guest, 'draft', null,
    coalesce(v_host.game_date, (v_host.started_at at time zone 'UTC')::date, current_date),
    v_host.sport, true, true
  )
  returning id into v_row;

  insert into public.booth_members (host_game_id, host_id, guest_id, guest_game_id, slot, method, state, joined_at, ended_at)
  values (p_game, v_host.owner_id, p_guest, v_row, v_slot, p_method, 'active', now(), null)
  on conflict (host_game_id, guest_id) do update
    set guest_game_id = excluded.guest_game_id, slot = excluded.slot, method = excluded.method,
        state = 'active', joined_at = now(), ended_at = null;

  return query select 'ok'::text, v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- A guest's Start. His row turns live with the host's schools; the host's row
-- turns live too if it is still a draft, which is the one time the game
-- counts, against the host, whoever started first. Answers ok, missing (not
-- an active member, or the host's game is over), teams (a team is missing).
-- ---------------------------------------------------------------------------

create function public.booth_start(p_guest uuid, p_game uuid)
returns table (status text, guest_game_id uuid, host_live boolean)
language plpgsql
set search_path = ''
as $$
declare
  v_member public.booth_members%rowtype;
  v_host public.called_games%rowtype;
  v_home text;
  v_away text;
begin
  select * into v_member from public.booth_members m
   where m.host_game_id = p_game and m.guest_id = p_guest and m.state = 'active' and m.guest_game_id is not null;
  if not found then
    return query select 'missing'::text, null::uuid, false;
    return;
  end if;
  select * into v_host from public.called_games g where g.id = p_game for update;
  if not found or v_host.status not in ('draft', 'live') then
    return query select 'missing'::text, null::uuid, false;
    return;
  end if;

  select r.school into v_home from public.rosters r where r.id = v_host.home_roster_id and r.owner_id = v_host.owner_id;
  select r.school into v_away from public.rosters r where r.id = v_host.away_roster_id and r.owner_id = v_host.owner_id;
  if v_home is null or v_away is null then
    return query select 'teams'::text, null::uuid, false;
    return;
  end if;

  -- His own row. Already live (a reload, a second tab) is the same game.
  update public.called_games g
     set status = 'live', started_at = now(), home_school = v_home, away_school = v_away,
         sport = v_host.sport, game_date = coalesce(v_host.game_date, g.game_date)
   where g.id = v_member.guest_game_id and g.owner_id = p_guest and g.status = 'draft';

  if v_host.status = 'draft' then
    update public.called_games g
       set status = 'live', started_at = now(), home_school = v_home, away_school = v_away, started_by_guest = true
     where g.id = p_game;
  end if;

  return query select 'ok'::text, v_member.guest_game_id, v_host.status = 'live';
end;
$$;

-- ---------------------------------------------------------------------------
-- Saved partners join every new game their host makes (up to two), as
-- drafts in their own games. Run inside the insert of a draft or a game.
-- ---------------------------------------------------------------------------

create function public.booth_auto_add(p_owner uuid, p_game uuid)
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_partner uuid;
  v_added int := 0;
  v_status text;
begin
  for v_partner in
    select p.partner_id from public.booth_partners p
     where p.owner_id = p_owner and p.partner_id is not null and p.auto_add
     order by p.accepted_at asc, p.id asc
     limit 2
  loop
    select j.status into v_status from public.booth_join(v_partner, p_game, 'partner') j;
    if v_status = 'ok' then v_added := v_added + 1; end if;
  end loop;
  return v_added;
end;
$$;

-- ---------------------------------------------------------------------------
-- Keeping the rows honest, whichever path deletes or ends a game.
-- ---------------------------------------------------------------------------

create function public.booth_game_deleted()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.booth_guest then
    -- A guest deleting his own row leaves the booth; he may join again. Not
    -- when the row goes because his whole account is being deleted: the
    -- membership goes with the account, and touching it here would refuse
    -- the deletion (its guest_id no longer exists).
    update public.booth_members m set state = 'left', ended_at = now()
     where m.guest_game_id = old.id and m.state = 'active'
       and exists (select 1 from public.users u where u.id = m.guest_id);
  else
    -- A host deleting his game takes his guests' drafts of it with it (their
    -- memberships go by the foreign key). Past games a guest called stay his.
    delete from public.called_games g
     where g.status = 'draft' and g.booth_guest
       and g.id in (select m.guest_game_id from public.booth_members m where m.host_game_id = old.id);
  end if;
  return old;
end;
$$;

create trigger called_games_booth_deleted
  before delete on called_games
  for each row execute function public.booth_game_deleted();

create function public.booth_game_ended()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- The host's game ended: the code and the link die, a guest who never
  -- started has nothing to keep, and every membership is over.
  delete from public.booth_invites where game_id = new.id;
  delete from public.called_games g
   where g.status = 'draft' and g.booth_guest
     and g.id in (select m.guest_game_id from public.booth_members m where m.host_game_id = new.id);
  update public.booth_members set ended_at = coalesce(ended_at, now()) where host_game_id = new.id;
  return new;
end;
$$;

create trigger called_games_booth_ended
  after update of status on called_games
  for each row
  when (new.status = 'ended' and old.status is distinct from 'ended' and not new.booth_guest)
  execute function public.booth_game_ended();

-- A host's booth game nobody ended is ended 12 hours after it started, so a
-- guest's read of the host's rosters never outlives the night. Run once a day
-- by lib/server/housekeeping.ts; idempotent.
create function public.end_stale_booth_games()
returns void
language sql
set search_path = ''
as $$
  update public.called_games g
     set status = 'ended', ended_at = now()
   where g.status = 'live' and not g.booth_guest
     and g.started_at < now() - interval '12 hours'
     and exists (select 1 from public.booth_members m where m.host_game_id = g.id);
$$;

-- ---------------------------------------------------------------------------
-- Four analytics names. The list is closed on purpose; it must equal
-- EVENT_NAMES in lib/analytics/events.ts exactly.
-- ---------------------------------------------------------------------------

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
    'names.scoring_view',
    'booth.invite_created',
    'booth.joined',
    'booth.guest_signed_up',
    'booth.guest_removed'
  )
);
