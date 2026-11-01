import { connection } from "next/server";
import { LiveNamesGame } from "@/components/game/LiveNamesGame";
import { MISSING_KEY_MESSAGE } from "@/lib/messages";

/**
 * The live screen, names only. main has no live stats (Jed, Nov 1: "Take live
 * stats off of main"), so the screen is never wrapped in the stats loop
 * (testrun2 renders components/livestats/LiveGame.tsx here): no Stats or Out
 * menu, no TONIGHT section, and no call to /api/livestats/*, which main does
 * not have. The team panel still comes in, with the season leaders.
 * Reachable only once a game exists: with no game saved in this browser, it
 * sends you back to the menu rather than showing an empty screen with nothing
 * to listen for.
 */
export default async function Live() {
  // Read the env at request time, not build time, so adding the key and
  // restarting is always reflected.
  await connection();
  const hasApiKey = Boolean(process.env.DEEPGRAM_API_KEY?.trim());
  if (!hasApiKey) console.error(`[Spotter] ${MISSING_KEY_MESSAGE}`);

  // Only this boolean reaches the browser. The key itself never does.
  return <LiveNamesGame hasApiKey={hasApiKey} />;
}
