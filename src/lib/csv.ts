// Writing a sheet out as CSV. Kept beside the other cell helpers rather than in
// the page, because what counts as a figure has to be decided the same way here
// as in the .xlsx export.

import { detectBarcodeColumn } from "./barcode"
import {
  type DecimalMark,
  columnPlaces,
  formatFigure,
  inferColumnKinds,
  inferDecimalMarks,
  parseNumber,
} from "./cell-value"
import type { Sheet } from "./tiers"

/**
 * Turkish Excel splits a CSV on semicolons, because the comma is the decimal
 * point — a comma-separated file opens as one column per row, with every price
 * in quotes. So the separator follows the language the sheet is being read in,
 * which is also the convention this app's own CSV reader expects.
 *
 * Figures are written the way the .xlsx writes them: the value alone, to the
 * places the column prints, with no unit and no grouping. A file made for
 * another program to read has to hold figures it can read, and "1.088,9005 TL"
 * is not one — it is the sheet's own text, and a stock program importing text
 * imports no price at all.
 */
export function toCsv(sheet: Sheet, delimiter: string, decimal: DecimalMark): string {
  const needsQuotes = new RegExp(`["\\n\\r${delimiter}]`)
  const kinds = inferColumnKinds(sheet)
  const marks = inferDecimalMarks(sheet)
  // A barcode parses as a figure and is not one.
  const barcodeAt = detectBarcodeColumn(sheet)
  const places = kinds.map((kind, ci) =>
    kind === "number" ? columnPlaces(sheet, ci, marks[ci]) : 0,
  )

  const esc = (v: string) => {
    const s = String(v ?? "")
    return needsQuotes.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const cell = (v: string, ci: number) => {
    const s = String(v ?? "")
    if (ci === barcodeAt || kinds[ci] !== "number") return esc(s)
    const value = parseNumber(s, marks[ci])
    // A cell its column can't read keeps its own text rather than vanishing.
    return value === null ? esc(s) : formatFigure(value, places[ci], decimal)
  }

  const lines: string[] = []
  if (sheet.columns.length) lines.push(sheet.columns.map(esc).join(delimiter))
  for (const row of sheet.rows) lines.push(row.map(cell).join(delimiter))
  return "﻿" + lines.join("\r\n")
}
