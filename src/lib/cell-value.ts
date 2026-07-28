// Turning printed cell text back into typed values. Shared by the preview
// (alignment), the xlsx export (real numbers/dates) and reconciliation (sums).
//
// OCR gives us exactly what the page showed — "1.545,49 TL", "340,50", "12" —
// and a document may use either decimal convention. Everything here is pure so
// it runs on the server and in the browser.

import type { Sheet } from "./tiers"

const CURRENCY = /[$€£₺¥]|\b(?:TL|TRY|USD|EUR|GBP)\b/gi

/** Which character a column's figures use as their decimal point. */
export type DecimalMark = "." | ","

/**
 * Parse a printed figure, or null if the text isn't one.
 *
 * Separator rule: when both "." and "," appear, the LAST one is the decimal
 * point. With only one separator, a 3-digit tail is read as a thousands group
 * ("1,250" and "1.250" are both 1250) and a 1-2 digit tail as a decimal
 * ("340,50" is 340.5). That matches how invoices actually print money.
 *
 * Pass `mark` to read the cell under the convention its whole column agrees on
 * instead — see inferDecimalMarks. Alone, a unit cost printed to three places
 * is indistinguishable from a thousands group, and one printed to four is
 * nothing at all; among its neighbours it is neither.
 */
export function parseNumber(raw: string, mark?: DecimalMark): number | null {
  return analyze(raw, mark)?.value ?? null
}

/** Digits printed after the decimal point, for choosing a number format. */
export function decimalPlaces(raw: string, mark?: DecimalMark): number {
  return analyze(raw, mark)?.decimals ?? 0
}

/** Strip everything printed around a figure, leaving digits and separators. */
function digitsOf(raw: string): { s: string; negative: boolean } | null {
  if (typeof raw !== "string") return null
  let s = raw.trim()
  if (!s) return null

  // (1.234,50) is how some documents print a negative.
  let negative = false
  if (/^\(.*\)$/.test(s)) {
    negative = true
    s = s.slice(1, -1).trim()
  }

  s = s.replace(CURRENCY, "").replace(/%/g, "").trim()

  if (/^[-+]/.test(s)) {
    negative = negative || s.startsWith("-")
    s = s.slice(1).trim()
  }
  if (!s) return null

  // Spaces and apostrophes only ever group digits.
  s = s.replace(/[\s']/g, "")
  if (!/^\d[\d.,]*$/.test(s)) return null
  return { s, negative }
}

/** Where the decimal point sits when the cell is all there is to go on. */
function guessDecimal(s: string): number {
  const lastDot = s.lastIndexOf(".")
  const lastComma = s.lastIndexOf(",")
  if (lastDot !== -1 && lastComma !== -1) return Math.max(lastDot, lastComma)

  const at = Math.max(lastDot, lastComma)
  if (at === -1) return -1
  const sep = s[at]
  const occurrences = s.split(sep).length - 1
  const tail = s.length - at - 1
  // Repeated separators are always grouping (1.234.567).
  return occurrences === 1 && tail > 0 && tail <= 2 ? at : -1
}

/**
 * Where the decimal point sits under a convention the column has settled, or
 * null when this cell contradicts it and so isn't a figure of that kind.
 */
function decimalUnder(s: string, mark: DecimalMark): number | null {
  const group = mark === "," ? "." : ","
  const at = s.indexOf(mark)
  if (at === -1) return -1 // a whole number prints the same either way
  if (at !== s.lastIndexOf(mark)) return null // two decimal points
  if (s.slice(at + 1).includes(group)) return null // grouping behind the point
  return at
}

function analyze(raw: string, mark?: DecimalMark): { value: number; decimals: number } | null {
  const cleaned = digitsOf(raw)
  if (!cleaned) return null
  const { s, negative } = cleaned

  const decimalAt = mark ? decimalUnder(s, mark) : guessDecimal(s)
  if (decimalAt === null) return null

  const intRaw = decimalAt === -1 ? s : s.slice(0, decimalAt)
  const fracPart = decimalAt === -1 ? "" : s.slice(decimalAt + 1)
  if (/[.,]/.test(fracPart)) return null

  // Any separator left in the integer part must be grouping digits in threes.
  // Without this "24.07.2026" reads as 24072026 and a date column becomes
  // numbers.
  if (/[.,]/.test(intRaw) && !/^\d{1,3}(?:[.,]\d{3})*$/.test(intRaw)) return null

  const intPart = intRaw.replace(/[.,]/g, "")
  if (!intPart && !fracPart) return null

  const value = Number(`${intPart || "0"}.${fracPart || "0"}`)
  if (!Number.isFinite(value)) return null
  return { value: negative ? -value : value, decimals: fracPart.length }
}

/**
 * Parse a printed date, or null when the format is ambiguous. dd/mm vs mm/dd
 * can't be told apart without knowing the source, so a slash date is only
 * accepted when one component is above 12 — guessing would silently corrupt it.
 */
export function parseDateCell(raw: string): Date | null {
  const s = raw.trim()
  if (!s) return null

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s)
  if (iso) return makeDate(+iso[3], +iso[2], +iso[1])

  // Dots and dashes are European convention: day first.
  const euro = /^(\d{1,2})[.\-](\d{1,2})[.\-](\d{4})$/.exec(s)
  if (euro) return makeDate(+euro[1], +euro[2], +euro[3])

  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s)
  if (slash) {
    const a = +slash[1]
    const b = +slash[2]
    if (a > 12 && b <= 12) return makeDate(a, b, +slash[3])
    if (b > 12 && a <= 12) return makeDate(b, a, +slash[3])
    return null // genuinely ambiguous — leave it as text
  }
  return null
}

function makeDate(day: number, month: number, year: number): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  // Midday UTC keeps the calendar date stable across timezones.
  const d = new Date(Date.UTC(year, month - 1, day, 12))
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null
  return d
}

/**
 * What one printed figure reveals about its column's decimal point, if
 * anything. A cell carrying both separators settles it outright, and so does
 * any tail that isn't three digits long, because a thousands group is always
 * exactly three.
 */
function markOf(raw: string): DecimalMark | undefined {
  const cleaned = digitsOf(raw)
  if (!cleaned) return undefined
  const { s } = cleaned

  const lastDot = s.lastIndexOf(".")
  const lastComma = s.lastIndexOf(",")
  if (lastDot !== -1 && lastComma !== -1) return lastDot > lastComma ? "." : ","

  const at = Math.max(lastDot, lastComma)
  if (at === -1) return undefined
  const sep = s[at] as DecimalMark
  const other: DecimalMark = sep === "," ? "." : ","
  // Used more than once it can only be grouping, which fixes the other as the
  // point: "1.234.567" is a European figure whichever way it is read.
  if (s.split(sep).length - 1 > 1) return other
  const tail = s.length - at - 1
  return tail === 0 || tail === 3 ? undefined : sep
}

/**
 * Which separator each column uses as its decimal point, judged over the whole
 * column rather than cell by cell.
 *
 * A lone separator with three digits behind it is genuinely ambiguous — "1,250"
 * is 1250 on an American invoice and 1.25 on a Turkish one — so the cell rule
 * calls it a thousands group. Down a column of unit costs printed to three and
 * four places that is wrong on almost every row: "837,338" becomes 837338,
 * "711,5625" parses as nothing at all, the column misses the numeric share and
 * exports as text, and a stock program importing text reads no price at all.
 *
 * The column itself nearly always says which convention it is in. Where it
 * says nothing, or says both, the cell rule is left to decide.
 */
export function inferDecimalMarks(
  sheet: Sheet,
  rowLimit = Number.POSITIVE_INFINITY,
): (DecimalMark | undefined)[] {
  const rows = sheet.rows.slice(0, rowLimit)
  const width = Math.max(sheet.columns.length, ...rows.map((r) => r.length), 0)

  return Array.from({ length: width }, (_, ci) => {
    let dot = 0
    let comma = 0
    for (const row of rows) {
      const cell = (row[ci] ?? "").trim()
      // A date is not a figure: left in, "24.07.2026" would vote in every
      // column it sits beside.
      if (!cell || parseDateCell(cell) !== null) continue
      const vote = markOf(cell)
      if (vote === ".") dot++
      else if (vote === ",") comma++
    }
    if (dot > comma) return "."
    if (comma > dot) return ","
    return undefined
  })
}

/** How many places a column prints, so both exports round a figure alike. */
export function columnPlaces(sheet: Sheet, columnIndex: number, mark?: DecimalMark): number {
  let places = 0
  for (const row of sheet.rows) {
    const cell = row[columnIndex] ?? ""
    if (cell.trim()) places = Math.max(places, decimalPlaces(cell, mark))
  }
  return Math.min(places, 6)
}

/**
 * Print a figure for another program to read back: fixed places, the decimal
 * point of the language it is being read in, and no thousands separator —
 * grouping is the one part a foreign reader can take for a decimal point.
 */
export function formatFigure(value: number, places: number, decimal: DecimalMark): string {
  return value.toFixed(places).replace(".", decimal)
}

export type ColumnKind = "number" | "date" | "text"

/**
 * How much of a column has to agree before the column takes that type.
 *
 * Unanimity is too strict for a scanned invoice: one "1.545,49 TL/AD", one
 * "-" where a price was left blank, one note in the margin, and the whole price
 * column stays text — which exports as text, and a stock program importing that
 * spreadsheet reads a text price as no price at all. Cells that don't parse are
 * still written as their own text, so nothing is lost by typing the rest.
 */
const TYPED_SHARE = 0.75

/** A figure never starts with a leading zero: "007" is an identifier. */
const LEADING_ZERO = /^0\d/

/**
 * Classify each column by looking at every filled cell. A column takes a type
 * when the values that agree on it outweigh the ones that don't; a column
 * holding any padded code stays text, so its zeros survive the export.
 */
export function inferColumnKinds(sheet: Sheet, rowLimit = Number.POSITIVE_INFINITY): ColumnKind[] {
  const rows = sheet.rows.slice(0, rowLimit)
  const width = Math.max(sheet.columns.length, ...rows.map((r) => r.length), 0)
  const marks = inferDecimalMarks(sheet, rowLimit)

  return Array.from({ length: width }, (_, ci) => {
    let filled = 0
    let numbers = 0
    let dates = 0
    let identifier = false
    for (const row of rows) {
      const cell = (row[ci] ?? "").trim()
      if (!cell) continue
      filled++
      if (parseNumber(cell, marks[ci]) !== null) numbers++
      const isDate = parseDateCell(cell) !== null
      if (isDate) dates++
      // "05.08.2026" leads with a zero and is still a date, not a code.
      else if (LEADING_ZERO.test(cell)) identifier = true
    }
    if (!filled || identifier) return "text"
    const numeric = numbers / filled
    const dated = dates / filled
    if (numeric >= TYPED_SHARE && numeric >= dated) return "number"
    if (dated >= TYPED_SHARE) return "date"
    return "text"
  })
}
