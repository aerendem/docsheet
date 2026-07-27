// Turning printed cell text back into typed values. Shared by the preview
// (alignment), the xlsx export (real numbers/dates) and reconciliation (sums).
//
// OCR gives us exactly what the page showed — "1.545,49 TL", "340,50", "12" —
// and a document may use either decimal convention. Everything here is pure so
// it runs on the server and in the browser.

import type { Sheet } from "./tiers"

const CURRENCY = /[$€£₺¥]|\b(?:TL|TRY|USD|EUR|GBP)\b/gi

/**
 * Parse a printed figure, or null if the text isn't one.
 *
 * Separator rule: when both "." and "," appear, the LAST one is the decimal
 * point. With only one separator, a 3-digit tail is read as a thousands group
 * ("1,250" and "1.250" are both 1250) and a 1-2 digit tail as a decimal
 * ("340,50" is 340.5). That matches how invoices actually print money.
 */
export function parseNumber(raw: string): number | null {
  return analyze(raw)?.value ?? null
}

/** Digits printed after the decimal point, for choosing a number format. */
export function decimalPlaces(raw: string): number {
  return analyze(raw)?.decimals ?? 0
}

function analyze(raw: string): { value: number; decimals: number } | null {
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

  const lastDot = s.lastIndexOf(".")
  const lastComma = s.lastIndexOf(",")
  let decimalAt = -1

  if (lastDot !== -1 && lastComma !== -1) {
    decimalAt = Math.max(lastDot, lastComma)
  } else if (lastDot !== -1 || lastComma !== -1) {
    const at = lastDot !== -1 ? lastDot : lastComma
    const sep = s[at]
    const occurrences = s.split(sep).length - 1
    const tail = s.length - at - 1
    // Repeated separators are always grouping (1.234.567).
    if (occurrences === 1 && tail > 0 && tail <= 2) decimalAt = at
  }

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

  return Array.from({ length: width }, (_, ci) => {
    let filled = 0
    let numbers = 0
    let dates = 0
    let identifier = false
    for (const row of rows) {
      const cell = (row[ci] ?? "").trim()
      if (!cell) continue
      filled++
      if (parseNumber(cell) !== null) numbers++
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
