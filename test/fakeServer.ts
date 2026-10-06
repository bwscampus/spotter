import { vi } from "vitest";

// Shared fakes for route and session tests: a cookie jar standing in for
// next/headers, and a database that records every statement it is given.

export type Cookie = { value: string; options?: Record<string, unknown> };

export function fakeCookieJar(initial: Record<string, string> = {}) {
  const store = new Map<string, Cookie>(Object.entries(initial).map(([k, v]) => [k, { value: v }]));
  return {
    store,
    get: (name: string) => (store.has(name) ? { name, value: store.get(name)!.value } : undefined),
    set: vi.fn((name: string, value: string, options?: Record<string, unknown>) => {
      store.set(name, { value, options });
    }),
    delete: vi.fn((name: string) => {
      store.delete(name);
    }),
  };
}

export type Statement = { text: string; params: unknown[] };

/** A database whose answers are decided by `answer`, recording what it was asked. */
export function fakeDatabase(answer: (text: string, params: unknown[]) => unknown[] = () => []) {
  const statements: Statement[] = [];
  const run = async (text: string, params: unknown[] = []) => {
    statements.push({ text, params });
    return answer(text, params);
  };
  const client = { query: async (text: string, params: unknown[] = []) => ({ rows: await run(text, params) }) };
  return {
    statements,
    module: {
      query: vi.fn(run),
      queryOne: vi.fn(async (text: string, params: unknown[] = []) => (await run(text, params))[0] ?? null),
      withTransaction: vi.fn(async (fn: (c: typeof client) => Promise<unknown>) => fn(client)),
      getPool: vi.fn(),
    },
  };
}
