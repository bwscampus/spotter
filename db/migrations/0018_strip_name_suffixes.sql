-- A generational suffix (Jr., Sr., II, III, IV, V) is not part of the
-- surname (Jed, Oct 9). Imports and saves now take it off (withoutSuffix in
-- lib/rosters/suffix.ts, called by normalizeRoster and toSaveArgs); this
-- takes it off rows saved before that, the same way stripSuffix does, so
-- "Bates III" is "Bates". A surname that would be left empty is not touched.
-- spoken_forms already left the suffix out, and the game builds them again.

update roster_players
set last_name = btrim(regexp_replace(regexp_replace(last_name, '([\s,]+(jr|sr|ii|iii|iv|v)\.?\s*)+$', '', 'i'), '\.+$', ''))
where last_name ~* '[\s,]+(jr|sr|ii|iii|iv|v)\.?\s*$'
  and btrim(regexp_replace(regexp_replace(last_name, '([\s,]+(jr|sr|ii|iii|iv|v)\.?\s*)+$', '', 'i'), '\.+$', '')) <> '';
