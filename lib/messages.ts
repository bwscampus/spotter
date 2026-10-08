// =============================================================================
// Messages shared between the server and the screen.
//
// Anything a user can read says what to do in plain words. Setup problems that
// only Spotter's operator can fix (a missing or rejected key, a model name)
// show OUR_SIDE_MESSAGE; the detail goes to the server's own log and nowhere
// else.
// =============================================================================

/** What a user sees when something went wrong that only Spotter's operator can fix. */
export const OUR_SIDE_MESSAGE =
  "Something went wrong on our side. Try again in a few minutes, and if it keeps happening write to thespottercommunications@gmail.com.";

/** The live screen's banner when speech recognition has no key on the server. */
export const SPEECH_NOT_SET_UP_MESSAGE = "Speech recognition is not available right now.";

/**
 * Speech recognition could not start in this browser: the audio module that
 * sends the mic to it would not load. Shown as it is, because it is the one
 * failure the user can fix, by changing browser.
 */
export const AUDIO_CAPTURE_FAILED_MESSAGE = "This browser could not start sending audio. Open Spotter in Chrome or Edge on a laptop.";

/**
 * SERVER CONSOLE ONLY: logged whenever DEEPGRAM_API_KEY is absent or empty.
 * The browser never shows it; the live screen shows SPEECH_NOT_SET_UP_MESSAGE
 * and OUR_SIDE_MESSAGE instead.
 */
export const MISSING_KEY_MESSAGE = "No Deepgram API key found. Add DEEPGRAM_API_KEY to Railway's variables (or .env.local on a laptop) and redeploy.";

/**
 * What the screen says when speech recognition has failed for good. The
 * stream's own reason is shown only when it is the one a user can act on
 * (this browser cannot send audio); every other reason is a setup problem on
 * the server (a rejected key, a key that cannot make tokens), whose detail
 * stays in the server's log.
 */
export function speechFailureMessage(reason: string): string {
  return reason === AUDIO_CAPTURE_FAILED_MESSAGE ? reason : OUR_SIDE_MESSAGE;
}
