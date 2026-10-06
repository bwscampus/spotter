// Shown on screen and logged to the console (server terminal and browser)
// whenever DEEPGRAM_API_KEY is absent or empty.
export const MISSING_KEY_MESSAGE =
  "No Deepgram API key found. Add DEEPGRAM_API_KEY to .env.local and restart.";

// Same, for the key Claude needs to read an uploaded roster PDF. Everything
// else (saved rosters, game setup, live spotting) still works without it.
export const MISSING_ANTHROPIC_KEY_MESSAGE =
  "No Anthropic API key found. Add ANTHROPIC_API_KEY to .env.local and restart.";
