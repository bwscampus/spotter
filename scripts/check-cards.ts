// G5 replay equality (docs/V3_DEFINITION.md section 4) on a real log: replays
// it through the card path with live stats off and on, and says whether the
// cards shown were identical, frame for frame.
//
//   npm run check:cards -- ~/Downloads/spotter-log-20261001-1715-ab12cd34.json
//
// The log is the .json from Download in the live screen's Log panel or on Past
// games. Nothing is sent anywhere: live stats run with a stand-in for Claude
// (creditNamesHeard in lib/replay/cardEquality.ts), because what is checked is
// the cards, not the stats. Exits 1 when the cards differ, 2 when the log
// cannot be read.
//
// PRIVACY: the log is a recording of somebody naming minors. This reads it from
// disk, prints counts and, only when the cards differ, the player keys of the
// first frame that differs, to this terminal. It writes nothing anywhere.

import { readFileSync } from "node:fs";
import { CardLogError, checkCards, type CardFrame } from "@/lib/replay/cardEquality";

const file = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
if (!file) {
  console.error("Usage: npm run check:cards -- <log.json>");
  process.exit(2);
}

let raw: unknown;
try {
  raw = JSON.parse(readFileSync(file, "utf8"));
} catch (error) {
  console.error(`Could not read ${file}: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}

const frameText = (frame: CardFrame | null) =>
  frame ? `record ${frame.record}, ${frame.cause}: ${frame.cards.join(", ") || "(no cards)"}` : "(no frame)";

try {
  const check = await checkCards(raw);
  const stats = check.on.stats;
  console.log(`Frames: ${check.frames} with stats off, ${check.on.frames.length} with stats on.`);
  if (stats) {
    console.log(
      `Stats on: ${stats.calls} calls, ${stats.playsRead} plays read, ${stats.oks} OK'd, ${stats.undos} taken back, ` +
        `${stats.restats} line rewrites, ${stats.linesRewritten} on cards already up, ${stats.cardsWithTonight} cards put up with tonight on them.`,
    );
  }
  if (check.off.unplacedTakedowns > 0) {
    console.log(`${check.off.unplacedTakedowns} takedowns could not be placed on a card (a game saved before cards existed).`);
  }
  if (check.equal) {
    console.log("PASS: the cards shown are identical with stats off and on.");
  } else {
    const difference = check.difference!;
    console.log(`FAIL: the cards differ at frame ${difference.index}.`);
    console.log(`  stats off: ${frameText(difference.off)}`);
    console.log(`  stats on:  ${frameText(difference.on)}`);
    process.exit(1);
  }
} catch (error) {
  if (error instanceof CardLogError) {
    console.error(error.message);
    process.exit(2);
  }
  throw error;
}
