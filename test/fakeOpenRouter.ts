import type { ChatReply, OpenRouterUsage } from "@/lib/ai/openrouter";

// =============================================================================
// A stand-in for OpenRouter. `fakeFetch(create)` is a fetch that hands the
// parsed request body to `create` and answers with whatever `create` returns:
// a ChatReply (a 200), or { status } for an HTTP failure. Tests read what was
// sent from create.mock.calls, the way they read Anthropic's params before.
// =============================================================================

export type FakeAnswer = ChatReply | { status: number };

export function fakeFetch<Body>(create: (body: Body) => unknown): typeof fetch {
  return (async (_url: unknown, init?: RequestInit) => {
    const answer = (await create(JSON.parse(String(init?.body)) as Body)) as FakeAnswer | undefined;
    if (answer && "status" in answer) return new Response("{}", { status: answer.status });
    return Response.json(answer ?? {});
  }) as typeof fetch;
}

/** A finished reply carrying `body` as its JSON text. */
export function chatReply(body: unknown, usage: OpenRouterUsage = {}, finish = "stop"): ChatReply {
  return {
    choices: [{ finish_reason: finish, message: { content: typeof body === "string" ? body : JSON.stringify(body) } }],
    usage,
  };
}

type Part = { type: string; text?: string; image_url?: { url: string }; file?: { file_data: string } };

/** The parts of the user message of a request body, whatever shape they came in. */
export function userParts(body: { messages: Array<{ content: unknown }> }): Part[] {
  const content = body.messages[1].content;
  return typeof content === "string" ? [{ type: "text", text: content }] : (content as Part[]);
}
