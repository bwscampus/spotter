import { describe, expect, it } from "vitest";
import { parseCsv, rowsToText } from "@/lib/rosters/tableText";

describe("parseCsv", () => {
  it("reads quoted cells, doubled quotes and commas inside quotes", () => {
    expect(parseCsv('#,Name,Note\n22,"Langan, Sam","said ""LANG-an"""\n')).toEqual([
      ["#", "Name", "Note"],
      ["22", "Langan, Sam", 'said "LANG-an"'],
    ]);
  });

  it("handles CRLF, a byte order mark and no trailing newline", () => {
    expect(parseCsv("﻿a,b\r\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("keeps a line break inside quotes in the cell", () => {
    expect(parseCsv('a,b\n"one\ntwo",3\n')).toEqual([
      ["a", "b"],
      ["one\ntwo", "3"],
    ]);
  });

  it("reads tab and semicolon files too", () => {
    expect(parseCsv("#\tName\n22\tLangan")).toEqual([
      ["#", "Name"],
      ["22", "Langan"],
    ]);
    expect(parseCsv("#;Name\n22;Langan")).toEqual([
      ["#", "Name"],
      ["22", "Langan"],
    ]);
  });
});

describe("rowsToText", () => {
  it("puts one row per line with cells split by a bar", () => {
    expect(rowsToText([["#", "Name"], [22, "Sam Langan"]])).toBe("# | Name\n22 | Sam Langan");
  });

  it("drops blank rows and trailing blank cells, and flattens line breaks", () => {
    expect(rowsToText([["a", "b", "", null], [], [null, ""], ["one\ntwo", undefined]])).toBe("a | b\none two");
  });

  it("writes dates as dates", () => {
    expect(rowsToText([[new Date("2009-04-01T00:00:00Z")]])).toBe("2009-04-01");
  });
});
