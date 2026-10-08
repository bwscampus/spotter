import { beforeEach, describe, expect, it, vi } from "vitest";

// The gate reads the session through lib/server/session. A fake stands in so
// each account state can be set up exactly. Rewritten from V3's test for
// sessions.
// A plain function, not a vi.fn spy: the runner reports an error thrown by a spy
// as a test failure even when the code under test catches it.
let session: () => Promise<SessionUser | null> = async () => null;
// Outside a request there is no cookie store; the session itself is stubbed below.
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/server/session", () => ({ readSession: () => session() }));

import { requireAdmin, requireApprovedUser } from "@/lib/server/auth";
import type { SessionUser } from "@/lib/server/session";
import { SWITCHED_OFF_NOTE } from "@/lib/usage/limits";

const USER = "8f3c2c1e-5b0a-4a8e-9d57-3c4f1e2a9b10";

function signedIn(fields: Partial<SessionUser> = {}) {
  const user: SessionUser = {
    id: USER,
    email: "a@example.com",
    name: null,
    approved: false,
    emailVerified: true,
    isAdmin: false,
    signedInAt: new Date(),
    ...fields,
  };
  session = async () => user;
}

async function body(response: Response) {
  return (await response.json()) as { code: string; error: string };
}

describe("requireApprovedUser", () => {
  beforeEach(() => {
    session = async () => null;
  });

  it("returns 401 when nobody is signed in", async () => {
    session = async () => null;
    const gate = await requireApprovedUser();
    if (gate.ok) throw new Error("expected a refusal");
    expect(gate.response.status).toBe(401);
    expect((await body(gate.response)).code).toBe("signed_out");
  });

  it("returns 403 not_approved while the account waits for approval", async () => {
    signedIn({ approved: false });
    const gate = await requireApprovedUser();
    if (gate.ok) throw new Error("expected a refusal");
    expect(gate.response.status).toBe(403);
    const refusal = await body(gate.response);
    expect(refusal.code).toBe("not_approved");
    expect(refusal.error).toBe(SWITCHED_OFF_NOTE);
  });

  it("lets an approved account through, with its own id from the session", async () => {
    signedIn({ approved: true });
    const gate = await requireApprovedUser();
    expect(gate.ok).toBe(true);
    if (gate.ok) expect(gate.user.id).toBe(USER);
  });

  it("fails closed with 503 when the database cannot be reached", async () => {
    session = async () => {
      throw new Error("connection refused");
    };
    const gate = await requireApprovedUser();
    if (gate.ok) throw new Error("expected a refusal");
    expect(gate.response.status).toBe(503);
    expect((await body(gate.response)).code).toBe("approval_unavailable");
  });

  it("is never cached", async () => {
    signedIn({ approved: false });
    const gate = await requireApprovedUser();
    if (gate.ok) throw new Error("expected a refusal");
    expect(gate.response.headers.get("cache-control")).toBe("no-store");
  });
});

describe("requireAdmin (AUTH-8)", () => {
  beforeEach(() => {
    session = async () => null;
  });

  it("hides itself from an approved non-admin with 404", async () => {
    signedIn({ approved: true, isAdmin: false });
    const gate = await requireAdmin();
    if (gate.ok) throw new Error("expected a refusal");
    expect(gate.response.status).toBe(404);
  });

  it("lets an admin through", async () => {
    signedIn({ approved: true, isAdmin: true });
    expect((await requireAdmin()).ok).toBe(true);
  });
});

// The gate only protects a route that runs it before spending anything. These
// call each route that calls Anthropic or Deepgram with the gate refusing, and
// check nothing left the server. Add every new paid route here.
describe("every paid route runs the gate first", () => {
  const routes = [
    ["deepgram/token", () => import("@/app/api/deepgram/token/route")],
    ["deepgram/check-keyterms", () => import("@/app/api/deepgram/check-keyterms/route")],
    ["rosters/extract", () => import("@/app/api/rosters/extract/route")],
    ["stats/extract", () => import("@/app/api/stats/extract/route")],
  ] as const;

  for (const [name, load] of routes) {
    it(`${name} refuses an unapproved account before calling out`, async () => {
      signedIn({ approved: false });
      vi.stubEnv("DEEPGRAM_API_KEY", "test-key");
      vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      try {
        const { POST } = await load();
        const request = new Request(`https://spotter.example/api/${name}`, {
          method: "POST",
          headers: { "sec-fetch-site": "same-origin", "content-type": "application/json" },
          body: JSON.stringify({ keyterms: ["Ossuetta"] }),
        });
        const response = await POST(request);
        expect(response.status).toBe(403);
        expect((await body(response)).code).toBe("not_approved");
        expect(fetchSpy).not.toHaveBeenCalled();
      } finally {
        fetchSpy.mockRestore();
        vi.unstubAllEnvs();
      }
    });

    it(`${name} refuses a signed-out visitor with 401`, async () => {
      session = async () => null;
      const { POST } = await load();
      const response = await POST(
        new Request(`https://spotter.example/api/${name}`, { method: "POST", headers: { "sec-fetch-site": "same-origin" } }),
      );
      expect(response.status).toBe(401);
    });

    it(`${name} refuses another site`, async () => {
      signedIn({ approved: true });
      const { POST } = await load();
      const response = await POST(
        new Request(`https://spotter.example/api/${name}`, { method: "POST", headers: { "sec-fetch-site": "cross-site" } }),
      );
      expect(response.status).toBe(403);
    });
  }
});
