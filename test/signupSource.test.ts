import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ENUM_PROPS, EVENT_NAMES, sanitizeProps } from "@/lib/analytics/events";
import { readSignupSource, SIGNUP_SOURCES, signupHref } from "@/lib/auth/signupSource";

// Where a sign-up came from (Nov 19, Phase 0 of the UX overhaul): read from
// ?from= and a sign-up body, kept on account.signed_up, and recorded by the
// server for an email sign-up, which alone knows it made an account.

describe("where a sign-up came from", () => {
  it("keeps only the known sources", () => {
    expect(readSignupSource("demo")).toBe("demo");
    expect(readSignupSource("landing")).toBe("landing");
    expect(readSignupSource("twitter")).toBe("direct");
    expect(readSignupSource(undefined, "login")).toBe("login");
    expect(readSignupSource(["demo"])).toBe("direct");
  });

  it("builds the sign-up links", () => {
    expect(signupHref("demo")).toBe("/login?mode=signup&from=demo");
    expect(signupHref("landing")).toBe("/login?mode=signup&from=landing");
  });

  it("is a declared enum on account.signed_up, so analytics keeps it", () => {
    expect(ENUM_PROPS["account.signed_up"]?.from).toEqual(SIGNUP_SOURCES);
    expect(sanitizeProps("account.signed_up", { method: "email", from: "demo" })).toEqual({ method: "email", from: "demo" });
    expect(sanitizeProps("account.signed_up", { method: "email", from: "someone@example.com" })).toEqual({ method: "email" });
    expect(EVENT_NAMES).toContain("onboarding.confirm_resent");
  });

  it("is sent with an email sign-up and recorded by the route only for a new account", () => {
    const form = readFileSync("components/auth/LoginForm.tsx", "utf8");
    expect(form).toContain('mode === "signup" ? { email: address, password, from }');
    const route = readFileSync("app/api/auth/signup/route.ts", "utf8");
    const created = route.slice(route.indexOf("if (created) {"), route.indexOf("} else {", route.indexOf("if (created) {")));
    expect(created).toContain('recordServerEvent(created.id, "account.signed_up", { method: "email", from: readSignupSource(body.from) })');
  });

  it("is recorded on production only", () => {
    const writer = readFileSync("lib/server/serverEvents.ts", "utf8");
    expect(writer).toContain('process.env.RAILWAY_ENVIRONMENT_NAME !== "production"');
  });
});

describe("the server-side event writer", () => {
  it("writes one production row with the props, and nothing elsewhere", async () => {
    const { vi } = await import("vitest");
    const insert = vi.fn().mockResolvedValue(undefined);
    vi.doMock("@/lib/server/repo/events", () => ({ insertEvents: insert }));
    const { recordServerEvent } = await import("@/lib/server/serverEvents");
    const owner = "00000000-0000-4000-8000-000000000001";

    vi.stubEnv("RAILWAY_ENVIRONMENT_NAME", "testrun2");
    await recordServerEvent(owner, "account.signed_up", { method: "email", from: "demo" });
    expect(insert).not.toHaveBeenCalled();

    vi.stubEnv("RAILWAY_ENVIRONMENT_NAME", "production");
    await recordServerEvent(owner, "account.signed_up", { method: "email", from: "demo" });
    expect(insert).toHaveBeenCalledTimes(1);
    const [ownerId, meta, events] = insert.mock.calls[0];
    expect(ownerId).toBe(owner);
    expect(meta.env).toBe("production");
    expect(events).toEqual([expect.objectContaining({ name: "account.signed_up", game_id: null, props: { method: "email", from: "demo" } })]);

    insert.mockRejectedValueOnce(Object.assign(new Error("down"), { code: "ECONNREFUSED" }));
    await expect(recordServerEvent(owner, "account.signed_up", { method: "email", from: "demo" })).resolves.toBeUndefined();
    vi.unstubAllEnvs();
    vi.doUnmock("@/lib/server/repo/events");
  });
});
