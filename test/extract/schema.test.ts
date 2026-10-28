import { describe, expect, it } from "vitest";
import { EXTRACT_SCHEMA, NOT_A_PLAY, NULLABLE_FIELDS, validateAnswer } from "@/lib/livestats/extract/schema";

// The extractor's schema (v7, Part 5): at most nine fields, nothing nested,
// the nullable ones under the API's sixteen, and the answer trusted for
// shape only.

/** Every property whose type admits null, anywhere in a schema. */
function nullableProperties(schema: unknown, path = ""): string[] {
  if (typeof schema !== "object" || schema === null) return [];
  const node = schema as Record<string, unknown>;
  const found: string[] = [];
  if (Array.isArray(node.type) && node.type.includes("null")) found.push(path);
  if (Array.isArray(node.anyOf) && node.anyOf.some((option) => typeof option === "object" && option !== null && (option as { type?: unknown }).type === "null")) found.push(path);
  for (const [name, child] of Object.entries((node.properties as Record<string, unknown>) ?? {})) found.push(...nullableProperties(child, path ? `${path}.${name}` : name));
  if (node.items) found.push(...nullableProperties(node.items, `${path}[]`));
  return found;
}

function depth(schema: unknown): number {
  if (typeof schema !== "object" || schema === null) return 0;
  const node = schema as Record<string, unknown>;
  const children = [...Object.values((node.properties as Record<string, unknown>) ?? {}), ...(node.items ? [node.items] : [])];
  return node.type === "object" || node.type === "array" ? 1 + Math.max(0, ...children.map(depth)) : 0;
}

describe("the extractor schema", () => {
  it("has at most nine fields, all required, nothing nested deeper than one", () => {
    const fields = Object.keys(EXTRACT_SCHEMA.properties);
    expect(fields.length).toBeLessThanOrEqual(9);
    expect([...EXTRACT_SCHEMA.required].sort()).toEqual([...fields].sort());
    expect(EXTRACT_SCHEMA.additionalProperties).toBe(false);
    expect(depth(EXTRACT_SCHEMA)).toBe(1);
  });

  it("keeps the nullable fields under sixteen, and knows which they are", () => {
    const nullable = nullableProperties(EXTRACT_SCHEMA);
    expect(nullable.length).toBeLessThanOrEqual(16);
    expect(nullable.sort()).toEqual([...NULLABLE_FIELDS].sort());
  });

  it("never writes a nullable enum as a type list, the trap in CLAUDE.md", () => {
    for (const property of Object.values(EXTRACT_SCHEMA.properties) as Array<Record<string, unknown>>) {
      if ("enum" in property) expect(Array.isArray(property.type)).toBe(false);
    }
  });

  it("is JSON a strict decoder accepts", () => {
    expect(() => JSON.parse(JSON.stringify(EXTRACT_SCHEMA))).not.toThrow();
  });
});

describe("validateAnswer", () => {
  const good = { playType: "rush", carrierIdx: 2, passerIdx: null, receiverIdx: null, tacklerIdx: 3, yardsSaid: 6, touchdown: false, penalty: "none", confidence: "high" };

  it("passes a well-formed answer through", () => {
    expect(validateAnswer(good, 3)).toEqual(good);
  });

  it("turns an index off the list into NOT_NAMED, and a figure off the field into null", () => {
    expect(validateAnswer({ ...good, carrierIdx: 9, tacklerIdx: -1 }, 3)).toMatchObject({ carrierIdx: 0, tacklerIdx: 0 });
    expect(validateAnswer({ ...good, yardsSaid: 400 }, 3)!.yardsSaid).toBeNull();
    expect(validateAnswer({ ...good, yardsSaid: 6.4 }, 3)!.yardsSaid).toBe(6);
    expect(validateAnswer({ ...good, touchdown: "yes" }, 3)!.touchdown).toBe(false);
  });

  it("refuses an unknown enum value or a non-object, so the call is tried once more", () => {
    expect(validateAnswer({ ...good, playType: "kneel" }, 3)).toBeNull();
    expect(validateAnswer({ ...good, confidence: "sure" }, 3)).toBeNull();
    expect(validateAnswer("rush", 3)).toBeNull();
    expect(validateAnswer(null, 3)).toBeNull();
  });

  it("has a not-a-play answer that credits nobody", () => {
    expect(NOT_A_PLAY.playType).toBe("not_a_play");
    expect([NOT_A_PLAY.carrierIdx, NOT_A_PLAY.passerIdx, NOT_A_PLAY.receiverIdx, NOT_A_PLAY.tacklerIdx]).toEqual([null, null, null, null]);
  });
});
