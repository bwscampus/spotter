# Making test games from transcripts

`npm run make:game` turns a transcript of a game's commentary into a test game. A test game works exactly like a log you downloaded from Past games, so `npm run score:stats` can score live stats on it against the real box score. You don't need to call the game live or record anything in Spotter.

You need three things for each game:

1. **The transcript files**: whatever Deepgram gave you for the game. If you downloaded it in several formats (JSON, TXT, SRT, VTT), that's fine: drag them all in and the tool picks the best one. If the game is split into several files (part 1, part 2, ...), drag them all in and the tool joins them in order.
2. **The ESPN link to the game** (for college and NFL games). The tool gets both rosters and the box score from ESPN.
3. **For a high school game instead:** a roster spreadsheet for each team (see "High school games" below).

Every step below happens in the **Terminal** app on your Mac.

## Once, before your first game

1. Open **Terminal** (press Command and Space, type `Terminal`, press Enter).
2. Go to the folder that holds Spotter's code. Type `cd `, with a space after it, then drag the Spotter folder from Finder into the Terminal window and press Enter.
3. Get the newest code: type `git checkout main`, press Enter, then type `git pull`, press Enter.
4. Install what the code needs: type `npm install` and press Enter. Wait until the cursor comes back.

## Making a game (college or NFL)

1. In Terminal, in the Spotter folder, type `npm run make:game` and press Enter.
2. It says **Step 1**. In Finder, select all of this game's transcript files (click the first, then hold Shift and click the last), drag them into the Terminal window together, and press Enter. You can drag the folder they're in instead.
   - It tells you what it found: "They're all the same transcript in different formats, so I used the best one", or the parts it joined and their order. If the order is wrong, rename the files so they sort in game order (part 1, part 2, ...) and start again.
3. It says **Step 2**. In your browser, find the game on espn.com and open its page (the one with the box score). Copy the address from the address bar. It looks like `https://www.espn.com/college-football/game/_/gameId/401856712/georgia-alabama`. Paste it into Terminal (Command V) and press Enter.
4. It says **Step 3**. Press Enter to save the game in your `SpotterTestSet` folder (in your home folder). The folder is created if it isn't there yet.
5. It prints **Done** and what it made: the number of lines, how long the game ran, and how many players, quarterbacks, kickers and punters each roster has.
6. It asks **Make another game?** Type `y` and press Enter to do the next one, or just press Enter to stop.

Each game ends up as these files in `SpotterTestSet`, named with the game's date first so they list in the order they were played:

- `2026-10-10-georgia-at-alabama.json` is the game.
- `2026-10-10-georgia-at-alabama.truth.json` tells the scorer where to find the box score. Don't rename one without the other.
- `transcripts/2026-10-10-georgia-at-alabama.txt` is the game's whole transcript as one text file, with a time on each line. Once it's there, you can delete the transcript files you dragged in. If you ever need to make the game again, drag in this one file.

## Scoring all of your games

1. In Terminal, in the Spotter folder, type `npm run score:stats -- ~/SpotterTestSet` and press Enter.
2. It runs every game in the folder through live stats and prints one line per game, then one line for all of them together. Each game sends its transcript to the stats model the way a live game does, so **each game costs money**. The scorer prints what each game cost.
3. Don't add `--recorded` for these games. That option re-runs replies saved during a live game, and a made game has none.

To score with a different model or effort, add it at the end, for example: `npm run score:stats -- ~/SpotterTestSet --model anthropic/claude-haiku-5.5 --effort low`.

## High school games

ESPN doesn't have high school rosters, so you give the tool a spreadsheet for each team.

1. Make one spreadsheet per team, saved as **CSV** (in Excel or Numbers: File, then Export or Save As, then CSV). The first row names the columns: `Number`, `First name`, `Last name` and `Position`. A single `Name` column can stand in for the two name columns ("Sam Langan" or "Langan, Sam").
2. Run `npm run make:game`, drag in the transcript files, and at **Step 2** type `none` and press Enter.
3. It asks for each team's name and roster file, one at a time. Type the name or drag in the file, and press Enter after each one.

The scorer can only score a game it has a box score for. For a high school game, you type that box score in by hand. Make a text file beside the game with the same name, ending in `.truth.json` instead of `.json` (for example `millbrook-at-harborview.truth.json`), that looks like this:

```json
{
  "source": "manual",
  "players": [
    { "side": "home", "jersey": "7", "name": "Sam Langan", "stats": { "pass_cmp": 12, "pass_att": 20, "pass_yds": 180, "pass_td": 2 } },
    { "side": "away", "jersey": "22", "name": "Reed Ames", "stats": { "rush_att": 18, "rush_yds": 96, "rush_td": 1 } }
  ]
}
```

The stat names it accepts are `pass_cmp`, `pass_att`, `pass_yds`, `pass_td`, `pass_int`, `rush_att`, `rush_yds`, `rush_td`, `rec`, `rec_yds`, `rec_td`, `kr`, `kr_yds`, `xpm`, `xpa`, `fgm`, `fga`, `def_int` and `fum`. Only the stats you list are scored.

Without a box score, you can still watch it read plays: `npm run replay:stats -- ~/SpotterTestSet/<the game's file name>`.

## Getting a transcript from Deepgram (only if you don't have one yet)

Deepgram can transcribe a recording of a game in under a minute, so you never have to play it through Spotter. When you ask Deepgram for it, use the same settings the live app uses, or the text won't look like what live stats sees: model **Nova-3**, **numerals on**, **smart format off**, **punctuation off**. Turn **utterances** on if you see that option. Download the result as JSON.

You only need one of Deepgram's formats; JSON is the best. If the transcript you have is plain text without times, that still works. The tool spaces the lines out at a normal talking pace and tells you it did. Plays and stats score fine, but the "seconds to stats" number won't mean anything for that game.

## What to know about the results

- A transcribed recording is usually a little more accurate than a live stream, and its lines are cut a little differently. Scores on made games can run slightly better than a live game would. That's fine for comparing models against each other.
- Rosters come from ESPN's team pages as they are today, plus everyone in that game's box score. A player who joined the team after the game is on the roster too, which doesn't hurt.
- TV commentary isn't a high school PA announcer: the booth says much more. A made TV game tells you how well stats read a play that is described. It doesn't tell you how a quiet PA booth goes.
- Test games name real players. `SpotterTestSet` stays outside the code folder, and `make:game` and the scorer both refuse to use a folder inside it, so the files never get uploaded with the code.
