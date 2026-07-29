// Reading a spreadsheet the user already has.
//
// The matcher, the reconciliation check and the combined sheet all work on the
// same {columns, rows} shape, and none of them care whether a model produced it.
// So a .xlsx or .csv doesn't need the OCR pipeline at all: it is parsed here and
// enters the app exactly as an extraction would — no model call, no cost.

import { repairSheets } from "../lib/barcode"
import type { Sheet } from "../lib/tiers"
import { loadWorkbook } from "./node"

/** A spreadsheet with more rows than this is almost certainly not an invoice. */
const MAX_ROWS = Number(20_000)
const MAX_SHEETS = 20
const MAX_COLUMNS = 200

export class SheetError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.name = "SheetError"
  }
}

export function isSpreadsheetName(name: string): boolean {
  return /\.(xlsx|xlsm|xltx|csv|tsv|txt)$/i.test(name.trim())
}

const isCsvName = (name: string) => /\.(csv|tsv|txt)$/i.test(name.trim())

// ── CSV / TSV ─────────────────────────────────────────────────────────────

/**
 * The separator a file actually uses. Turkish exports are semicolon-delimited
 * far more often than not, because the comma is the decimal point.
 */
function detectDelimiter(sample: string): string {
  const candidates = [";", "\t", ",", "|"]
  let best = ","
  let bestCount = 0
  for (const delimiter of candidates) {
    // Count outside quotes only — "Havuç Yağı, 150ml" isn't two fields.
    let count = 0
    let quoted = false
    for (const ch of sample) {
      if (ch === '"') quoted = !quoted
      else if (!quoted && ch === delimiter) count++
    }
    if (count > bestCount) {
      bestCount = count
      best = delimiter
    }
  }
  return best
}

/**
 * Drop Excel's "the rest of this is text" mark.
 *
 * A CSV — ours or Excel's own — carries a leading apostrophe in front of a cell
 * that opens with =, + or @, because without it Excel evaluates the cell as a
 * formula and a description reading "=DEVİR 2026" arrives as #NAME?. Excel
 * hides the mark; reading the file back has to drop it, or it accumulates.
 */
const unquotePrefix = (cell: string) => (/^'[=+@]/.test(cell) ? cell.slice(1) : cell)

function parseDelimited(text: string): Sheet[] {
  // A BOM would otherwise become part of the first heading.
  const body = text.replace(/^﻿/, "")
  const delimiter = detectDelimiter(body.split(/\r?\n/).slice(0, 20).join("\n"))

  const rows: string[][] = []
  let row: string[] = []
  let cell = ""
  let quoted = false

  const endCell = () => {
    row.push(cell)
    cell = ""
  }
  const endRow = () => {
    endCell()
    // A trailing newline shouldn't add an empty final row.
    if (row.length > 1 || row[0].trim()) rows.push(row)
    row = []
  }

  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (quoted) {
      if (ch === '"') {
        if (body[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else cell += ch
    } else if (ch === '"') {
      quoted = true
    } else if (ch === delimiter) {
      endCell()
    } else if (ch === "\n") {
      endRow()
    } else if (ch !== "\r") {
      cell += ch
    }
  }
  if (cell || row.length) endRow()

  if (!rows.length) throw new SheetError(422, "That file has no rows.")

  const [header, ...body_] = rows
  const width = Math.min(Math.max(header.length, ...body_.map((r) => r.length), 0), MAX_COLUMNS)
  const pad = (r: string[]) =>
    Array.from({ length: width }, (_, i) => unquotePrefix((r[i] ?? "").trim()))

  return [
    {
      name: "Sheet1",
      columns: pad(header),
      rows: body_.slice(0, MAX_ROWS).map(pad),
    },
  ]
}

// ── XLSX ──────────────────────────────────────────────────────────────────

/** Decimal places a number format declares: "#,##0.00" keeps two. */
function formatDecimals(numFmt: unknown): number {
  if (typeof numFmt !== "string") return 0
  // Only the figure part matters; "0.00" inside a quoted unit is not a figure.
  const bare = numFmt.replace(/"[^"]*"/g, "").split(";")[0]
  return /[.,](0+)/.exec(bare)?.[1].length ?? 0
}

/**
 * What the cell shows, not what it stores. A barcode held as a number would
 * otherwise arrive as 8697742122934 in one file and 8.69774E+12 in the next,
 * and a date as an ISO timestamp nobody typed.
 */
function cellText(cell: any): string {
  const value = cell?.value
  if (value === null || value === undefined) return ""
  // A price written as 129.5 under a "#,##0.00" format is drawn as 129,50, and
  // that trailing zero is the difference between a price column and a number
  // column when the sheet is read back in.
  if (typeof value === "number") {
    const places = formatDecimals(cell.numFmt)
    return places > 0 ? value.toFixed(Math.min(places, 6)) : String(value)
  }
  if (value instanceof Date) {
    const dd = String(value.getUTCDate()).padStart(2, "0")
    const mm = String(value.getUTCMonth() + 1).padStart(2, "0")
    return `${dd}.${mm}.${value.getUTCFullYear()}`
  }
  if (typeof value === "object") {
    const rich = value as {
      text?: unknown
      result?: unknown
      richText?: Array<{ text?: string }>
      hyperlink?: string
    }
    if (Array.isArray(rich.richText)) return rich.richText.map((r) => r.text ?? "").join("")
    if (rich.result !== undefined && rich.result !== null) return String(rich.result)
    if (typeof rich.text === "string") return rich.text
    return ""
  }
  // `cell.text` is the formatted string Excel would draw; fall back to the raw
  // value for cells that have no format.
  const text = typeof cell.text === "string" ? cell.text : ""
  return (text || String(value)).trim()
}

async function parseWorkbook(bytes: ArrayBuffer): Promise<Sheet[]> {
  const Workbook = await loadWorkbook()
  const workbook = new Workbook()
  try {
    await workbook.xlsx.load(bytes as any)
  } catch (err) {
    throw new SheetError(422, `That file couldn't be read as a workbook: ${(err as Error).message}`)
  }

  const sheets: Sheet[] = []
  for (const worksheet of workbook.worksheets.slice(0, MAX_SHEETS)) {
    const grid: string[][] = []
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber > MAX_ROWS + 1) return
      const cells: string[] = []
      // `values` is 1-based, so index 0 is always empty.
      const width = Math.min(row.cellCount, MAX_COLUMNS)
      for (let c = 1; c <= width; c++) cells.push(cellText(row.getCell(c)))
      if (cells.some((c) => c.trim())) grid.push(cells)
    })
    if (!grid.length) continue

    const [header, ...rest] = grid
    const width = Math.max(header.length, ...rest.map((r) => r.length), 0)
    const pad = (r: string[]) => Array.from({ length: width }, (_, i) => r[i] ?? "")
    sheets.push({ name: worksheet.name || `Sheet${sheets.length + 1}`, columns: pad(header), rows: rest.map(pad) })
  }

  if (!sheets.length) throw new SheetError(422, "That workbook has no filled rows.")
  return sheets
}

/**
 * Parse an uploaded spreadsheet into the same shape an extraction returns.
 *
 * Barcodes get the same repair an extraction does: a sheet that was itself
 * typed up from a scan carries the same misread letters, and a code with a
 * letter in it matches nothing whichever door it came in through.
 */
export async function readSpreadsheet(
  name: string,
  bytes: ArrayBuffer,
): Promise<{ sheets: Sheet[]; repairedBarcodes: number }> {
  const sheets = isCsvName(name)
    ? parseDelimited(new TextDecoder("utf-8").decode(bytes))
    : await parseWorkbook(bytes)
  return repairSheets(sheets)
}
