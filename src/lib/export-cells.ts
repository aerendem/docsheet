// How a sheet's cells are written for another program to read.
//
// Shared by the CSV download and the clipboard, because they are the same
// promise made twice: a figure that reaches one of them as the text the page
// printed reaches the other as text too, and a stock program importing text
// imports no price at all. The .xlsx export keeps the same rule by writing a
// real number under a format that adds nothing to it.

import { detectBarcodeColumn } from "./barcode"
import {
  type ColumnKind,
  type DecimalMark,
  columnPlaces,
  formatFigure,
  inferColumnKinds,
  inferDecimalMarks,
  parseNumber,
} from "./cell-value"
import type { Sheet } from "./tiers"

export interface SheetWriter {
  kinds: ColumnKind[]
  /**
   * Which columns the receiving program must be told to take as text. A
   * barcode is the case that matters: read as a figure it loses its leading
   * zero and arrives as 8,69774E+12.
   */
  isText: boolean[]
  /** One cell, written for another program to read. */
  cell(raw: string, columnIndex: number): string
}

export function writerFor(sheet: Sheet, decimal: DecimalMark): SheetWriter {
  const kinds = inferColumnKinds(sheet)
  const marks = inferDecimalMarks(sheet)
  const barcodeAt = detectBarcodeColumn(sheet)
  if (barcodeAt !== -1) kinds[barcodeAt] = "text"

  const places = kinds.map((kind, ci) =>
    kind === "number" ? columnPlaces(sheet, ci, marks[ci]) : 0,
  )
  const isText = kinds.map((kind) => kind !== "number" && kind !== "date")

  return {
    kinds,
    isText,
    cell(raw, ci) {
      const s = String(raw ?? "")
      if (kinds[ci] !== "number") return s
      const value = parseNumber(s, marks[ci])
      // A cell its column can't read keeps its own text rather than vanishing.
      return value === null ? s : formatFigure(value, places[ci], decimal)
    },
  }
}
