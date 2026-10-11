-- A roster saved before the Oct 9 suffix fix can have a name split one word
-- too late: first name "Jibri Abdullah", last name "II". 0018 only takes a
-- suffix off the end of a surname, so it left these alone, and the game keyed
-- that player as "II": his card's keyterm was "ii", and live stats dropped
-- every credit to him because "ii" names nobody.
--
-- Where the last name is only a suffix (Jr, Sr, II, III, IV or V, any case,
-- with or without a period or comma) and the first name has two words or
-- more, the first name's last word becomes the last name and the suffix goes,
-- exactly as withoutSuffix in lib/rosters/suffix.ts does on import and save.
-- A first name of one word is left alone. The game builds spoken forms again
-- from the saved surname, so nothing else needs rewriting.

with split as (
  select id, regexp_split_to_array(btrim(first_name), '\s+') as words
  from roster_players
  where regexp_replace(btrim(last_name), '[.,]+', '', 'g') ~* '^(jr|sr|ii|iii|iv|v)$'
    and first_name is not null
)
update roster_players p
set first_name = array_to_string(split.words[1:array_length(split.words, 1) - 1], ' '),
    last_name = regexp_replace(split.words[array_length(split.words, 1)], ',+$', '')
from split
where p.id = split.id
  and array_length(split.words, 1) >= 2
  and regexp_replace(split.words[array_length(split.words, 1)], ',+$', '') <> '';
