// Server-only barcode catalogs.
//
// Two kinds of source sit behind /api/catalog and /api/barcodes:
//
//   • a brand shop — Nature & Nurture publishes every product with its EAN in
//     schema.org JSON-LD, so the whole catalog can be read once and matched
//     offline in the browser afterwards;
//   • the open GTIN databases (Open Food Facts / Open Beauty Facts) — looked up
//     one code at a time, only for the barcodes nothing else could name.
//
// Both are cached in memory: a shop crawl is ~150 requests, and a stack of
// invoices from the same supplier would otherwise repeat it on every upload.

import type { CatalogEntry } from "../lib/barcode"
import { normalizeBarcode } from "../lib/barcode"
import { env } from "./node"

const TTL_MS = Number(env.CATALOG_TTL_MINUTES ?? 720) * 60_000
const FETCH_TIMEOUT_MS = Number(env.CATALOG_TIMEOUT_MS ?? 20_000)
/** Politeness cap — the shop is someone else's server, not an API we pay for. */
const CRAWL_CONCURRENCY = 6
const MAX_PRODUCTS = Number(env.CATALOG_MAX_PRODUCTS ?? 500)
const MAX_LOOKUPS = 200
const LOOKUP_CONCURRENCY = 4

const USER_AGENT = `docsheet/1.0 (${env.APP_PUBLIC_URL ?? "https://github.com/aerendem/docsheet"})`

export interface CatalogSourceInfo {
  id: string
  label: string
  site: string
}

const SHOP_URL = (env.NATURE_NURTURE_URL ?? "https://shop.naturenurture.com.tr").replace(
  /\/+$/,
  "",
)

export const CATALOG_SOURCES: CatalogSourceInfo[] = [
  { id: "naturenurture", label: "Nature & Nurture", site: SHOP_URL },
]

export class CatalogError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.name = "CatalogError"
  }
}

async function getText(url: string): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml,*/*" },
    })
    if (!resp.ok) throw new CatalogError(502, `${url} returned HTTP ${resp.status}`)
    return await resp.text()
  } catch (err) {
    if (err instanceof CatalogError) throw err
    if (err instanceof Error && err.name === "AbortError") {
      throw new CatalogError(504, `Timed out fetching ${url}`)
    }
    throw new CatalogError(502, `Failed to reach ${url}: ${(err as Error).message}`)
  } finally {
    clearTimeout(timer)
  }
}

async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  let cursor = 0
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      await worker(items[index])
    }
  })
  await Promise.all(lanes)
}

// ── Brand shop crawl ──────────────────────────────────────────────────────

/**
 * Product pages carry one or more JSON-LD blocks. We want the Product one — it
 * holds the EAN as `sku`. The shop emits `"type"` rather than `"@type"`, so the
 * block is identified by having both a name and a code, not by its type.
 */
function productFromHtml(html: string, url: string): CatalogEntry | null {
  const blocks = html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )
  for (const block of blocks) {
    let data: unknown
    try {
      data = JSON.parse(block[1])
    } catch {
      continue
    }
    const candidates = Array.isArray(data) ? data : [data]
    for (const raw of candidates) {
      if (!raw || typeof raw !== "object") continue
      const node = raw as Record<string, any>
      const code = normalizeBarcode(String(node.gtin13 ?? node.gtin ?? node.sku ?? ""))
      const name = typeof node.name === "string" ? node.name.trim() : ""
      if (!code || !name) continue
      const price = node.offers?.price
      return {
        barcode: code,
        name,
        source: "naturenurture",
        price: price === undefined || price === null ? undefined : String(price),
      }
    }
  }
  // Ticimax renders the block server-side, so a miss means the page shape
  // changed — worth knowing which page, hence the url in the caller's log.
  void url
  return null
}

interface CachedCatalog {
  entries: CatalogEntry[]
  fetchedAt: number
}

const shopCache = new Map<string, CachedCatalog>()
const inFlight = new Map<string, Promise<CachedCatalog>>()

async function crawlShop(source: CatalogSourceInfo): Promise<CachedCatalog> {
  const sitemap = await getText(`${source.site}/sitemap/`)
  const urls = [...sitemap.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)]
    .map((m) => m[1])
    .filter((u) => /\/urun\//.test(u))
    .slice(0, MAX_PRODUCTS)

  if (!urls.length) {
    throw new CatalogError(502, `No product pages found in ${source.site}/sitemap/`)
  }

  const entries: CatalogEntry[] = []
  await runPool(urls, CRAWL_CONCURRENCY, async (url) => {
    try {
      const entry = productFromHtml(await getText(url), url)
      if (entry) entries.push({ ...entry, source: source.id })
    } catch {
      // One dead product page shouldn't lose the other 143.
    }
  })

  if (!entries.length) {
    throw new CatalogError(502, `No barcodes could be read from ${source.site}`)
  }
  entries.sort((a, b) => a.name.localeCompare(b.name, "tr"))
  return { entries, fetchedAt: Date.now() }
}

/** The shop's catalog, crawled at most once per TTL (and once concurrently). */
export async function shopCatalog(
  sourceId: string,
  refresh = false,
): Promise<CachedCatalog & { source: CatalogSourceInfo }> {
  const source = CATALOG_SOURCES.find((s) => s.id === sourceId)
  if (!source) throw new CatalogError(400, `Unknown catalog source "${sourceId}".`)

  const cached = shopCache.get(source.id)
  if (!refresh && cached && Date.now() - cached.fetchedAt < TTL_MS) {
    return { ...cached, source }
  }

  const pending =
    (!refresh && inFlight.get(source.id)) ||
    crawlShop(source)
      .then((result) => {
        shopCache.set(source.id, result)
        return result
      })
      .finally(() => inFlight.delete(source.id))

  inFlight.set(source.id, pending)
  return { ...(await pending), source }
}

// ── Open GTIN databases ───────────────────────────────────────────────────

const OPEN_FACTS = [
  { id: "openfoodfacts", host: "https://world.openfoodfacts.org" },
  { id: "openbeautyfacts", host: "https://world.openbeautyfacts.org" },
]

/** Misses are cached too — an unknown barcode stays unknown for a while. */
const lookupCache = new Map<string, { entry: CatalogEntry | null; at: number }>()

async function lookupOne(barcode: string): Promise<CatalogEntry | null> {
  const cached = lookupCache.get(barcode)
  if (cached && Date.now() - cached.at < TTL_MS) return cached.entry

  let entry: CatalogEntry | null = null
  for (const db of OPEN_FACTS) {
    try {
      const url = `${db.host}/api/v2/product/${barcode}.json?fields=product_name,brands`
      const text = await getText(url)
      const data = JSON.parse(text) as {
        status?: number
        product?: { product_name?: string; brands?: string }
      }
      const name = data.product?.product_name?.trim()
      if (data.status === 1 && name) {
        const brand = data.product?.brands?.split(",")[0]?.trim()
        entry = {
          barcode,
          // The open databases store the bare product name; the brand is what
          // makes it recognisable on an invoice line.
          name: brand && !name.toLowerCase().startsWith(brand.toLowerCase())
            ? `${brand} ${name}`
            : name,
          source: db.id,
        }
        break
      }
    } catch {
      // 404s arrive as CatalogError; either way, try the next database.
    }
  }

  lookupCache.set(barcode, { entry, at: Date.now() })
  return entry
}

/** Look up barcodes nothing else could name. Unknown codes are simply absent. */
export async function lookupOpenFacts(barcodes: string[]): Promise<CatalogEntry[]> {
  const codes = [...new Set(barcodes.map((b) => normalizeBarcode(b)).filter((b): b is string => !!b))]
  if (!codes.length) return []
  if (codes.length > MAX_LOOKUPS) {
    throw new CatalogError(400, `Too many barcodes (max ${MAX_LOOKUPS} per request).`)
  }

  const found: CatalogEntry[] = []
  await runPool(codes, LOOKUP_CONCURRENCY, async (code) => {
    const entry = await lookupOne(code)
    if (entry) found.push(entry)
  })
  return found
}
