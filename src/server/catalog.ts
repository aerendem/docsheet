// Server-only barcode catalogs.
//
// Three kinds of source sit behind /api/catalog and /api/barcodes:
//
//   • a brand shop — most Turkish shop platforms (Ticimax, T-Soft, IdeaSoft,
//     WooCommerce) publish every product with its EAN in schema.org JSON-LD, so
//     a shop's whole catalog can be read once and then matched offline in the
//     browser. Presets ship for a few brands; any other shop can be pointed at
//     by URL;
//   • a registry — the TİTCK drug list, far too big to hand to the browser, so
//     it is indexed here and queried per barcode (see registry.ts);
//   • the open GTIN databases (Open Food Facts / Open Beauty Facts) — also per
//     barcode, for whatever the first two couldn't name.
//
// Everything is cached in memory: a shop crawl is hundreds of requests, and a
// stack of invoices from one supplier would otherwise repeat it every upload.

import type { CatalogEntry } from "../lib/barcode"
import { normalizeBarcode } from "../lib/barcode"
import { env } from "./node"

const TTL_MS = Number(env.CATALOG_TTL_MINUTES ?? 720) * 60_000
const FETCH_TIMEOUT_MS = Number(env.CATALOG_TIMEOUT_MS ?? 20_000)
/** Politeness cap — a shop is someone else's server, not an API we pay for. */
const CRAWL_CONCURRENCY = 6
const MAX_PRODUCTS = Number(env.CATALOG_MAX_PRODUCTS ?? 500)
/** Child sitemaps to expand before giving up on finding product pages. */
const MAX_CHILD_SITEMAPS = 3
const MAX_LOOKUPS = 200
const LOOKUP_CONCURRENCY = 4

export const USER_AGENT = `docsheet/1.0 (${env.APP_PUBLIC_URL ?? "https://github.com/aerendem/docsheet"})`

export interface CatalogSourceInfo {
  id: string
  label: string
  site: string
  /** "shop" catalogs download in full; "registry"/"open" answer per barcode. */
  kind: "shop" | "registry" | "open"
  /** What the source covers, for the UI. */
  sector?: string
}

const preset = (id: string, label: string, fallback: string, sector: string): CatalogSourceInfo => ({
  id,
  label,
  // Any preset shop can be re-pointed without a code change: NATURE_NURTURE_URL,
  // PROCSIN_URL, …
  site: (env[`${id.toUpperCase()}_URL`] ?? fallback).replace(/\/+$/, ""),
  kind: "shop",
  sector,
})

/**
 * Shops whose product pages were checked to publish a real EAN — not an
 * internal stock code, which would match nothing and mislabel everything.
 */
export const SHOP_SOURCES: CatalogSourceInfo[] = [
  preset("naturenurture", "Nature & Nurture", "https://shop.naturenurture.com.tr", "beauty"),
  preset("procsin", "Procsin", "https://www.procsin.com", "beauty"),
]

export const CUSTOM_SOURCE_ID = "custom"

export class CatalogError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.name = "CatalogError"
  }
}

// ── Fetch helpers ─────────────────────────────────────────────────────────

async function request(url: string, accept: string): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT, Accept: accept },
    })
    if (!resp.ok) throw new CatalogError(502, `${url} returned HTTP ${resp.status}`)
    return resp
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

export async function getText(url: string): Promise<string> {
  return (await request(url, "text/html,application/xhtml+xml,application/xml,*/*")).text()
}

export async function getBytes(url: string): Promise<ArrayBuffer> {
  return (await request(url, "*/*")).arrayBuffer()
}

export async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  let cursor = 0
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      await worker(items[index])
    }
  })
  await Promise.all(lanes)
}

// ── Custom shops: only ever fetch a public https site ──────────────────────

const PRIVATE_HOST =
  /^(localhost|.*\.local|.*\.internal|\[?::1\]?|0\.0\.0\.0|10\.\d+\.\d+\.\d+|127\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/i

/**
 * Guard for the "point it at any shop" source. The server would otherwise
 * happily fetch a URL a user supplies, which is a request forgery hole: the
 * container can reach things the browser can't (cloud metadata, internal
 * services). Only public https hosts get through, and a redirect can't escape
 * either — each fetched URL is checked, not just the first.
 */
export function assertPublicSite(raw: string): string {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    throw new CatalogError(400, "That doesn't look like a URL.")
  }
  if (url.protocol !== "https:") throw new CatalogError(400, "Only https shop URLs are supported.")
  const host = url.hostname
  if (PRIVATE_HOST.test(host) || !host.includes(".")) {
    throw new CatalogError(400, "That host isn't a public website.")
  }
  // A bare IP is never a shop, and is the usual way this gets abused.
  if (/^\[?[\d.:a-f]+\]?$/i.test(host) && !/[a-z]{2}/i.test(host.replace(/^\[|\]$/g, ""))) {
    throw new CatalogError(400, "That host isn't a public website.")
  }
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}`
}

// ── Discovering a shop's product pages ────────────────────────────────────

const locsOf = (xml: string): string[] =>
  [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) =>
    m[1].replace(/&amp;/g, "&").trim(),
  )

const PRODUCT_PATH = /\/(urun|product|products|pd)\//i
const NOT_PRODUCT = /(categor|kategori|marka|brand|blog|page|sayfa|haber|collection)/i

async function findSitemap(site: string): Promise<string> {
  const candidates: string[] = []
  try {
    const robots = await getText(`${site}/robots.txt`)
    for (const m of robots.matchAll(/^\s*sitemap:\s*(\S+)/gim)) candidates.push(m[1])
  } catch {
    // robots.txt is optional — fall through to the conventional locations.
  }
  candidates.push(`${site}/sitemap.xml`, `${site}/sitemap/`, `${site}/sitemap_index.xml`)

  for (const candidate of candidates) {
    try {
      const xml = await getText(candidate)
      if (/<(urlset|sitemapindex)/i.test(xml)) return xml
    } catch {
      // try the next one
    }
  }
  throw new CatalogError(422, `No sitemap found at ${site} — can't read its products.`)
}

/**
 * Product page URLs for a shop. A sitemap index is expanded one level, biased
 * towards the child that names products, because that's where the platforms
 * put them (`/xml/sitemap/product.xml`, `sitemap_products_1.xml`, …).
 */
export async function discoverProductUrls(site: string): Promise<string[]> {
  const root = await findSitemap(site)
  let urls = locsOf(root)

  if (/<sitemapindex/i.test(root)) {
    const productChildren = urls.filter((u) => /(product|urun)/i.test(u) && !NOT_PRODUCT.test(u))
    const chosen = (productChildren.length ? productChildren : urls).slice(0, MAX_CHILD_SITEMAPS)
    const expanded: string[] = []
    for (const child of chosen) {
      try {
        expanded.push(...locsOf(await getText(child)))
      } catch {
        // one unreadable child sitemap shouldn't lose the others
      }
    }
    urls = expanded
  }

  const sameSite = urls.filter((u) => {
    try {
      return new URL(u).hostname.replace(/^www\./, "") === new URL(site).hostname.replace(/^www\./, "")
    } catch {
      return false
    }
  })
  const products = sameSite.filter((u) => PRODUCT_PATH.test(u) && !NOT_PRODUCT.test(u))
  // Shops that don't mark product URLs by path still work, they just cost more
  // requests — the JSON-LD check below is what actually decides.
  return (products.length ? products : sameSite).slice(0, MAX_PRODUCTS)
}

/**
 * Product pages carry one or more JSON-LD blocks. We want the one that holds a
 * code and a name — identified by those fields rather than by @type, because
 * some platforms emit `"type"` instead of `"@type"`.
 */
export function productFromHtml(html: string, sourceId: string): CatalogEntry | null {
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
      const code = normalizeBarcode(String(node.gtin13 ?? node.gtin14 ?? node.gtin ?? node.sku ?? ""))
      const name = typeof node.name === "string" ? node.name.trim() : ""
      // A shop that puts its own stock code in `sku` would name every row
      // wrongly, so only a real GTIN length counts.
      if (!code || code.length < 8 || !name) continue
      const offers = Array.isArray(node.offers) ? node.offers[0] : node.offers
      const brand = typeof node.brand === "string" ? node.brand : node.brand?.name
      return {
        barcode: code,
        name,
        source: sourceId,
        price: offers?.price === undefined || offers?.price === null ? undefined : String(offers.price),
        brand: typeof brand === "string" && brand.trim() ? brand.trim() : undefined,
      }
    }
  }
  return null
}

interface CachedCatalog {
  entries: CatalogEntry[]
  fetchedAt: number
}

const shopCache = new Map<string, CachedCatalog>()
const inFlight = new Map<string, Promise<CachedCatalog>>()

async function crawlShop(source: CatalogSourceInfo): Promise<CachedCatalog> {
  const urls = await discoverProductUrls(source.site)
  if (!urls.length) {
    throw new CatalogError(422, `No product pages found in the sitemap of ${source.site}.`)
  }

  const entries: CatalogEntry[] = []
  await runPool(urls, CRAWL_CONCURRENCY, async (url) => {
    try {
      const entry = productFromHtml(await getText(url), source.id)
      if (entry) entries.push(entry)
    } catch {
      // One dead product page shouldn't lose the other hundred.
    }
  })

  if (!entries.length) {
    throw new CatalogError(
      422,
      `Read ${urls.length} pages from ${source.site} but none published a barcode.`,
    )
  }
  entries.sort((a, b) => a.name.localeCompare(b.name, "tr"))
  return { entries, fetchedAt: Date.now() }
}

/** A shop's catalog, crawled at most once per TTL (and once concurrently). */
export async function shopCatalog(
  source: CatalogSourceInfo,
  refresh = false,
): Promise<CachedCatalog> {
  const key = source.site
  const cached = shopCache.get(key)
  if (!refresh && cached && Date.now() - cached.fetchedAt < TTL_MS) return cached

  const pending =
    (!refresh && inFlight.get(key)) ||
    crawlShop(source)
      .then((result) => {
        shopCache.set(key, result)
        return result
      })
      .finally(() => inFlight.delete(key))

  inFlight.set(key, pending)
  return pending
}

/** Resolve a source id (or a pasted shop URL) to something crawlable. */
export function resolveShop(idOrUrl: string): CatalogSourceInfo {
  const preset = SHOP_SOURCES.find((s) => s.id === idOrUrl)
  if (preset) return preset
  if (!/^https?:/i.test(idOrUrl)) throw new CatalogError(400, `Unknown catalog source "${idOrUrl}".`)
  const site = assertPublicSite(idOrUrl)
  return {
    id: CUSTOM_SOURCE_ID,
    label: new URL(site).hostname.replace(/^www\./, ""),
    site,
    kind: "shop",
  }
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
      const data = JSON.parse(await getText(url)) as {
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
          name:
            brand && !name.toLowerCase().startsWith(brand.toLowerCase())
              ? `${brand} ${name}`
              : name,
          source: db.id,
          brand: brand || undefined,
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
  if (!barcodes.length) return []
  const found: CatalogEntry[] = []
  await runPool(barcodes, LOOKUP_CONCURRENCY, async (code) => {
    const entry = await lookupOne(code)
    if (entry) found.push(entry)
  })
  return found
}

export function normalizeLookupInput(barcodes: string[]): string[] {
  const codes = [
    ...new Set(barcodes.map((b) => normalizeBarcode(b)).filter((b): b is string => !!b)),
  ]
  if (codes.length > MAX_LOOKUPS) {
    throw new CatalogError(400, `Too many barcodes (max ${MAX_LOOKUPS} per request).`)
  }
  return codes
}
