// =============================================================================
// Which model reads the plays (Jed, Oct 5, testrun): Gemini 3.8 Flash through
// OpenRouter by default, because Sonnet cost about $1 a game. Setting
// LIVE_STATS_PROVIDER=anthropic in the environment (Railway's variables, or .env.local)
// puts it back on Claude Sonnet without a code change.
// =============================================================================

export type StatsProvider = "openrouter" | "anthropic";

export const DEFAULT_STATS_PROVIDER: StatsProvider = "openrouter";

/** The provider an environment value asks for; anything else is the default. */
export function statsProvider(value: string | undefined = process.env.LIVE_STATS_PROVIDER): StatsProvider {
  return value?.trim().toLowerCase() === "anthropic" ? "anthropic" : DEFAULT_STATS_PROVIDER;
}
