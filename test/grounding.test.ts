import { describe, expect, it } from "vitest";
import { groundPlayers } from "@/lib/rosters/grounding";
import type { RosterPlayer } from "@/lib/rosters/types";

const player = (last_name: string): RosterPlayer => ({
  jersey: "6",
  first_name: "Test",
  last_name,
  position: null,
  grade: null,
  height: null,
  weight: null,
  pronunciations: [],
  spot_mode: "normal",
  flags: [],
});

describe("groundPlayers", () => {
  it("leaves a surname that appears in the source alone", () => {
    const [result] = groundPlayers([player("Tremaine")], "6 Ada Tremaine OH");
    expect(result.flags).toEqual([]);
  });

  it("ignores case", () => {
    const [result] = groundPlayers([player("TREMAINE")], "6 Ada tremaine OH");
    expect(result.flags).toEqual([]);
  });

  it("flags a surname that is not in the source", () => {
    const [result] = groundPlayers([player("Fabricated")], "6 Ada Tremaine OH");
    expect(result.flags).toEqual(["not_in_source"]);
  });

  it("does not flag a curly apostrophe printed straight", () => {
    const [result] = groundPlayers([player("O'Garro")], "11 Jules O’Garro MB");
    expect(result.flags).toEqual([]);
  });

  it("does not flag an accent the text layer dropped differently", () => {
    const [result] = groundPlayers([player("Munoz")], "4 Ana Muñoz S");
    expect(result.flags).toEqual([]);
  });

  it("matches across a line break in the source", () => {
    const [result] = groundPlayers([player("Richardson Barnes")], "12 Marli Richardson\nBarnes OPP");
    expect(result.flags).toEqual([]);
  });

  it("keeps flags Claude already set", () => {
    const withFlag = { ...player("Fabricated"), flags: ["unreadable" as const] };
    const [result] = groundPlayers([withFlag], "nothing here");
    expect(result.flags).toEqual(["unreadable", "not_in_source"]);
  });
});
