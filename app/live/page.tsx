import { connection } from "next/server";
import { LiveGame } from "@/components/livestats/LiveGame";
import { MISSING_KEY_MESSAGE } from "@/lib/messages";

/**
 * The live screen, with live stats on a football game that has them on.
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
  return <LiveGame hasApiKey={hasApiKey} />;
}
