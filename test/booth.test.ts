import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { describeBooth } from "@/components/booth/BoothStatus";
import { loginHref, safeNext } from "@/lib/auth/next";
import { BOOTH_CODE_ALPHABET, isBoothToken, makeCode, normalizeCode } from "@/lib/booth/code";
import { BoothLink, RECONNECT_MS, type EventSourceLike, type LinkDeps } from "@/lib/booth/link";
import { isBoothPost, readBoothMessage, type BoothMessage } from "@/lib/booth/wire";
import { isPublicPath } from "@/lib/publicPaths";

// =============================================================================
// Booth partners (Nov 15): the pieces around the merge layer. The join code,
// the wire format, where a sign-in goes back to, and the live connection.
// =============================================================================

describe("the join code", () => {
  it("never has a character that reads two ways", () => {
    for (const bad of ["0", "O", "1", "I", "L"]) expect(BOOTH_CODE_ALPHABET).not.toContain(bad);
    // 10,000 codes from a real random source: none of them either.
    for (let i = 0; i < 10_000; i++) {
      const code = makeCode((max) => Math.floor(Math.random() * max));
      expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/);
    }
  });

  it("is held to the same characters as the database's check", () => {
    const sql = readFileSync(new URL("../db/migrations/0031_booth.sql", import.meta.url), "utf8");
    const check = /code ~ '\^\[([A-Z0-9]+)\]\{4\}\$'/.exec(sql);
    expect(check?.[1]).toBe(BOOTH_CODE_ALPHABET);
  });

  it("reads as typed: lower case, spaces and a dash are fine; a wrong length or letter is not a code", () => {
    expect(normalizeCode("ab-2c")).toBe("AB2C");
    expect(normalizeCode(" a b 2 c ")).toBe("AB2C");
    expect(normalizeCode("AB2")).toBeNull();
    expect(normalizeCode("AB0C")).toBeNull();
    expect(normalizeCode(42)).toBeNull();
  });

  it("the link's token is 32 random bytes, base64url", () => {
    expect(isBoothToken("A".repeat(43))).toBe(true);
    expect(isBoothToken("A".repeat(42))).toBe(false);
    expect(isBoothToken("A".repeat(42) + "/")).toBe(false);
  });
});

describe("a card event on the wire (rule 4: ids, never names)", () => {
  const ID = "0f0e0d0c-0b0a-4908-8706-050403020100";

  it("takes roster ids and views, and nothing else", () => {
    expect(isBoothPost({ kind: "up", ids: [ID], views: ["facts"] })).toBe(true);
    expect(isBoothPost({ kind: "down", ids: [ID] })).toBe(true);
    expect(isBoothPost({ kind: "view", ids: [ID], view: "scoring" })).toBe(true);
    expect(isBoothPost({ kind: "refresh" })).toBe(true);
    // A name, a word heard, or anything extra is refused.
    expect(isBoothPost({ kind: "up", ids: ["LANGAN"], views: ["facts"] })).toBe(false);
    expect(isBoothPost({ kind: "up", ids: [ID], views: ["facts"], name: "Langan" })).toBe(false);
    expect(isBoothPost({ kind: "up", ids: [ID], views: ["facts"], transcript: "langan up the middle" })).toBe(false);
    expect(isBoothPost({ kind: "up", ids: [ID, ID], views: ["facts", "facts"] })).toBe(false);
    expect(isBoothPost({ kind: "up", ids: [ID, ID, ID, ID].map((each, i) => each.slice(0, -1) + i), views: ["facts", "facts", "facts", "facts"] })).toBe(false);
    // Who sent it is the server's to say, never the sender's.
    expect(isBoothPost({ kind: "down", ids: [ID], from: 0 })).toBe(false);
  });

  it("is read back off the stream only when it reads as one", () => {
    expect(readBoothMessage(JSON.stringify({ type: "card", from: 1, kind: "up", ids: [ID], views: ["facts"] }))).toEqual({
      type: "card",
      from: 1,
      kind: "up",
      ids: [ID],
      views: ["facts"],
    });
    expect(readBoothMessage(JSON.stringify({ type: "card", from: 3, kind: "up", ids: [ID], views: ["facts"] }))).toBeNull();
    expect(readBoothMessage("not json")).toBeNull();
    expect(readBoothMessage(JSON.stringify({ type: "ended" }))).toEqual({ type: "ended" });
  });
});

describe("where a sign-in goes back to", () => {
  const TOKEN = "abcdefghijABCDEFGHIJ0123456789-_abcdefghij";

  it("only the join steps, written exactly so", () => {
    expect(TOKEN).toHaveLength(42);
    const token = `${TOKEN}x`;
    expect(safeNext(`/join/${token}`)).toBe(`/join/${token}`);
    expect(safeNext("/join")).toBe("/join");
    expect(safeNext(`/booth-partner/${token}`)).toBe(`/booth-partner/${token}`);
    for (const bad of ["/home", "https://evil.example/join", "//evil.example", "/join/short", `/join/${token}?x=1`, "/join\\evil", "/settings", null, 3]) {
      expect(safeNext(bad), String(bad)).toBeNull();
    }
  });

  it("the invite pages are open to a visitor who is signed out, so they can say what they are", () => {
    expect(isPublicPath("/join")).toBe(true);
    expect(isPublicPath(`/join/${TOKEN}x`)).toBe(true);
    expect(isPublicPath(`/booth-partner/${TOKEN}x`)).toBe(true);
    expect(isPublicPath("/games/booth/x")).toBe(false);
    expect(loginHref("/join", "signup")).toBe("/login?next=%2Fjoin&mode=signup");
  });
});

/** A fake EventSource and timers, so the connection can be dropped and brought back. */
function fakeBrowser() {
  const sources: Array<EventSourceLike & { closed: boolean }> = [];
  const posts: string[] = [];
  const timers: Array<{ run: () => void; ms: number }> = [];
  const deps: LinkDeps = {
    open: () => {
      const source = { onopen: null, onmessage: null, onerror: null, closed: false, close() { this.closed = true; } } as EventSourceLike & { closed: boolean };
      sources.push(source);
      return source;
    },
    post: async (_url, body) => {
      posts.push(body);
    },
    setTimer: (run, ms) => {
      timers.push({ run, ms });
      return timers.length;
    },
    clearTimer: () => {},
  };
  return { deps, sources, posts, timers };
}

const hello = (you: 0 | 1 | 2, online = true): string =>
  JSON.stringify({ type: "hello", you, members: [{ slot: 0, online: true }, { slot: 1, online }] });

describe("the live connection (lib/booth/link.ts)", () => {
  it("reconnects on its own after a drop, backing off, and hears again once it is back", () => {
    const browser = fakeBrowser();
    const link = new BoothLink("game", "host", browser.deps);
    const heard: BoothMessage[] = [];
    link.listen((message) => heard.push(message));
    link.start();
    browser.sources[0].onmessage?.({ data: hello(0) });
    expect(link.state().status).toBe("open");

    // Dropped.
    browser.sources[0].onerror?.({});
    expect(browser.sources[0].closed).toBe(true);
    expect(link.state().status).toBe("reconnecting");
    expect(browser.timers.at(-1)?.ms).toBe(RECONNECT_MS[0]);
    // A card event while dropped is not queued for later.
    link.send({ kind: "refresh" });
    expect(browser.posts).toEqual([]);

    // Back.
    browser.timers.at(-1)!.run();
    expect(browser.sources).toHaveLength(2);
    browser.sources[1].onopen?.({});
    browser.sources[1].onmessage?.({ data: hello(0) });
    browser.sources[1].onmessage?.({ data: JSON.stringify({ type: "card", from: 1, kind: "down", ids: ["0f0e0d0c-0b0a-4908-8706-050403020100"] }) });
    expect(heard.at(-1)).toMatchObject({ type: "card", kind: "down" });
    link.send({ kind: "refresh" });
    expect(browser.posts).toEqual([JSON.stringify({ kind: "refresh" })]);
  });

  it("waits longer each time it fails in a row, up to the last wait", () => {
    const browser = fakeBrowser();
    const link = new BoothLink("game", "guest", browser.deps);
    link.start();
    for (let i = 0; i < RECONNECT_MS.length + 2; i++) {
      browser.sources.at(-1)!.onerror?.({});
      expect(browser.timers.at(-1)?.ms).toBe(RECONNECT_MS[Math.min(i, RECONNECT_MS.length - 1)]);
      browser.timers.at(-1)!.run();
    }
  });

  it("stops for good when the host ends the game or takes this laptop out", () => {
    const browser = fakeBrowser();
    const link = new BoothLink("game", "guest", browser.deps);
    const heard: string[] = [];
    link.listen((message) => heard.push(message.type));
    link.start();
    browser.sources[0].onmessage?.({ data: hello(1) });
    browser.sources[0].onmessage?.({ data: JSON.stringify({ type: "ended" }) });
    expect(heard).toEqual(["hello", "ended"]);
    expect(link.state().status).toBe("closed");
    link.start();
    expect(browser.sources).toHaveLength(1);
  });

  it("shows in the top bar only once someone else is in the booth", () => {
    expect(describeBooth({ status: "open", you: 0, members: [{ slot: 0, online: true }] })).toBeNull();
    expect(describeBooth({ status: "open", you: 0, members: [{ slot: 0, online: true }, { slot: 1, online: true }] })?.label).toBe("BOOTH");
    expect(describeBooth({ status: "open", you: 0, members: [{ slot: 0, online: true }, { slot: 1, online: false }] })?.label).toBe("BOOTH · PARTNER OFF");
    expect(describeBooth({ status: "reconnecting", you: 1, members: [{ slot: 0, online: true }, { slot: 1, online: true }] })?.label).toBe("BOOTH RECONNECTING");
  });
});
