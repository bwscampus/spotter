import type { Statement } from "./fakeServer";

// The two usage functions (public.usage_begin and public.usage_finish,
// db/migrations/0009_usage_limits.sql) as answers for fakeDatabase in
// test/fakeServer.ts. lib/server/usage.ts asks for `select public.usage_begin($1, $2) as reply`
// and reads the jsonb from `reply`. By default every call is allowed; pass
// `begin` to answer usage_begin some other way (throw to stand for an outage).

export const USAGE_ID = "0b6f7a52-2d8e-4c71-9a3e-7f1d2c3b4a5e";
export const USAGE_NONCE = "5c1e9d3a-8b2f-4e6a-b7c4-1a2b3c4d5e6f";

/** What usage_begin answers when the call may go ahead. */
export const ALLOWED = { ok: true, id: USAGE_ID, nonce: USAGE_NONCE };

type Answer = (text: string, params: unknown[]) => unknown[];

export function usageAnswer(begin: () => unknown = () => ALLOWED, other: Answer = () => []): Answer {
  return (text, params) => {
    if (text.includes("public.usage_begin(")) return [{ reply: begin() }];
    if (text.includes("public.usage_finish(")) return [{ usage_finish: "" }];
    return other(text, params);
  };
}

/** The statements that called one database function. */
export function calls(statements: Statement[], fn: string): Statement[] {
  return statements.filter((statement) => statement.text.includes(`public.${fn}(`));
}
