// What a "Copy" puts on the clipboard. Kept out of the page so it can be
// tested: the payload is where a paste goes wrong, and pasting is the one
// route to another program that never passes through a file.

import { type DecimalMark } from "./cell-value"
import { writerFor } from "./export-cells"
import type { Sheet } from "./tiers"

const escapeHtml = (value: string) =>
  value.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"))

export interface ClipboardPayload {
  /** Tab-separated, which every spreadsheet splits into columns. */
  text: string
  /** A real table, which is the only way to tell Excel a column is text. */
  html: string
}

/**
 * The whole sheet in both shapes Excel understands.
 *
 * Selecting the preview by hand is what makes a paste land a column out: the
 * drag starts mid-cell, the table scrolls under it, and only the rows on
 * screen come along. This takes every row — and the code columns are marked as
 * text, so a 13-digit barcode stays a barcode instead of arriving as
 * 8,69774E+12.
 *
 * The cells are the sheet *written for a program to read*, not the sheet as
 * the page printed it. A price copied over as "1.088,9005 TL" lands in a stock
 * program as nothing at all — the same empty column the .xlsx and the CSV
 * exist to avoid. Headings are copied as they read.
 */
export function clipboardPayload(sheet: Sheet, decimal: DecimalMark): ClipboardPayload {
  const width = Math.max(sheet.columns.length, ...sheet.rows.map((r) => r.length), 0)
  const writer = writerFor(sheet, decimal)
  // A column with nothing in it is text as far as the receiver is concerned.
  const asText = Array.from({ length: width }, (_, i) => writer.isText[i] ?? true)

  // A tab or a newline inside a cell is the other way a paste shifts.
  const clean = (cell: string) => String(cell ?? "").replace(/[\t\r\n]+/g, " ")
  const cell = (cells: string[], i: number) => clean(writer.cell(cells[i] ?? "", i))
  const heading = (cells: string[], i: number) => clean(cells[i] ?? "")

  const row = (cells: string[], as: typeof cell) =>
    Array.from({ length: width }, (_, i) => as(cells, i)).join("\t")
  const htmlRow = (cells: string[], tag: "th" | "td", as: typeof cell) =>
    `<tr>${Array.from({ length: width }, (_, i) => {
      const style = asText[i] ? ` style="mso-number-format:'\\@'"` : ""
      return `<${tag}${style}>${escapeHtml(as(cells, i))}</${tag}>`
    }).join("")}</tr>`

  return {
    text: [row(sheet.columns, heading), ...sheet.rows.map((r) => row(r, cell))].join("\r\n"),
    html: `<table>${htmlRow(sheet.columns, "th", heading)}${sheet.rows
      .map((r) => htmlRow(r, "td", cell))
      .join("")}</table>`,
  }
}
