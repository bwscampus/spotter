import { connection } from "next/server";
import { LiveScreen } from "@/components/live/LiveScreen";
import { MISSING_KEY_MESSAGE } from "@/lib/messages";

/**
 * The live screen. Reachable only once a game exists: with no game saved in
 * this browser, it sends you back to the menu rather than showing an empty
 * screen with nothing to listen for.
 */
export default async function Live() {
  // Read the env at request time, not build time, so adding the key and
  // restarting is always reflected.
  await connection();
  const hasApiKey = Boolean(process.env.DEEPGRAM_API_KEY?.trim());
  if (!hasApiKey) console.error(`[Spotter] ${MISSING_KEY_MESSAGE}`);

  // Only this boolean reaches the browser. The key itself never does.
  return <LiveScreen hasApiKey={hasApiKey} />;
}
