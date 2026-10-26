// One small live stats call before a paid replay (Oct 26, the second v6
// push), so a run that cannot work (a rejected key, a model with no
// zero-retention route, no network) stops before it spends an hour:
//
//   npm run probe:stats -- --model anthropic/claude-haiku-5.5 --effort low
//
// Exits 0 when the call came back, 1 with its code when it did not. The
// window and the roster are made up. It goes through the same retrying wire
// as the replay (lib/livestats/openrouter.ts extractStatsPlaysWithRetries).

import { extractStatsPlaysWithRetries } from "@/lib/livestats/openrouter";
import { codeOf } from "@/lib/livestats/retry";
import { parseSetting, settingLabel } from "@/lib/livestats/settings";

async function main() {
  const argv = process.argv.slice(2);
  const flag = (name: string) => {
    const at = argv.indexOf(name);
    return at === -1 ? undefined : argv[at + 1];
  };
  const setting = parseSetting(flag("--model") ?? "anthropic/claude-haiku-5.5", flag("--effort"));
  if (!setting) {
    console.log("probe: not an allowed setting.");
    process.exit(1);
  }
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    console.log("probe: OPENROUTER_API_KEY is not set.");
    process.exit(1);
  }
  try {
    const reply = await extractStatsPlaysWithRetries(apiKey, {
      utterances: [{ seq: 0, text: "first and ten from the 25 wexcombe up the middle for 4", offsetMs: 0 }],
      rosters: [{ playerId: "H22-WEXCOMBE", side: "home", jersey: "22", first: "Bram", last: "Wexcombe", position: "RB" }],
      recentPlays: [],
    }, { setting });
    console.log(`probe: ${settingLabel(setting)} answered (${reply.plays.length} play${reply.plays.length === 1 ? "" : "s"}, ${reply.retries} retries).`);
  } catch (error) {
    console.log(`probe: ${settingLabel(setting)} FAILED, ${codeOf(error) ?? "unknown"}.`);
    process.exit(1);
  }
}

void main();
