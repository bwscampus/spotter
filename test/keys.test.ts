import { describe, expect, it } from "vitest";
import { isTextEntry } from "@/lib/keys";

/** Enough of an element for the predicate: it reads a tag name, a type and one flag. */
const element = (tagName: string, extra: Record<string, unknown> = {}) =>
  ({ tagName, isContentEditable: false, ...extra }) as unknown as EventTarget;

describe("isTextEntry", () => {
  it("stands aside for anything words are typed into", () => {
    expect(isTextEntry(element("INPUT", { type: "text" }))).toBe(true);
    expect(isTextEntry(element("INPUT", { type: "number" }))).toBe(true);
    expect(isTextEntry(element("TEXTAREA"))).toBe(true);
    expect(isTextEntry(element("DIV", { isContentEditable: true }))).toBe(true);
  });

  it("does not stand aside for a select, which is what killed X after picking a mic", () => {
    expect(isTextEntry(element("SELECT"))).toBe(false);
  });

  it("does not stand aside for buttons or the page itself", () => {
    expect(isTextEntry(element("BUTTON"))).toBe(false);
    expect(isTextEntry(element("BODY"))).toBe(false);
    expect(isTextEntry(element("INPUT", { type: "checkbox" }))).toBe(false);
    expect(isTextEntry(null)).toBe(false);
  });
});
