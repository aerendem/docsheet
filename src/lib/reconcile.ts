// Cross-checks an extraction against the document's own arithmetic: if the
// line items add up to the total the document states, nothing was missed or
// misread. An OCR error that changes a digit almost always breaks the sum.

import { inferColumnKinds, inferDecimalMarks, parseNumber } from "./cell-value"
import type { Sheet } from "./tiers"

export interface Reconciliation {
  ok: boolean
  /** Where the summed column lives. */
  sheetName: string
  columnName: string
  sum: number
  stated: number
  statedLabel: string
  /** sum - stated */
  delta: number
}

/** Money rounds; a few cents across a hundred rows isn't an error. */
const TOLERANCE = 0.05

/** Headers that mark a column as the one meant to add up to the total. */
const AMOUNT_COLUMN = /tutar|amount|total|toplam|bedel/i

const LABEL_TIERS = [
  /genel\s*toplam|ödenecek|odenecek|grand\s*total|total\s*payable|vergiler\s*dahil/i,
  /\btoplam\b|\btotal\b/i,
  /\btutar\b|\bamount\b|\bsum\b/i,
]

interface Stated {
  label: string
  value: number
  tier: number
}

interface ColumnSum {
  sheetName: string
  columnName: string
  sum: number
}

/** @returns null when the document states no total to check against. */
export function reconcile(sheets: Sheet[]): Reconciliation | null {
  const stated = collectStatedTotals(sheets)
  const sums = collectColumnSums(sheets)
  if (!stated.length || !sums.length) return null

  stated.sort((a, b) => a.tier - b.tier || b.value - a.value)

  for (const candidate of stated) {
    for (const col of sums) {
      if (Math.abs(col.sum - candidate.value) <= TOLERANCE) {
        return {
          ok: true,
          sheetName: col.sheetName,
          columnName: col.columnName,
          sum: col.sum,
          stated: candidate.value,
          statedLabel: candidate.label,
          delta: 0,
        }
      }
    }
  }

  // Nothing matched. Report it only when the document actually has a column
  // meant to add up to that total ("Tutar", "Amount"); comparing an arbitrary
  // numeric column against a total would invent errors. Size of the gap is not
  // a reason to stay quiet — a big gap is the whole point of checking.
  const best = stated[0]
  const amountColumns = sums.filter((c) => AMOUNT_COLUMN.test(c.columnName))
  if (!amountColumns.length || !best.value) return null

  let closest = amountColumns[0]
  for (const col of amountColumns) {
    if (Math.abs(col.sum - best.value) < Math.abs(closest.sum - best.value)) closest = col
  }

  return {
    ok: false,
    sheetName: closest.sheetName,
    columnName: closest.columnName,
    sum: closest.sum,
    stated: best.value,
    statedLabel: best.label,
    delta: closest.sum - best.value,
  }
}

/** Label/value pairs like "Genel Toplam | 149.265,70". */
function collectStatedTotals(sheets: Sheet[]): Stated[] {
  const out: Stated[] = []
  for (const sheet of sheets) {
    for (const row of sheet.rows) {
      const cells = row.filter((c) => c.trim())
      if (cells.length !== 2) continue
      const [label, raw] = cells
      const value = parseNumber(raw)
      if (value === null) continue
      const tier = LABEL_TIERS.findIndex((re) => re.test(label))
      if (tier === -1) continue
      out.push({ label: label.trim(), value, tier })
    }
  }
  return out
}

/** Every numeric column that has enough values to be a line-item column. */
function collectColumnSums(sheets: Sheet[]): ColumnSum[] {
  const out: ColumnSum[] = []
  for (const sheet of sheets) {
    if (sheet.rows.length < 2) continue
    const kinds = inferColumnKinds(sheet)
    const marks = inferDecimalMarks(sheet)
    kinds.forEach((kind, ci) => {
      if (kind !== "number") return
      let sum = 0
      let filled = 0
      for (const row of sheet.rows) {
        const value = parseNumber(row[ci] ?? "", marks[ci])
        if (value === null) continue
        sum += value
        filled++
      }
      if (filled < 2) return
      out.push({
        sheetName: sheet.name,
        columnName: sheet.columns[ci] || `Column ${ci + 1}`,
        // Kill float drift from summing money.
        sum: Math.round(sum * 100) / 100,
      })
    })
  }
  return out
}
