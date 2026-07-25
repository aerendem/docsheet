// Barcode → product name matching.
//
// Distributor invoices very often print a barcode and a price but no readable
// product name (or a truncated one). This turns a barcode column into a name
// column by looking each code up in a catalog: your own pasted list, a brand's
// online shop, or the open GTIN databases.
//
// Everything here is pure, so the browser and the server share it.

import { normalizeHeader } from "./combine"
import type { Sheet } from "./tiers"

export interface CatalogEntry {
  /** Digits only, as printed on the pack. */
  barcode: string
  name: string
  /** Which source supplied it — shown in the UI so a wrong name is traceable. */
  source: string
  /** List price, when the source publishes one. */
  price?: string
  /** Manufacturer or brand — the drug registry and most shops publish one. */
  brand?: string
  /** Whatever else the source classifies the product by (ATC code, category). */
  note?: string
}

/** Catalog fields that can be spilled into their own column beside the name. */
export type ExtraField = "brand" | "price" | "note"

export const EXTRA_FIELDS: ExtraField[] = ["brand", "price", "note"]

/** Lookup table keyed by every equivalent form of a barcode. */
export type Catalog = Map<string, CatalogEntry>

const MIN_DIGITS = 6
const MAX_DIGITS = 14

/**
 * Digits of a printed barcode, or null when the text isn't one.
 *
 * OCR (and Excel round-trips) hand us "8697742122934", "869 774 212 2934",
 * "8697742122934.0" and "'8697742122934". Anything that survives as 6-14 digits
 * is treated as a code; a figure with a real decimal part is not.
 */
export function normalizeBarcode(raw: string): string | null {
  if (typeof raw !== "string") return null
  let s = raw.trim()
  if (!s) return null
  // A trailing ".0" / ",00" is a spreadsheet artefact, not a fractional code.
  s = s.replace(/[.,]0+$/, "")
  // Reject anything with a real decimal tail (prices, quantities).
  if (/[.,]\d*[1-9]/.test(s)) return null
  const digits = s.replace(/\D/g, "")
  if (digits.length < MIN_DIGITS || digits.length > MAX_DIGITS) return null
  return digits
}

/**
 * Every form the same product code can be printed in. A 12-digit UPC-A is the
 * 13-digit EAN with a leading zero, and catalogs disagree about whether to keep
 * it — so index both, plus the 14-digit GTIN form.
 */
export function barcodeKeys(digits: string): string[] {
  const bare = digits.replace(/^0+/, "") || "0"
  const keys = new Set([digits, bare])
  if (bare.length < 13) keys.add(bare.padStart(13, "0"))
  if (bare.length < 14) keys.add(bare.padStart(14, "0"))
  return [...keys]
}

/**
 * Index entries for lookup. Later entries win, so callers pass sources in
 * ascending priority — the user's own list last, since it should beat anything
 * fetched online.
 */
export function buildCatalog(sources: CatalogEntry[][]): Catalog {
  const catalog: Catalog = new Map()
  for (const entries of sources) {
    for (const entry of entries) {
      const digits = normalizeBarcode(entry.barcode)
      if (!digits || !entry.name.trim()) continue
      const clean: CatalogEntry = { ...entry, barcode: digits, name: entry.name.trim() }
      for (const key of barcodeKeys(digits)) catalog.set(key, clean)
    }
  }
  return catalog
}

export function lookupBarcode(catalog: Catalog, raw: string): CatalogEntry | null {
  const digits = normalizeBarcode(raw)
  if (!digits) return null
  for (const key of barcodeKeys(digits)) {
    const hit = catalog.get(key)
    if (hit) return hit
  }
  return null
}

// ── Parsing a pasted / uploaded list ──────────────────────────────────────

/** Split on the separator that actually structures the line. */
function splitRow(line: string): string[] {
  if (line.includes("\t")) return line.split("\t")
  if (line.includes(";")) return line.split(";")
  // Only treat commas as separators when they aren't decimal commas inside a
  // price — a plain "barcode,name" line always has the comma outside digits.
  if (/,/.test(line) && !/^\d[\d\s]*,\d{1,2}$/.test(line.trim())) return splitCsv(line)
  return line.split(/\s{2,}/)
}

/** Comma split that respects "quoted, names". */
function splitCsv(line: string): string[] {
  const out: string[] = []
  let cell = ""
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else cell += ch
    } else if (ch === '"') {
      quoted = true
    } else if (ch === ",") {
      out.push(cell)
      cell = ""
    } else cell += ch
  }
  out.push(cell)
  return out
}

export interface ParsedList {
  entries: CatalogEntry[]
  /** Lines that held no usable barcode/name pair — surfaced, not swallowed. */
  skipped: number
}

/**
 * Read a pasted or uploaded list. The barcode may be in either column and the
 * file may or may not have a header, so each line is resolved on its own: the
 * cell that looks like a code is the code, the longest remaining cell is the
 * name.
 */
export function parseCatalogList(text: string, source: string): ParsedList {
  const entries: CatalogEntry[] = []
  let skipped = 0

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue

    const cells = splitRow(trimmed).map((c) => c.trim().replace(/^"|"$/g, ""))
    let codeAt = -1
    for (let i = 0; i < cells.length; i++) {
      if (normalizeBarcode(cells[i])) {
        codeAt = i
        break
      }
    }
    if (codeAt === -1) {
      skipped++
      continue
    }

    let name = ""
    cells.forEach((cell, i) => {
      if (i === codeAt) return
      if (cell.length > name.length) name = cell
    })
    if (!name) {
      skipped++
      continue
    }
    entries.push({ barcode: cells[codeAt], name, source })
  }

  return { entries, skipped }
}

// ── Filling a column ──────────────────────────────────────────────────────

const BARCODE_HEADER = /^(barkod|barcode|gtin|ean|upc|karekod)\b/
const NAME_HEADER =
  /^(mal hizmet|urun adi|urun ismi|urun|malzeme adi|malzeme|aciklama|description|item|product|name)\b/

/** How much of a column has to read as a barcode before we trust it. */
const SHAPE_THRESHOLD = 0.6

/**
 * Which column holds the barcode. A matching header wins outright; otherwise we
 * fall back to the shape of the values, which is what saves invoices whose
 * barcode column is headed "Kod" or nothing at all.
 */
export function detectBarcodeColumn(sheet: Sheet): number {
  for (let i = 0; i < sheet.columns.length; i++) {
    if (BARCODE_HEADER.test(normalizeHeader(sheet.columns[i] ?? ""))) return i
  }

  const width = Math.max(sheet.columns.length, ...sheet.rows.map((r) => r.length), 0)
  let best = -1
  let bestScore = SHAPE_THRESHOLD
  for (let i = 0; i < width; i++) {
    let filled = 0
    let codes = 0
    for (const row of sheet.rows) {
      const cell = (row[i] ?? "").trim()
      if (!cell) continue
      filled++
      // A real barcode is long: 8+ digits. The shorter codes normalizeBarcode
      // accepts would let a quantity or a line number pass as a column.
      const digits = normalizeBarcode(cell)
      if (digits && digits.length >= 8) codes++
    }
    if (!filled) continue
    const score = codes / filled
    if (score > bestScore) {
      bestScore = score
      best = i
    }
  }
  return best
}

/** The column a matched name should fill, when filling in place. */
export function detectNameColumn(sheet: Sheet): number {
  for (let i = 0; i < sheet.columns.length; i++) {
    if (NAME_HEADER.test(normalizeHeader(sheet.columns[i] ?? ""))) return i
  }
  return -1
}

export type FillMode = "new" | "fill"

export interface FillOptions {
  /** Heading for the added column (mode "new"). */
  label: string
  /** "new" appends a column; "fill" completes blanks in the name column. */
  mode: FillMode
  /** Extra catalog fields to spill into their own columns, with their headings. */
  extras?: Array<{ field: ExtraField; label: string }>
}

export interface FillResult {
  sheet: Sheet
  /** -1 when the sheet has no barcode column, so nothing was attempted. */
  barcodeColumn: number
  /** Rows that carry a readable barcode. */
  barcodeRows: number
  /** Of those, how many found a name. */
  matched: number
  /** Distinct codes no source knew. */
  unmatched: string[]
}

/**
 * Add (or complete) a product-name column from the catalog.
 *
 * The sheet is rebuilt rather than mutated: the matcher can be switched off,
 * re-pointed at another source or re-run after a bigger list is pasted, and
 * every one of those has to start from the original extraction.
 */
export function fillNames(sheet: Sheet, catalog: Catalog, opts: FillOptions): FillResult {
  const barcodeColumn = detectBarcodeColumn(sheet)
  if (barcodeColumn === -1) {
    return { sheet, barcodeColumn, barcodeRows: 0, matched: 0, unmatched: [] }
  }

  const label = opts.label.trim() || "Product name"
  const nameColumn = opts.mode === "fill" ? detectNameColumn(sheet) : -1
  // "Fill" with no name column to fill would silently do nothing, so it falls
  // back to appending — the user still gets their names.
  const inPlace = nameColumn !== -1

  const width = Math.max(sheet.columns.length, ...sheet.rows.map((r) => r.length), 0)
  const target = inPlace ? nameColumn : width

  const columns = [...sheet.columns]
  while (columns.length < width) columns.push("")
  if (!inPlace) columns.push(label)

  // Extras always get their own column: there is nothing in the document to
  // fill for a manufacturer or a list price.
  const extras = (opts.extras ?? []).map((extra) => {
    columns.push(extra.label)
    return { field: extra.field, at: columns.length - 1 }
  })

  const unmatched = new Set<string>()
  let barcodeRows = 0
  let matched = 0

  const rows = sheet.rows.map((row) => {
    const out = [...row]
    while (out.length < columns.length) out.push("")

    const digits = normalizeBarcode(out[barcodeColumn] ?? "")
    if (!digits) return out
    barcodeRows++

    const hit = catalog.size ? lookupBarcode(catalog, digits) : null
    if (!hit) {
      unmatched.add(digits)
      return out
    }
    matched++
    // In place, an existing name is the document's own — only blanks are filled.
    if (!inPlace || !out[target].trim()) out[target] = hit.name
    for (const extra of extras) out[extra.at] = hit[extra.field] ?? ""
    return out
  })

  return {
    sheet: { ...sheet, columns, rows },
    barcodeColumn,
    barcodeRows,
    matched,
    unmatched: [...unmatched],
  }
}
