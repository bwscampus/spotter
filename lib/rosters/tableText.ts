// =============================================================================
// Spreadsheet rosters become plain text rows in the browser, and Claude maps
// the columns (docs/V3_DEFINITION.md 6.2: no hand-written column mapping).
// CSV is parsed here; .xlsx is read by read-excel-file and handed to
// rowsToText the same way. Pure, so both run in tests without a browser.
// =============================================================================

export type Cell = string | number | boolean | Date | null | undefined;

/** Between cells on one line. Chosen because it almost never appears in a roster. */
export const CELL_SEPARATOR = " | ";

/**
 * One line per row, cells joined with " | ". Blank rows go, trailing blank
 * cells go, and a line break inside a cell becomes a space so a row stays on
 * one line.
 */
export function rowsToText(rows: Cell[][]): string {
  const lines: string[] = [];
  for (const row of rows) {
    const cells = row.map(cellText);
    while (cells.length > 0 && cells[cells.length - 1] === "") cells.pop();
    if (cells.length === 0) continue;
    lines.push(cells.join(CELL_SEPARATOR));
  }
  return lines.join("\n");
}

function cellText(cell: Cell): string {
  if (cell === null || cell === undefined) return "";
  if (cell instanceof Date) return Number.isNaN(cell.getTime()) ? "" : cell.toISOString().slice(0, 10);
  return String(cell).replace(/\s+/g, " ").trim();
}

/**
 * RFC 4180 CSV: quoted cells, doubled quotes inside them, commas and line
 * breaks inside quotes, CRLF or LF. A file exported from Excel in Europe uses
 * semicolons and a copied table uses tabs, so the delimiter is whichever of
 * those three the first line has most of.
 */
export function parseCsv(text: string): string[][] {
  const source = text.replace(/^﻿/, "");
  const delimiter = detectDelimiter(source);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"' && cell.length === 0) {
      quoted = true;
    } else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const count = (char: string) => firstLine.split(char).length - 1;
  const candidates: Array<[string, number]> = [
    [",", count(",")],
    ["\t", count("\t")],
    [";", count(";")],
  ];
  candidates.sort((a, b) => b[1] - a[1]);
  return candidates[0][1] > 0 ? candidates[0][0] : ",";
}
