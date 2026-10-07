-- Games: the matchup, when it was called, and how it went, plus the
-- one-per-game feedback card. From V3's 20260928205601, without Supabase's auth
-- schema or row level security.
--
-- PRIVACY: nothing here says who was spotted. A row is a matchup, two times
-- and counts. No player names, no transcript. Those stay in the browser log.
--
-- The school names are copied in when the game starts, so deleting a roster
-- leaves its history readable. The roster ids go null instead of cascading.
-- Composite foreign keys keep every reference inside one owner's data.

create table called_games (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users (id) on delete cascade,

  home_roster_id uuid,
  away_roster_id uuid,
  home_school text not null,
  away_school text not null,
  sport text check (
    sport in (
      'volleyball', 'football', 'basketball', 'soccer', 'baseball',
      'softball', 'water_polo', 'lacrosse', 'other'
    )
  ),
  stats_enabled boolean not null default false,

  started_at timestamptz not null default now(),
  -- Null until End game.
  ended_at timestamptz,

  -- How it went. Counts only.
  mic_seconds int not null default 0 check (mic_seconds >= 0),
  reconnects int not null default 0 check (reconnects >= 0),
  cards_shown int not null default 0 check (cards_shown >= 0),
  cards_removed int not null default 0 check (cards_removed >= 0),
  stat_plays_added int not null default 0 check (stat_plays_added >= 0),
  stat_plays_undone int not null default 0 check (stat_plays_undone >= 0),

  unique (id, owner_id),
  -- A game can only name rosters its own owner has. Deleting a roster clears
  -- just the roster id, never the owner.
  foreign key (home_roster_id, owner_id) references rosters (id, owner_id) on delete set null (home_roster_id),
  foreign key (away_roster_id, owner_id) references rosters (id, owner_id) on delete set null (away_roster_id)
);

-- Every query is "my games, newest first".
create index called_games_owner_started_idx on called_games (owner_id, started_at desc);
create index called_games_home_roster_idx on called_games (home_roster_id);
create index called_games_away_roster_idx on called_games (away_roster_id);

-- End-of-game feedback. The game id is the key, which is what makes it one per game.
create table game_feedback (
  game_id uuid primary key,
  owner_id uuid not null references users (id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  -- The chips in docs/V3_DEFINITION.md 10.2, as codes.
  blockers text[] not null default '{}' check (
    blockers <@ array[
      'wrong_names', 'missing_names', 'slow', 'stats_wrong', 'stats_missing',
      'too_much_on_screen', 'nothing'
    ]::text[]
  ),
  -- The card asks for no player names. The length is all the database can hold it to.
  note text check (char_length(note) <= 280),
  created_at timestamptz not null default now(),
  -- Feedback can only be left on a game the same account called.
  foreign key (game_id, owner_id) references called_games (id, owner_id) on delete cascade
);

create index game_feedback_owner_id_idx on game_feedback (owner_id);
