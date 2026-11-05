import { afterEach, describe, expect, it, vi } from "vitest";
import { readHiddenTonight, writeHiddenTonight } from "@/lib/game/hiddenTonight";

// Hide tonight survives setup's own trips (sound check, Names page, Add a
// team) for this tab and this pair of teams only (review, Nov 3).

const store = new Map<string, string>();
const session = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => store.set(key, value),
  removeItem: (key: string) => store.delete(key),
};

afterEach(() => {
  store.clear();
  vi.unstubAllGlobals();
});

describe("Hide tonight in this tab", () => {
  it("comes back for the same pair, and only that pair", () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("sessionStorage", session);
    writeHiddenTonight("away", "home", ["A12-HILL"]);
    expect(readHiddenTonight("away", "home")).toEqual(["A12-HILL"]);
    expect(readHiddenTonight("home", "away")).toEqual([]);
    expect(readHiddenTonight("away", "")).toEqual([]);
    writeHiddenTonight("away", "home", []);
    expect(readHiddenTonight("away", "home")).toEqual([]);
  });

  it("reads nothing on the server, from blocked storage or from a bad value", () => {
    expect(readHiddenTonight("away", "home")).toEqual([]);
    vi.stubGlobal("window", {});
    vi.stubGlobal("sessionStorage", { ...session, getItem: () => "not json" });
    expect(readHiddenTonight("away", "home")).toEqual([]);
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    expect(() => writeHiddenTonight("away", "home", ["A12-HILL"])).not.toThrow();
    expect(readHiddenTonight("away", "home")).toEqual([]);
  });
});
