// Stacks the line-item table from many documents into one sheet.
//
// The model names columns after whatever the page printed, so two suppliers
// give you "Ürün Adı" and "Product Description" for the same thing. Matching on
// a normalised header (plus a synonym table for common invoice terms) is what
// lets those rows sit in one column instead of two.

import type { Sheet } from "./tiers"

export interface ExtractedDoc {
  filename: string
  sheets: Sheet[]
  /** Which table feeds the combined sheet. Defaults to the largest one. */
  primaryIndex?: number
}

/** The chosen table, falling back to the automatic pick. */
export function resolvePrimary(doc: ExtractedDoc): number {
  const chosen = doc.primaryIndex
  if (chosen !== undefined && chosen >= 0 && chosen < doc.sheets.length) return chosen
  return pickPrimarySheet(doc.sheets)
}

export interface CombinedColumn {
  /** Stable identity used to match across documents. */
  key: string
  /** Editable heading shown in the output. */
  label: string
  include: boolean
}

export const SOURCE_KEY = "__source"

/** Strip case, accents and punctuation so "Ürün Adı" and "urun adi" agree. */
export function normalizeHeader(header: string): string {
  return (
    header
      // Dotless ı has no NFD decomposition, so it would be stripped as
      // punctuation and "Adı" would normalise to "ad".
      .replace(/[ıİ]/g, "i")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
  )
}

/**
 * Turkish glues its possessive and plural straight onto the noun, so the same
 * column is headed "Miktar" on one invoice and "Miktarı" on the next, and
 * "Birim Fiyat" is printed "Birim Fiyatı" far more often than not.
 * normalizeHeader has already folded those endings to ASCII, so the set is
 * small enough to spell out; the English plural rides along with it.
 */
const HEADER_SUFFIX = "(?:leri|lari|ler|lar|si|su|i|u|s)?"

/**
 * A heading matcher for a list of base terms, tolerant of those endings.
 * Alternatives are tried in order, so a term goes before any term it starts
 * with — "stok kod" has to win over "kod" for the match length to be the real
 * one. `exact` anchors the end, for a term that must not swallow a longer
 * heading: "Birim" is the unit column, "Birim Fiyat" is not.
 */
function headerMatcher(terms: string[], exact = false): RegExp {
  return new RegExp(`^(?:${terms.join("|")})${HEADER_SUFFIX}${exact ? "$" : "\\b"}`)
}

/** Shared with the barcode matcher, which looks for the same two columns. */
export const BARCODE_HEADER = headerMatcher([
  "barkod",
  "barcode",
  "karekod",
  "gtin",
  "ean",
  "upc",
])
export const ITEM_HEADER = headerMatcher([
  "mal hizmet cins",
  "mal hizmet",
  "malzeme ad",
  "urun ad",
  "urun ism",
  "urun cins",
  "stok ad",
  "ilac ad",
  "ticari ad",
  "aciklama",
  "description",
  "malzeme",
  "product",
  "urun",
  "hizmet",
  "name",
  "item",
  "cins",
])

/** Common invoice headings, Turkish and English, mapped to one identity. */
const SYNONYMS: Array<{ key: string; label: string; match: RegExp }> = [
  { key: "barcode", label: "Barcode", match: BARCODE_HEADER },
  {
    key: "code",
    label: "Code",
    match: headerMatcher([
      "malzeme kod",
      "urun kod",
      "stok kod",
      "reference",
      "code",
      "sku",
      "kod",
      "ref",
    ]),
  },
  { key: "item", label: "Item", match: ITEM_HEADER },
  { key: "quantity", label: "Quantity", match: headerMatcher(["miktar", "adet", "aded", "quantity", "qty"]) },
  { key: "unit", label: "Unit", match: headerMatcher(["olcu birim", "birim", "unit", "olcu"], true) },
  {
    key: "unit_price",
    label: "Unit price",
    match: headerMatcher([
      "birim fiyat",
      "bir fiyat",
      "br fiyat",
      "b fiyat",
      "unit price",
      "fiyat",
      "price",
    ]),
  },
  { key: "discount", label: "Discount", match: headerMatcher(["iskonto", "indirim", "discount"]) },
  { key: "vat", label: "VAT", match: headerMatcher(["kdv", "vat", "tax", "vergi"]) },
  {
    key: "amount",
    label: "Amount",
    match: headerMatcher([
      "mal hizmet tutar",
      "genel toplam",
      "ara toplam",
      "net tutar",
      "line total",
      "toplam",
      "amount",
      "tutar",
      "total",
    ]),
  },
  { key: "date", label: "Date", match: headerMatcher(["tarih", "date"]) },
]

/**
 * Longest match wins, not first: "Mal Hizmet Tutarı" has to resolve to Amount
 * even though the shorter "mal hizmet" Item pattern also matches it.
 */
function identify(header: string): { key: string; label: string } {
  const normalized = normalizeHeader(header)
  if (!normalized) return { key: "__blank", label: header || "" }

  let best: { key: string; label: string; length: number } | null = null
  for (const synonym of SYNONYMS) {
    const hit = synonym.match.exec(normalized)
    if (!hit) continue
    if (!best || hit[0].length > best.length) {
      best = { key: synonym.key, label: synonym.label, length: hit[0].length }
    }
  }
  return best
    ? { key: best.key, label: best.label }
    : { key: normalized, label: header.trim() }
}

/**
 * Resolve one document's headers, keeping columns distinct. Two headers in the
 * same table can match the same synonym ("Ürün Adı" and "Açıklama" are both
 * Item); merging them would make one overwrite the other, so the second keeps
 * its own identity.
 */
function resolveHeaders(headers: string[]): Array<{ key: string; label: string }> {
  const claimed = new Set<string>()
  return headers.map((header) => {
    const resolved = identify(header)
    if (!claimed.has(resolved.key)) {
      claimed.add(resolved.key)
      return resolved
    }
    const unique = `${resolved.key}:${normalizeHeader(header)}`
    claimed.add(unique)
    return { key: unique, label: header.trim() || resolved.label }
  })
}

/**
 * The table worth stacking: the widest one with real rows. Header blocks and
 * totals are 2-column key/value pairs, so they lose to a line-item table.
 */
export function pickPrimarySheet(sheets: Sheet[]): number {
  let best = -1
  let bestScore = -1
  sheets.forEach((sheet, i) => {
    if (sheet.rows.length < 1) return
    const width = Math.max(sheet.columns.length, ...sheet.rows.map((r) => r.length), 0)
    // Rows matter more than width, but a 2-column key/value block is penalised.
    const score = sheet.rows.length * (width <= 2 ? 0.25 : width)
    if (score > bestScore) {
      bestScore = score
      best = i
    }
  })
  return best
}

/**
 * Column set discovered across every document, in first-seen order.
 * `labelFor` lets the UI supply translated headings for known column keys.
 */
export function discoverColumns(
  docs: ExtractedDoc[],
  labelFor?: (key: string, fallback: string) => string,
): CombinedColumn[] {
  const name = (key: string, fallback: string) => labelFor?.(key, fallback) ?? fallback
  const seen = new Map<string, CombinedColumn>()
  seen.set(SOURCE_KEY, { key: SOURCE_KEY, label: name(SOURCE_KEY, "Source"), include: true })

  for (const doc of docs) {
    const index = resolvePrimary(doc)
    if (index === -1) continue
    for (const { key, label } of resolveHeaders(doc.sheets[index].columns)) {
      if (!seen.has(key)) seen.set(key, { key, label: name(key, label), include: true })
    }
  }
  return [...seen.values()]
}

/**
 * Merge each document's primary table into one sheet using the given column
 * set. Values land under matching columns; anything a document doesn't have is
 * left blank rather than shifting the row.
 */
export function combine(docs: ExtractedDoc[], columns: CombinedColumn[]): Sheet {
  const active = columns.filter((c) => c.include)
  const position = new Map(active.map((c, i) => [c.key, i]))
  const rows: string[][] = []

  for (const doc of docs) {
    const index = resolvePrimary(doc)
    if (index === -1) continue
    const sheet = doc.sheets[index]
    const slots = resolveHeaders(sheet.columns).map(({ key }) => position.get(key) ?? -1)

    for (const row of sheet.rows) {
      const out = Array.from({ length: active.length }, () => "")
      const sourceAt = position.get(SOURCE_KEY)
      if (sourceAt !== undefined) out[sourceAt] = doc.filename
      row.forEach((cell, ci) => {
        const at = slots[ci]
        if (at !== undefined && at >= 0) out[at] = cell
      })
      rows.push(out)
    }
  }

  return { name: "Combined", columns: active.map((c) => c.label), rows }
}
