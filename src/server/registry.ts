// The Turkish drug registry as a barcode source.
//
// TİTCK (Türkiye İlaç ve Tıbbi Cihaz Kurumu) republishes the SKRS e-reçete list
// every week as an .xlsx: every licensed medicine and pharmaceutical product in
// Turkey with its barcode, name, marketing-authorisation holder and ATC code —
// around 18,000 rows across the active and passive sheets.
//
// That is far too much to hand to the browser, so unlike a brand shop this one
// is indexed here and answers per barcode. One download covers every pharmacy
// invoice the app will ever see.

import type { CatalogEntry } from "../lib/barcode"
import { normalizeBarcode } from "../lib/barcode"
import { normalizeHeader } from "../lib/combine"
import { CatalogError, type CatalogSourceInfo, getBytes, getText } from "./catalog"
import { env } from "./node"

const TTL_MS = Number(env.REGISTRY_TTL_MINUTES ?? 1440) * 60_000
const LIST_PAGE = (
  env.TITCK_LIST_URL ?? "https://www.titck.gov.tr/dinamikmodul/43"
).replace(/\/+$/, "")

export const REGISTRY_SOURCE: CatalogSourceInfo = {
  id: "titck",
  label: "TİTCK",
  site: LIST_PAGE,
  kind: "registry",
  sector: "pharmacy",
}

// Headings are matched through the same normaliser the combined sheet uses.
// A plain /i regex is not enough here: "İlaç Adı" starts with a dotted capital
// İ, which case-insensitive matching does not fold to "i".
const HEADER = {
  barcode: /^barkod$/,
  name: /^(ilac adi|urun adi)$/,
  firm: /^firma adi$/,
  atc: /^atc (kodu|adi)$/,
}

interface CachedRegistry {
  index: Map<string, CatalogEntry>
  fetchedAt: number
  /** The published file this index was built from, for the UI. */
  file: string
}

let cache: CachedRegistry | null = null
let inFlight: Promise<CachedRegistry> | null = null

/**
 * The newest published workbook. The page lists every weekly edition newest
 * first, so the first .xlsx link on it is the current one.
 */
async function newestWorkbookUrl(): Promise<string> {
  const html = await getText(LIST_PAGE)
  const links = [...html.matchAll(/href="([^"]+\.xlsx)"/gi)].map((m) => m[1])
  const url = links.find((u) => /titck\.gov\.tr/i.test(u)) ?? links[0]
  if (!url) throw new CatalogError(502, `No published drug list found on ${LIST_PAGE}.`)
  return url.replace(/&amp;/g, "&")
}

const cellText = (value: unknown): string => {
  if (value === null || value === undefined) return ""
  if (typeof value === "object") {
    const rich = value as { text?: unknown; result?: unknown; richText?: Array<{ text?: string }> }
    if (Array.isArray(rich.richText)) return rich.richText.map((r) => r.text ?? "").join("")
    if (typeof rich.text === "string") return rich.text
    if (rich.result !== undefined) return String(rich.result)
    return ""
  }
  return String(value)
}

/**
 * Read one worksheet into the index. The header isn't on row 1 — the sheets
 * open with two title rows — so it is found by looking for the row that names
 * the columns, and everything below it is data.
 */
function readSheet(sheet: any, index: Map<string, CatalogEntry>): number {
  let headerRow = -1
  const at = { barcode: -1, name: -1, firm: -1, atc: -1 }

  const rowCount: number = sheet.rowCount ?? 0
  for (let r = 1; r <= Math.min(rowCount, 12); r++) {
    const values: unknown[] = sheet.getRow(r).values ?? []
    values.forEach((value, i) => {
      const text = normalizeHeader(cellText(value))
      if (!text) return
      if (at.barcode === -1 && HEADER.barcode.test(text)) at.barcode = i
      if (at.name === -1 && HEADER.name.test(text)) at.name = i
      if (at.firm === -1 && HEADER.firm.test(text)) at.firm = i
      if (at.atc === -1 && HEADER.atc.test(text)) at.atc = i
    })
    if (at.barcode !== -1 && at.name !== -1) {
      headerRow = r
      break
    }
  }
  if (headerRow === -1) return 0

  let added = 0
  for (let r = headerRow + 1; r <= rowCount; r++) {
    const values: unknown[] = sheet.getRow(r).values ?? []
    const barcode = normalizeBarcode(cellText(values[at.barcode]))
    const name = cellText(values[at.name]).replace(/\s+/g, " ").trim()
    if (!barcode || !name) continue
    // The active sheet is read first; a product that also appears as passive
    // keeps the active entry.
    if (index.has(barcode)) continue
    index.set(barcode, {
      barcode,
      name,
      source: REGISTRY_SOURCE.id,
      brand: at.firm === -1 ? undefined : cellText(values[at.firm]).trim() || undefined,
      note: at.atc === -1 ? undefined : cellText(values[at.atc]).trim() || undefined,
    })
    added++
  }
  return added
}

async function buildIndex(): Promise<CachedRegistry> {
  const file = await newestWorkbookUrl()
  const bytes = await getBytes(file)
  // exceljs is already a dependency for the .xlsx export. Imported here rather
  // than at module scope so a registry that is never switched on costs nothing.
  const { Workbook } = await import("exceljs")
  const workbook = new Workbook()
  await workbook.xlsx.load(bytes as any)

  const index = new Map<string, CatalogEntry>()
  // Active products first so they win; passive ones still name an old invoice.
  const sheets = [...workbook.worksheets].sort((a, b) =>
    /pasif/i.test(a.name) === /pasif/i.test(b.name) ? 0 : /pasif/i.test(a.name) ? 1 : -1,
  )
  for (const sheet of sheets) readSheet(sheet, index)

  if (!index.size) {
    throw new CatalogError(502, `The published drug list at ${file} had no readable rows.`)
  }
  return { index, fetchedAt: Date.now(), file }
}

/** The index, built at most once per TTL (and once concurrently). */
export async function registryIndex(refresh = false): Promise<CachedRegistry> {
  if (!refresh && cache && Date.now() - cache.fetchedAt < TTL_MS) return cache

  const pending =
    (!refresh && inFlight) ||
    buildIndex()
      .then((result) => {
        cache = result
        return result
      })
      .finally(() => {
        inFlight = null
      })

  inFlight = pending
  return pending
}

/** Names for the barcodes the registry knows; unknown codes are simply absent. */
export async function lookupRegistry(barcodes: string[]): Promise<CatalogEntry[]> {
  if (!barcodes.length) return []
  const { index } = await registryIndex()
  const found: CatalogEntry[] = []
  for (const code of barcodes) {
    const entry = index.get(code)
    if (entry) found.push(entry)
  }
  return found
}

/** Row count and publication file, for the UI to show what it is querying. */
export async function registryStatus(): Promise<{ count: number; file: string; fetchedAt: string }> {
  const { index, file, fetchedAt } = await registryIndex()
  return { count: index.size, file, fetchedAt: new Date(fetchedAt).toISOString() }
}
