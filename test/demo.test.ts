import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { asSaid, buildDemoGame, DemoCaller } from "@/lib/demo/demoGame";
import { DEMO_PLAYER_ROWS, DEMO_SCRIPT } from "@/lib/demo/footballDemo";

// The public demo (Nov 19): made-up football teams through the real engine,
// with no fetch, mic or spend. Every script line puts up exactly the cards it
// says and every quiet line puts up none, so what a visitor watches is what a
// real game does.

const surnames = (players: { last_name: string }[]) => players.map((player) => player.last_name).sort();

describe("the demo's game", () => {
  it("builds both teams through the real assembly, linemen left out", () => {
    const game = buildDemoGame();
    const spotted = DEMO_PLAYER_ROWS.filter((row) => row.spot_mode !== "off");
    expect(game.players).toHaveLength(spotted.length);
    expect(game.players.every((player) => player.face !== undefined)).toBe(true);
  });

  it("never repeats a jersey across the two teams, so a number has one answer", () => {
    const jerseys = DEMO_PLAYER_ROWS.map((row) => row.jersey);
    expect(new Set(jerseys).size).toBe(jerseys.length);
  });

  it("puts up exactly each line's cards, and nothing on a quiet line", () => {
    const caller = new DemoCaller(buildDemoGame());
    for (const line of DEMO_SCRIPT) {
      const heard = caller.say(line.said);
      expect(surnames(heard.up), line.said).toEqual([...line.cards].sort());
      if (line.cards.length === 0) expect(line.quiet, line.said).toBeTruthy();
    }
    expect(DEMO_SCRIPT.filter((line) => line.cards.length === 0).length).toBeGreaterThanOrEqual(8);
  });

  it("takes a typed or spoken line the way the speech engine writes it", () => {
    expect(asSaid("Number twenty-two!")).toBe("number 22");
    expect(asSaid("#22 Langan")).toBe("number 22 langan");
    expect(asSaid("number nine")).toBe("number 9");
    expect(asSaid("Number Eighty One")).toBe("number 81");
    expect(asSaid("Twelve")).toBe("12");
    const caller = new DemoCaller(buildDemoGame());
    expect(surnames(caller.say("Number twenty two").up)).toEqual(["Langan"]);
    expect(surnames(caller.say("KOWALCZYK keeps it").up)).toEqual(["Kowalczyk"]);
    expect(caller.say("third and seven").up).toEqual([]);
    caller.reset();
    expect(caller.say("hawks lead 7 to 0").onScreen).toEqual([]);
  });
});

describe("the demo stays offline", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : [path];
    });

  it("never fetches, calls an API route, tracks, or reaches live stats", () => {
    const sources = [...files("lib/demo"), ...files("components/demo"), ...files("app/demo")].map((path) => [path, readFileSync(path, "utf8")] as const);
    expect(sources.length).toBeGreaterThan(3);
    for (const [path, source] of sources) {
      expect(source, path).not.toMatch(/\bfetch\(|apiClient|\bapi\(|analytics\/track|lib\/livestats|components\/livestats|lib\/replay/);
    }
  });
});
