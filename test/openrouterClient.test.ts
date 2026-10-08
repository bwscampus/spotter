import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { chat, chatBody, createOpenRouterClient, OPENROUTER_MODEL, OPENROUTER_URL, pdfPart, textPart } from "@/lib/ai/openrouter";
import { UsageMeter } from "@/lib/usage/prices";
import { chatReply, fakeFetch } from "./fakeOpenRouter";

// =============================================================================
// Every model call goes to Gemini 3.8 Flash through OpenRouter (Jed, Oct 8).
// lib/ai/openrouter.ts is the one wire: what it sends, how it fails, and that
// nothing else in the app talks to Anthropic any more.
// =============================================================================

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SIGNAL = new AbortController().signal;

const REQUEST = {
  system: "Read the roster.",
  content: [textPart("22 Sam Corvallen RB")],
  schema: { type: "object", properties: {}, required: [], additionalProperties: false },
  schemaName: "roster",
  maxTokens: 1000,
  reasoning: "low" as const,
};

describe("what is sent", () => {
  it("is Gemini 3.8 Flash, in the schema's shape, to providers that keep nothing", () => {
    const body = chatBody(REQUEST);
    expect(OPENROUTER_MODEL).toBe("google/gemini-3.8-flash");
    expect(body.model).toBe(OPENROUTER_MODEL);
    expect(body.response_format).toEqual({ type: "json_schema", json_schema: { name: "roster", strict: true, schema: REQUEST.schema } });
    expect(body.provider).toEqual({ zdr: true, data_collection: "deny", require_parameters: true });
    expect(body.reasoning).toEqual({ effort: "low" });
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("plugins");
  });

  it("sends a PDF as itself, to be read natively rather than by OpenRouter's parsers", () => {
    const body = chatBody({ ...REQUEST, content: [pdfPart("JVBERi0="), textPart("Read this.")] });
    expect(body.plugins).toEqual([{ id: "file-parser", pdf: { engine: "native" } }]);
  });

  it("posts to OpenRouter with the key as a bearer token", async () => {
    const fetcher = vi.fn(async () => Response.json(chatReply({ ok: true })));
    await chat(createOpenRouterClient("sk-or-test", fetcher as never), REQUEST, SIGNAL);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(OPENROUTER_URL);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-or-test");
  });
});

describe("what comes back", () => {
  it("is the text, and every reply's cost reaches the meter", async () => {
    const meter = new UsageMeter();
    const create = async () => chatReply({ ok: true }, { prompt_tokens: 100, completion_tokens: 20, cost: 0.0003 });
    const outcome = await chat(createOpenRouterClient("k", fakeFetch(create)), REQUEST, SIGNAL, meter);
    expect(outcome).toMatchObject({ kind: "text", text: '{"ok":true}' });
    expect(meter.usage).toMatchObject({ calls: 1, inputTokens: 100, outputTokens: 20, costUsd: 0.0003 });
  });

  it("says when the answer was cut off or empty, and still meters it", async () => {
    const meter = new UsageMeter();
    const cut = await chat(createOpenRouterClient("k", fakeFetch(async () => chatReply("{", { cost: 0.01 }, "length"))), REQUEST, SIGNAL, meter);
    expect(cut.kind).toBe("length");
    const empty = await chat(createOpenRouterClient("k", fakeFetch(async () => chatReply(""))), REQUEST, SIGNAL, meter);
    expect(empty.kind).toBe("empty");
    expect(meter.usage.calls).toBe(2);
    expect(meter.usage.costUsd).toBeGreaterThan(0);
  });

  it("is claude_refused when the provider refuses or filters it", async () => {
    const refused = { choices: [{ finish_reason: "stop", message: { content: null, refusal: "no" } }] };
    await expect(chat(createOpenRouterClient("k", fakeFetch(async () => refused)), REQUEST, SIGNAL)).rejects.toMatchObject({ code: "claude_refused" });
    const filtered = { choices: [{ finish_reason: "content_filter", message: { content: "" } }] };
    await expect(chat(createOpenRouterClient("k", fakeFetch(async () => filtered)), REQUEST, SIGNAL)).rejects.toMatchObject({ code: "claude_refused" });
  });
});

describe("when it fails", () => {
  it("names each HTTP failure with a code the panels already know", async () => {
    const cases: Array<[number, string]> = [
      [401, "claude_key_rejected"],
      [402, "claude_no_model_access"],
      [404, "claude_model_missing"],
      [400, "claude_bad_request"],
      [429, "claude_rate_limited"],
      [503, "claude_overloaded"],
      [504, "claude_timeout"],
    ];
    for (const [status, code] of cases) {
      const client = createOpenRouterClient("k", fakeFetch(async () => ({ status })));
      await expect(chat(client, REQUEST, SIGNAL), String(status)).rejects.toMatchObject({ code });
    }
  });

  it("is a timeout when aborted and unreachable when the network is down", async () => {
    const aborted = createOpenRouterClient("k", (async () => {
      throw new DOMException("aborted", "AbortError");
    }) as never);
    await expect(chat(aborted, REQUEST, SIGNAL)).rejects.toMatchObject({ code: "claude_timeout" });
    const down = createOpenRouterClient("k", (async () => {
      throw new TypeError("fetch failed");
    }) as never);
    await expect(chat(down, REQUEST, SIGNAL)).rejects.toMatchObject({ code: "claude_unreachable" });
  });
});

describe("nothing talks to Anthropic", () => {
  function sources(dir: string): string[] {
    return readdirSync(join(ROOT, dir)).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(join(ROOT, path)).isDirectory()) return sources(path);
      return /\.(ts|tsx|mjs)$/.test(name) ? [path] : [];
    });
  }

  it("no app, lib or script file reads ANTHROPIC_API_KEY or imports the Anthropic SDK", () => {
    for (const path of [...sources("app"), ...sources("lib"), ...sources("components"), ...sources("scripts")]) {
      const text = readFileSync(join(ROOT, path), "utf8");
      expect(text, path).not.toContain("ANTHROPIC_API_KEY");
      expect(text, path).not.toContain("@anthropic-ai/sdk");
    }
  });

  it("and the SDK is not a dependency", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    expect({ ...pkg.dependencies, ...pkg.devDependencies }).not.toHaveProperty("@anthropic-ai/sdk");
  });
});
