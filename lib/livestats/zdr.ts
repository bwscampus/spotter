// Server only: read by lib/livestats/openrouter.ts before a v7 reader is
// called. Never imported by the browser.

// =============================================================================
// Which models have a zero-data-retention endpoint (v7, Part 8). Every call
// already asks OpenRouter for zdr routing and fails when no provider matches;
// this asks ahead of time, once per process (refreshed after ZDR_TTL_MS), so
// a reader with no such endpoint is never called at all and the game runs on
// reader A alone. Fail closed: a model whose status is unknown (the list
// could not be fetched, or does not name it) is not allowed.
// =============================================================================

// =============================================================================
// TUNING
// =============================================================================

export const ZDR_ENDPOINTS_URL = "https://openrouter.ai/api/v1/endpoints/zdr";

/** How long one answer from OpenRouter is kept before it is asked again. */
export const ZDR_TTL_MS = 60 * 60_000;

export const ZDR_TIMEOUT_MS = 8_000;

// =============================================================================

type Fetch = typeof fetch;

/** Every model slug the ZDR list names, read defensively: ids, slugs and model fields anywhere in the reply. */
export function zdrModelsOf(body: unknown): Set<string> {
  const found = new Set<string>();
  const walk = (value: unknown, depth: number) => {
    if (depth > 6 || value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1);
      return;
    }
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (typeof item === "string" && /^(?:id|model|model_id|slug|canonical_slug|permaslug|name)$/.test(key) && item.includes("/")) found.add(item.toLowerCase());
      else if (typeof item === "object" && item !== null) walk(item, depth + 1);
    }
  };
  walk(body, 0);
  return found;
}

/** Whether a slug is on the list: exact, or the list carries it with a variant suffix ("model:free") or a provider tag. */
export function zdrAllows(models: ReadonlySet<string>, model: string): boolean {
  const wanted = model.trim().toLowerCase();
  if (models.has(wanted)) return true;
  for (const slug of models) {
    if (slug === wanted || slug.startsWith(`${wanted}:`) || slug.startsWith(`${wanted}/`)) return true;
    // "provider/model-name" listed under an endpoint id like "model-name|provider".
    const bare = wanted.split("/")[1];
    if (bare && (slug.endsWith(`/${bare}`) || slug.startsWith(`${bare}|`))) return true;
  }
  return false;
}

/** Fetches the list; null when it could not be read (the caller fails closed). */
export async function fetchZdrModels(fetcher: Fetch = fetch, apiKey?: string, signal: AbortSignal = AbortSignal.timeout(ZDR_TIMEOUT_MS)): Promise<Set<string> | null> {
  try {
    const response = await fetcher(ZDR_ENDPOINTS_URL, { headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}, signal });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    const models = zdrModelsOf(body);
    return models.size > 0 ? models : null;
  } catch {
    return null;
  }
}

/** The check, remembered per process: ask once, allow or refuse, ask again after the TTL or after a failure. */
export class ZdrCheck {
  private models: Set<string> | null = null;
  private fetchedAt = Number.NEGATIVE_INFINITY;
  private inFlight: Promise<Set<string> | null> | null = null;
  private readonly fetcher: Fetch;
  private readonly apiKey: string | undefined;
  private readonly now: () => number;

  constructor(options: { fetcher?: Fetch; apiKey?: string; now?: () => number } = {}) {
    this.fetcher = options.fetcher ?? fetch;
    this.apiKey = options.apiKey;
    this.now = options.now ?? Date.now;
  }

  /** True only when the list was read and names the model. Unknown is false. */
  async allows(model: string): Promise<boolean> {
    const fresh = this.models !== null && this.now() - this.fetchedAt < ZDR_TTL_MS;
    if (!fresh) {
      this.inFlight ??= fetchZdrModels(this.fetcher, this.apiKey).finally(() => {
        this.inFlight = null;
      });
      const models = await this.inFlight;
      if (models) {
        this.models = models;
        this.fetchedAt = this.now();
      }
    }
    return this.models !== null && zdrAllows(this.models, model);
  }
}
