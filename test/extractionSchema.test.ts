import { describe, expect, it } from "vitest";
import { ROSTER_SCHEMA } from "@/lib/rosters/extractionPrompt";
import { GENDERS, LEVELS, SPORTS } from "@/lib/rosters/types";

// =============================================================================
// The schema is validated by Anthropic before it ever reads the PDF, so a
// malformed one fails every upload identically, whatever the roster. That is
// exactly what happened: `{ type: ["string", "null"], enum: [...SPORTS, null] }`
// was rejected with "Enum value 'volleyball' does not match declared type
// '['string','null']'", and no roster had ever been read.
//
// These walk the schema rather than checking three known fields, so the next
// nullable enum someone adds is covered too.
// =============================================================================

type Node = Record<string, unknown>;

/** Every object in the schema, including the ones nested in anyOf and items. */
function walk(node: unknown, path = "$"): Array<{ path: string; node: Node }> {
  if (typeof node !== "object" || node === null) return [];
  if (Array.isArray(node)) return node.flatMap((entry, index) => walk(entry, `${path}[${index}]`));

  const here = [{ path, node: node as Node }];
  return here.concat(
    Object.entries(node).flatMap(([key, value]) => walk(value, `${path}.${key}`)),
  );
}

const NODES = walk(ROSTER_SCHEMA);

/** The values a property will accept, whether written as an enum or an anyOf of them. */
function accepted(property: unknown): Array<string | null> {
  const node = property as Node;
  if (Array.isArray(node.enum)) return node.enum as Array<string | null>;
  if (Array.isArray(node.anyOf)) {
    return (node.anyOf as Node[]).flatMap((branch) =>
      Array.isArray(branch.enum)
        ? (branch.enum as string[])
        : branch.type === "null"
          ? [null]
          : [],
    );
  }
  return [];
}

const team = (ROSTER_SCHEMA.properties.team.properties ?? {}) as Record<string, unknown>;

describe("ROSTER_SCHEMA", () => {
  it("never pairs an enum with a type array", () => {
    // The exact shape Anthropic rejected. A nullable enum is written as anyOf.
    const offenders = NODES.filter(({ node }) => node.enum !== undefined && Array.isArray(node.type));
    expect(offenders.map(({ path }) => path)).toEqual([]);
  });

  it("never puts null inside an enum", () => {
    // The other half of the same mistake: null belongs in its own anyOf branch.
    const offenders = NODES.filter(
      ({ node }) => Array.isArray(node.enum) && (node.enum as unknown[]).includes(null),
    );
    expect(offenders.map(({ path }) => path)).toEqual([]);
  });

  it("accepts every sport, and null", () => {
    expect(accepted(team.sport).sort()).toEqual([...SPORTS, null].sort());
  });

  it("accepts every gender and level, and null", () => {
    expect(accepted(team.gender).sort()).toEqual([...GENDERS, null].sort());
    expect(accepted(team.level).sort()).toEqual([...LEVELS, null].sort());
  });

  it("uses only keywords structured outputs supports", () => {
    // minimum, maxLength and friends are silently unsupported and reject the
    // whole schema, the same way the enum did.
    const banned = ["minimum", "maximum", "multipleOf", "minLength", "maxLength", "pattern", "oneOf", "not"];
    const offenders = NODES.flatMap(({ path, node }) =>
      banned.filter((keyword) => node[keyword] !== undefined).map((keyword) => `${path}.${keyword}`),
    );
    expect(offenders).toEqual([]);
  });

  it("closes every object and requires every property of it", () => {
    // Both are conditions of structured outputs, not preferences.
    for (const { path, node } of NODES) {
      if (node.type !== "object") continue;
      expect(node.additionalProperties, `${path} must be closed`).toBe(false);
      const properties = Object.keys((node.properties ?? {}) as Node);
      expect((node.required as string[] | undefined)?.slice().sort(), `${path} must require all`).toEqual(
        properties.slice().sort(),
      );
    }
  });
});
