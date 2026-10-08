# Card design research prompt

For researching the optimal spotting card for announcers (Jed, Oct 3). Paste the prompt below into Claude with web research turned on, and attach a screenshot of a team's Cards preview (`/teams/[id]/cards`) so it can critique the real card.

The card it describes is the one on `testrun` before Oct 3's redesign, which this research led to and which is written up in `docs/CARD_SPEC.md`. To use the prompt again, rewrite "The current card" section from that spec first.

```text
I'm building Spotter, a web app for live sports announcers. While an announcer calls a game, Spotter listens to the broadcast and, about 1.2 seconds after a player's surname or cued jersey number is said, puts that player's "spotting card" on a laptop screen in the booth. I want research-backed guidance on the optimal card design so an announcer can take in what they need in a single glance while still talking. Please research thoroughly, cite sources, and separate strong evidence from expert opinion and from your own inference.

WHO AND WHERE
- Users: high school and college football play-by-play and PA announcers (other sports later). Often volunteers, usually working alone.
- Setting: press box or booth. A 13-15" laptop, 2-3 feet away, often off to the side, read with peripheral glances. Daylight glare at afternoon games, stadium lights at night.
- Task: they're mid-sentence. The card has to confirm who it is, how to say the name, and one or two things worth saying, within roughly 300-800 ms of looking. Anything that needs reading is a failure.

THE CURRENT CARD (critique it, don't just keep it)
- Up to 3 cards on screen, newest at the top and biggest; older ones shrink to a compact form (number, surname, first stat line).
- Layout: jersey number in a cell on the left in the team's colour; first name and surname across the top; when the announcer typed a pronunciation (e.g. "oh-soo-EH-tuh"), that's the big text with the spelled surname small beside it; small vitals (grade, height, weight); up to 3 stat lines (about 80 characters each), e.g. "SEASON 64 CAR 420 YDS 5 TD" and "TONIGHT 2 CAR ~11 YDS" (~ means estimated).
- An "as of 9/26" stamp in the corner for when season stats were taken; a "+1 CAR +8" chip that appears for 5 seconds when a live stat lands.
- The card is white; the screen behind it is split diagonally into the two teams' colours (away left, home right) at about 18% tint.
- Hard constraints: a card can't change size once it's up (stats update in place); cards appear instantly with no animation; the whole card scales from one font size.

QUESTIONS TO ANSWER
1. Glanceability: what does research on at-a-glance displays (aviation HUDs, air traffic control, automotive dashboards, broadcast monitors, sports scoreboards) say about reading under time pressure and dual-task load (talking while reading)? What can a person take in during one fixation?
2. Information hierarchy: what do announcers actually need first, second and third? Look for interviews, guides, books and forum threads from play-by-play and PA announcers about their spotting boards and charts (how they colour-code, what they write per player, what they never look at).
3. Typography for distance and speed: typeface style (e.g. condensed vs regular sans, DIN/Interstate-style signage fonts), weight, all-caps vs mixed case for names, numeral design, letter spacing, minimum character height for 2-3 ft at a glance, and how much of each element.
4. Pronunciation: the best way to show it at a glance (phonetic respelling with stressed syllable in caps, IPA, syllable breaks), and what broadcasters' pronunciation guides use (e.g. network or league guides).
5. Stats: which stats, how many, what format and abbreviations announcers say naturally; season vs tonight; whether to show estimates.
6. Colour and contrast: team colours on cards vs background, contrast ratios for glare, colour-blind safety, light vs dark themes in booths at night.
7. Layout of several cards: stacking order, size ratios between newest and older cards, position on screen, and how to signal which card is newest without motion.
8. Telling teams apart instantly (side, colour, position on screen), and avoiding mix-ups between players with similar names or shared surnames.

WHAT I WANT BACK
- A ranked list of recommendations, each with the evidence behind it and how strong that evidence is.
- A concrete card spec I could implement: elements, order, relative sizes (as a proportion of the card or in em), weights, case, colours and what to cut.
- 2-3 alternative layouts worth A/B testing, each with a one-line hypothesis.
- A simple test protocol a solo developer can run with real announcers or recorded games (e.g. time-to-read, errors, which card they glance at, how often they take a wrong card down).
- Any examples or images of real spotting boards, broadcast graphics or HUDs worth copying, with links.
- Open questions research couldn't settle.

Don't include any real player names in examples; use made-up ones.
```
