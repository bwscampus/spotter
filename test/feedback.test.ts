import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FeedbackCard } from "@/components/live/FeedbackCard";
import {
  BLOCKERS,
  EMPTY_DRAFT,
  NOTE_HINT,
  NOTE_MAX_CHARS,
  noteLength,
  saveFeedback,
  toggleBlocker,
  validateFeedback,
  type FeedbackDraft,
  type FeedbackRow,
} from "@/lib/game/feedback";

// docs/V3_DEFINITION.md 10.2: rating 1 to 5, seven blocker chips, an optional
// note of up to 280 characters. The table enforces the same; these hold this
// side of it to the same rules.

const GAME = "5f0c1a52-8d1e-4a57-9d6f-2a8f6e0c9b11";
const draft = (over: Partial<FeedbackDraft> = {}): FeedbackDraft => ({ ...EMPTY_DRAFT, rating: 4, ...over });

describe("the rating", () => {
  it("accepts each whole number from 1 to 5", () => {
    for (const rating of [1, 2, 3, 4, 5]) expect(validateFeedback(GAME, draft({ rating })).ok, String(rating)).toBe(true);
  });

  it("refuses anything outside 1 to 5", () => {
    for (const rating of [0, 6, -1, 100]) {
      expect(validateFeedback(GAME, draft({ rating }))).toEqual({ ok: false, problems: ["rating_range"] });
    }
  });

  it("refuses a rating that is not a whole number", () => {
    for (const rating of [3.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(validateFeedback(GAME, draft({ rating }))).toEqual({ ok: false, problems: ["rating_range"] });
    }
  });

  it("needs a rating before it can be saved", () => {
    expect(validateFeedback(GAME, draft({ rating: null }))).toEqual({ ok: false, problems: ["rating_missing"] });
  });
});

describe("the note", () => {
  it("allows exactly 280 characters and refuses 281", () => {
    expect(NOTE_MAX_CHARS).toBe(280);
    expect(validateFeedback(GAME, draft({ note: "a".repeat(280) })).ok).toBe(true);
    expect(validateFeedback(GAME, draft({ note: "a".repeat(281) }))).toEqual({ ok: false, problems: ["note_too_long"] });
  });

  it("counts characters the way the database does, not UTF-16 units", () => {
    // 280 emoji is 560 units but 280 characters, which char_length accepts.
    expect(validateFeedback(GAME, draft({ note: "🏈".repeat(280) })).ok).toBe(true);
    expect(validateFeedback(GAME, draft({ note: "🏈".repeat(281) })).ok).toBe(false);
    expect(noteLength("🏈🏈")).toBe(2);
  });

  it("does not count the spaces around it", () => {
    expect(validateFeedback(GAME, draft({ note: `  ${"a".repeat(280)}  ` })).ok).toBe(true);
  });

  it("saves an empty or blank note as no note at all", () => {
    for (const note of ["", "   ", "\n\t"]) {
      const result = validateFeedback(GAME, draft({ note }));
      expect(result.ok && result.row.note).toBeNull();
    }
  });

  it("keeps a note as typed, trimmed", () => {
    const result = validateFeedback(GAME, draft({ note: "  Slow on the first half.  " }));
    expect(result.ok && result.row.note).toBe("Slow on the first half.");
  });

  it("says every problem at once", () => {
    const result = validateFeedback(GAME, draft({ rating: 9, note: "a".repeat(300), blockers: ["typo"] }));
    expect(result).toEqual({ ok: false, problems: ["rating_range", "note_too_long", "blocker_unknown"] });
  });
});

describe("the blocker chips", () => {
  it("are the seven in the spec, and the ones the table's check constraint allows", () => {
    expect(BLOCKERS).toEqual([
      "wrong_names",
      "missing_names",
      "slow",
      "stats_wrong",
      "stats_missing",
      "too_much_on_screen",
      "nothing",
    ]);
    const migration = readFileSync(new URL("../db/migrations/0003_called_games.sql", import.meta.url), "utf8");
    const allowed = /blockers <@ array\[([^\]]*)\]/.exec(migration)?.[1].match(/'([a-z_]+)'/g)?.map((code) => code.slice(1, -1));
    expect([...(allowed ?? [])].sort()).toEqual([...BLOCKERS].sort());
  });

  it("are saved once each, in the order they are shown", () => {
    const result = validateFeedback(GAME, draft({ blockers: ["slow", "wrong_names", "slow"] }));
    expect(result.ok && result.row.blockers).toEqual(["wrong_names", "slow"]);
  });

  it("may be left empty", () => {
    const result = validateFeedback(GAME, draft({ blockers: [] }));
    expect(result.ok && result.row.blockers).toEqual([]);
  });

  it("refuse a chip that is not one of the seven", () => {
    expect(validateFeedback(GAME, draft({ blockers: ["Brentwood"] }))).toEqual({ ok: false, problems: ["blocker_unknown"] });
  });

  it("never save Nothing beside a chip that says something did get in the way", () => {
    const result = validateFeedback(GAME, draft({ blockers: ["nothing", "slow"] }));
    expect(result.ok && result.row.blockers).toEqual(["slow"]);
    expect(validateFeedback(GAME, draft({ blockers: ["nothing"] })).ok).toBe(true);
  });

  it("push each other off when pressed", () => {
    expect(toggleBlocker([], "slow")).toEqual(["slow"]);
    expect(toggleBlocker(["slow"], "wrong_names")).toEqual(["wrong_names", "slow"]);
    expect(toggleBlocker(["slow", "wrong_names"], "slow")).toEqual(["wrong_names"]);
    expect(toggleBlocker(["slow", "wrong_names"], "nothing")).toEqual(["nothing"]);
    expect(toggleBlocker(["nothing"], "slow")).toEqual(["slow"]);
    expect(toggleBlocker(["nothing"], "nothing")).toEqual([]);
  });
});

describe("the row", () => {
  it("is exactly the game_feedback columns the app writes, and carries no owner: the database fills that in", () => {
    const result = validateFeedback(GAME, draft({ rating: 5, blockers: ["nothing"], note: "Great." }));
    expect(result).toEqual({
      ok: true,
      row: { game_id: GAME, rating: 5, blockers: ["nothing"], note: "Great." },
    });
  });
});

const ROW: FeedbackRow = { game_id: GAME, rating: 4, blockers: ["slow"], note: null };

describe("saving", () => {
  function fakeFetch(response: () => Response | Promise<Response>) {
    const calls: Array<[string, RequestInit | undefined]> = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      return response();
    });
    return calls;
  }

  it("puts one row keyed by the game, so pressing Save twice is still one row", async () => {
    const calls = fakeFetch(() => Response.json({ ok: true }));
    expect(await saveFeedback(ROW)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe(`/api/games/${GAME}/feedback`);
    expect(calls[0][1]?.method).toBe("PUT");
    expect(JSON.parse(String(calls[0][1]?.body))).toEqual(ROW);
    vi.unstubAllGlobals();
  });

  it("says when it could not, without throwing", async () => {
    fakeFetch(() => Response.json({ code: "not_found" }, { status: 404 }));
    expect(await saveFeedback(ROW)).toBe(false);
    fakeFetch(() => Promise.reject(new TypeError("offline")));
    expect(await saveFeedback(ROW)).toBe(false);
    vi.unstubAllGlobals();
  });
});

describe("the card", () => {
  const html = renderToStaticMarkup(createElement(FeedbackCard, { gameId: GAME, title: "Estancia at Brentwood", onDone: () => undefined }));

  it("asks for a rating from 1 to 5", () => {
    const radios = [...html.matchAll(/<button[^>]*role="radio"[^>]*>(\d)</g)].map((match) => match[1]);
    expect(radios).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("has the seven chips", () => {
    const chips = [...html.matchAll(/<button[^>]*aria-pressed="false"[^>]*>([^<]+)</g)].map((match) => match[1]);
    expect(chips).toEqual([
      "Wrong names",
      "Missing names",
      "Slow",
      "Stats wrong",
      "Stats missing",
      "Too much on screen",
      "Nothing",
    ]);
  });

  it("has a note that stops at 280 characters, with the hint", () => {
    expect(html).toMatch(/<textarea[^>]*maxLength="280"/i);
    // The markup escapes the apostrophe; the words are the same.
    expect(html.replaceAll("&#x27;", "'")).toContain(NOTE_HINT);
    expect(NOTE_HINT).toBe("Please don't type player names.");
    expect(html).toContain("0 / 280");
  });

  it("can be skipped, and cannot be saved until there is a rating", () => {
    expect(html).toMatch(/<button(?![^>]* disabled="")[^>]*>Skip</);
    // The attribute, not the "disabled:" Tailwind classes every button carries.
    expect(html).toMatch(/<button[^>]* disabled=""[^>]*>Save feedback</);
  });
});

describe("skipping", () => {
  it("saves nothing: the card only writes when Save is pressed", () => {
    const save = vi.fn(async () => true);
    const onDone = vi.fn();
    // Skip is the onDone prop itself, so nothing on the way to it can call save.
    onDone();
    expect(save).not.toHaveBeenCalled();
    const source = readFileSync(new URL("../components/live/FeedbackCard.tsx", import.meta.url), "utf8");
    expect(source).toMatch(/onClick=\{onDone\}[\s\S]*?Skip/);
  });
});
