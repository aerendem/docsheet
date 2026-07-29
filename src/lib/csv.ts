// Writing a sheet out as CSV.

import type { DecimalMark } from "./cell-value"
import { writerFor } from "./export-cells"
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
  const writer = writerFor(sheet, decimal)

  const esc = (v: string) => {
    const s = String(v ?? "")
    // Excel evaluates a CSV field that opens with =, + or @ — a description
    // read as "=DEVİR 2026" would arrive as #NAME? instead of as itself. The
    // apostrophe is Excel's own "this is text" mark and isn't displayed; the
    // reader drops it again. A leading minus is left alone: that one really is
    // a negative figure.
    const cell = /^[=+@]/.test(s) && !/^[-+]?[\d.,]+$/.test(s) ? `'${s}` : s
    return needsQuotes.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell
  }

  const lines: string[] = []
  if (sheet.columns.length) lines.push(sheet.columns.map(esc).join(delimiter))
  for (const row of sheet.rows) {
    lines.push(row.map((v, ci) => esc(writer.cell(v, ci))).join(delimiter))
  }
  return "﻿" + lines.join("\r\n")
}
