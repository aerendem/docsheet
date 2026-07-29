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
 * Turkish glues its endings straight onto the noun, so the same column is
 * headed "Miktar" on one invoice and "Miktarı" on the next, and "Birim Fiyat"
 * is printed "Birim Fiyatı" far more often than not. The genitive is in here
 * too, because an invoice heading is as often a possessive phrase as a noun:
 * "Malın Cinsi", "Emtianın Cinsi". normalizeHeader has already folded these to
 * ASCII, so the set is small enough to spell out; the English plural rides
 * along with it.
 */
const HEADER_SUFFIX = "(?:leri|lari|ler|lar|nin|nun|si|su|in|un|i|u|s)?"

/**
 * One term as a pattern, with every word of it allowed an ending — not just
 * the last. A possessive phrase inflects both nouns, so "Ürün Adı" is printed
 * "Ürünün Adı" and "Mal Cinsi" is printed "Malın Cinsi", and a rule that only
 * loosened the final word would miss the term it plainly is.
 */
const termPattern = (term: string) => term.split(" ").join(`${HEADER_SUFFIX}\\s+`)

/**
 * A heading matcher for a list of base terms, tolerant of those endings.
 * Alternatives are tried in order, so a term goes before any term it starts
 * with — "stok kod" has to win over "kod" for the match length to be the real
 * one. `exact` anchors the end, for a term that must not swallow a longer
 * heading: "Birim" is the unit column, "Birim Fiyat" is not.
 */
export function headerMatcher(terms: string[], exact = false): RegExp {
  const tail = `${HEADER_SUFFIX}${exact ? "$" : "\\b"}`
  return new RegExp(`^(?:${terms.map(termPattern).join("|")})${tail}`)
}

/**
 * A synonym's matcher, plus how strongly a given heading matched it.
 *
 * The rank is the position of the first term the heading answers to. Terms are
 * listed most-specific first, so a lower rank is a heading that names the thing
 * more plainly — which is how two headings matching the same synonym in one
 * table are told apart.
 */
function withTerms(terms: string[], exact = false) {
  const tail = `${HEADER_SUFFIX}${exact ? "$" : "\\b"}`
  const each = terms.map((term) => new RegExp(`^(?:${termPattern(term)})${tail}`))
  return {
    match: headerMatcher(terms, exact),
    rankOf(normalized: string): number {
      const at = each.findIndex((re) => re.test(normalized))
      return at === -1 ? terms.length : at
    },
  }
}

/** Shared with the barcode matcher, which looks for the same two columns. */
const BARCODE_TERMS = ["barkod", "barcode", "karekod", "gtin", "ean", "upc"]
export const BARCODE_HEADER = headerMatcher(BARCODE_TERMS)
/**
 * What the goods are called, in the order a heading should be believed.
 *
 * Order is doing two jobs. A term goes before any term it starts with, so the
 * match length is the real one ("malzeme" before "mal"). And where a table
 * carries more than one of these — an invoice with both "Ürün Adı" and
 * "Açıklama" is ordinary — the earlier term is the one taken for the product
 * name, so the free-text ones sit at the end. A document with nothing but
 * "Açıklama" still gets its item column: it is only outranked when something
 * more name-like is there to outrank it.
 */
const ITEM_TERMS = [
  "mal hizmet cins",
  "mal hizmet",
  "malzeme ad",
  "urun ad",
  "urun ism",
  "urun cins",
  "esya ad",
  "esya cins",
  "mal ad",
  "mal cins",
  "emtia cins",
  "emtia",
  "stok ad",
  "ilac ad",
  "ticari ad",
  "preparat ad",
  "mustahzar ad",
  "product name",
  "product description",
  "item name",
  "item description",
  "goods",
  "article",
  "malzeme",
  "product",
  "urun",
  "hizmet",
  "mal",
  "name",
  "item",
  "cins",
  "aciklama",
  "description",
]
export const ITEM_HEADER = headerMatcher(ITEM_TERMS)

/** Common invoice headings, Turkish and English, mapped to one identity. */
const SYNONYMS: Array<{
  key: string
  label: string
  match: RegExp
  rankOf: (normalized: string) => number
}> = [
  { key: "barcode", label: "Barcode", ...withTerms(BARCODE_TERMS) },
  {
    key: "code",
    label: "Code",
    ...withTerms([
      "malzeme kod",
      "urun kod",
      "stok kod",
      "mal kod",
      "reference",
      "code",
      "sku",
      "kod",
      "ref",
    ]),
  },
  { key: "item", label: "Item", ...withTerms(ITEM_TERMS) },
  { key: "quantity", label: "Quantity", ...withTerms(["miktar", "adet", "aded", "quantity", "qty"]) },
  { key: "unit", label: "Unit", ...withTerms(["olcu birim", "birim", "unit", "olcu"], true) },
  {
    key: "unit_price",
    label: "Unit price",
    ...withTerms([
      "birim fiyat",
      "bir fiyat",
      "br fiyat",
      "b fiyat",
      "unit price",
      "fiyat",
      "price",
    ]),
  },
  { key: "discount", label: "Discount", ...withTerms(["iskonto", "indirim", "discount"]) },
  { key: "vat", label: "VAT", ...withTerms(["kdv", "vat", "tax", "vergi"]) },
  {
    key: "amount",
    label: "Amount",
    ...withTerms([
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
  { key: "date", label: "Date", ...withTerms(["tarih", "date"]) },
]

interface Identified {
  key: string
  label: string
  /** How plainly the heading named this kind of column — lower is believed first. */
  rank: number
}

/**
 * Longest match wins, not first: "Mal Hizmet Tutarı" has to resolve to Amount
 * even though the shorter "mal hizmet" Item pattern also matches it.
 */
function identify(header: string): Identified {
  const normalized = normalizeHeader(header)
  if (!normalized) return { key: "__blank", label: header || "", rank: 0 }

  let best: (Identified & { length: number }) | null = null
  for (const synonym of SYNONYMS) {
    const hit = synonym.match.exec(normalized)
    if (!hit) continue
    if (!best || hit[0].length > best.length) {
      best = {
        key: synonym.key,
        label: synonym.label,
        rank: synonym.rankOf(normalized),
        length: hit[0].length,
      }
    }
  }
  return best
    ? { key: best.key, label: best.label, rank: best.rank }
    : { key: normalized, label: header.trim(), rank: 0 }
}

/**
 * Which column a heading is, arbitrated against every other kind of column.
 *
 * Asking one matcher on its own answers a narrower question than it looks:
 * "Malzeme Kodu" opens with the goods term "malzeme" and is a code column, and
 * only comparing the two matches says so. Anything deciding what a column is
 * has to ask here rather than test a pattern.
 */
export function headerKey(header: string): string {
  return identify(header).key
}

/**
 * Resolve one document's headers, keeping columns distinct. Two headers in the
 * same table can match the same synonym — an invoice carrying both "Ürün Adı"
 * and "Açıklama" is ordinary — and merging them would make one overwrite the
 * other, so only one of them keeps the shared identity.
 *
 * Which one cannot depend on the order they happen to be printed in. It did,
 * and the result was worse than a duplicated column: one supplier heading its
 * table "Açıklama | Ürün Adı" and another heading it "Ürün Adı | Açıklama" put
 * a description and a product name into the same column of the combined sheet.
 * The heading decides now, by how strongly its own term names a product, so
 * every document answers the question the same way.
 */
function resolveHeaders(headers: string[]): Array<{ key: string; label: string }> {
  const resolved = headers.map(identify)

  const winner = new Map<string, number>()
  resolved.forEach((current, i) => {
    const held = winner.get(current.key)
    if (held === undefined || current.rank < resolved[held].rank) winner.set(current.key, i)
  })

  return resolved.map((current, i) => {
    if (winner.get(current.key) === i) return { key: current.key, label: current.label }
    return {
      key: `${current.key}:${normalizeHeader(headers[i])}`,
      label: headers[i].trim() || current.label,
    }
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
