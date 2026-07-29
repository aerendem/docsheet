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
/** Redirect hops followed before a chain is called a loop. */
const MAX_REDIRECTS = 5
/** A sitemap or product page this big is not one; don't buffer it. */
const MAX_TEXT_BYTES = 8 * 1024 * 1024
/** The drug registry workbook is the biggest thing we legitimately download. */
const MAX_BYTES = 64 * 1024 * 1024
/** Per-barcode answers kept in memory before the oldest are dropped. */
const MAX_LOOKUP_CACHE = 20_000

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

async function fetchOnce(url: string, accept: string): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, {
      signal: controller.signal,
      // Redirects are followed by hand below, so each hop can be checked.
      redirect: "manual",
      headers: { "User-Agent": USER_AGENT, Accept: accept },
    })
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new CatalogError(504, `Timed out fetching ${url}`)
    }
    throw new CatalogError(502, `Failed to reach ${url}: ${(err as Error).message}`)
  } finally {
    clearTimeout(timer)
  }
}

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308])

/**
 * Fetch a public https URL, checking every hop of the chain.
 *
 * `fetch` follows redirects silently, which is what turns one allowed URL into
 * a request to whatever it points at: a shop that answers 302 to
 * `http://169.254.169.254/…` would have the server read cloud metadata and hand
 * it back. Following them here means the guard applies to the address actually
 * fetched, every time.
 */
async function request(url: string, accept: string): Promise<Response> {
  let target = assertFetchable(url)
  for (let hop = 0; ; hop++) {
    const resp = await fetchOnce(target, accept)
    if (!REDIRECT_STATUS.has(resp.status)) {
      if (!resp.ok) throw new CatalogError(502, `${target} returned HTTP ${resp.status}`)
      return resp
    }
    if (hop >= MAX_REDIRECTS) throw new CatalogError(502, `Too many redirects from ${url}.`)
    const location = resp.headers.get("location")
    if (!location) throw new CatalogError(502, `${target} redirected without a location.`)
    try {
      target = assertFetchable(new URL(location, target).toString())
    } catch (err) {
      // Say where it tried to go: a shop redirecting off-limits is a fact about
      // that shop, not a mystery failure.
      const why = err instanceof Error ? err.message : "not allowed"
      throw new CatalogError(400, `${target} redirected to ${location} — ${why}`)
    }
  }
}

/**
 * Read a response body, refusing to buffer more than the cap. Content-Length is
 * only a hint, so the limit is enforced against what actually arrives.
 */
async function readCapped(resp: Response, maxBytes: number, url: string): Promise<Uint8Array> {
  const tooBig = () =>
    new CatalogError(413, `${url} is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.`)
  const declared = Number(resp.headers.get("content-length") ?? "")
  if (Number.isFinite(declared) && declared > maxBytes) throw tooBig()

  const reader = resp.body?.getReader()
  if (!reader) return new Uint8Array(0)
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > maxBytes) {
      await reader.cancel().catch(() => {})
      throw tooBig()
    }
    chunks.push(value)
  }

  const out = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.length
  }
  return out
}

export async function getText(url: string): Promise<string> {
  const resp = await request(url, "text/html,application/xhtml+xml,application/xml,*/*")
  // `Response.text()` decodes as UTF-8 whatever the charset header claims, so
  // decoding here changes nothing but the size cap.
  return new TextDecoder("utf-8").decode(await readCapped(resp, MAX_TEXT_BYTES, url))
}

export async function getBytes(url: string): Promise<ArrayBuffer> {
  const resp = await request(url, "*/*")
  const bytes = await readCapped(resp, MAX_BYTES, url)
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
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
 * Guard for everything this server fetches on a user's say-so. Without it the
 * container would happily read things the browser can't — cloud metadata,
 * internal services — because it sits inside the network they're on.
 *
 * @returns the URL unchanged, so it can wrap a fetch without rewriting it.
 */
export function assertFetchable(raw: string): string {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    throw new CatalogError(400, "That doesn't look like a URL.")
  }
  if (url.protocol !== "https:") throw new CatalogError(400, "Only https URLs are fetched.")
  const host = url.hostname
  if (PRIVATE_HOST.test(host) || !host.includes(".")) {
    throw new CatalogError(400, "That host isn't a public website.")
  }
  // A bare IP is never a shop, and is the usual way this gets abused.
  if (/^\[?[\d.:a-f]+\]?$/i.test(host) && !/[a-z]{2}/i.test(host.replace(/^\[|\]$/g, ""))) {
    throw new CatalogError(400, "That host isn't a public website.")
  }
  return url.toString()
}

/**
 * The same guard for the "point it at any shop" source, which additionally
 * reduces the URL to the site root the crawler builds paths from.
 */
export function assertPublicSite(raw: string): string {
  const url = new URL(assertFetchable(raw))
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

  const sameSite = urls.flatMap((u) => {
    try {
      const parsed = new URL(u)
      if (parsed.hostname.replace(/^www\./, "") !== new URL(site).hostname.replace(/^www\./, "")) {
        return []
      }
      // Some sitemaps still list http for a site served over https. It is the
      // host we vouched for, so upgrade rather than drop the product.
      parsed.protocol = "https:"
      return [parsed.toString()]
    } catch {
      return []
    }
  })
  const products = sameSite.filter((u) => PRODUCT_PATH.test(u) && !NOT_PRODUCT.test(u))
  // Shops that don't mark product URLs by path still work, they just cost more
  // requests — the JSON-LD check below is what actually decides.
  return (products.length ? products : sameSite).slice(0, MAX_PRODUCTS)
}

/** Fields a platform may print the barcode in, best first. */
const CODE_FIELDS = ["gtin13", "gtin14", "gtin12", "gtin8", "gtin", "ean", "barcode", "sku"]

/** Wrappers a Product is commonly nested inside instead of sitting at the top. */
const LD_CHILDREN = ["@graph", "graph", "mainEntity", "item", "itemListElement", "hasVariant"]

/**
 * Every object in a JSON-LD block, however it is nested. Yoast (so most
 * WooCommerce shops) publishes one `@graph` holding the whole page, and several
 * themes hang the Product off `mainEntity` — reading only the top level finds a
 * barcode on neither, and the shop reports "no products published a barcode".
 */
function ldNodes(data: unknown, depth = 0, out: Record<string, any>[] = []): Record<string, any>[] {
  if (depth > 5 || out.length > 200 || !data || typeof data !== "object") return out
  if (Array.isArray(data)) {
    for (const item of data) ldNodes(item, depth + 1, out)
    return out
  }
  const node = data as Record<string, any>
  out.push(node)
  for (const key of LD_CHILDREN) {
    if (node[key]) ldNodes(node[key], depth + 1, out)
  }
  return out
}

/**
 * The price a product page publishes, wherever the platform put it.
 *
 * This is the shelf price the shop is selling at, which is the one thing the
 * drug registry can't supply — so it is worth digging for. A page lists several
 * offers (one per variant, or an `AggregateOffer` with a low and a high), and
 * the price sits either on the offer or inside its `priceSpecification`.
 */
function priceOf(offers: unknown, depth = 0): string | undefined {
  if (!offers || typeof offers !== "object" || depth > 3) return undefined
  if (Array.isArray(offers)) {
    for (const offer of offers) {
      const found = priceOf(offer, depth + 1)
      if (found !== undefined) return found
    }
    return undefined
  }
  const node = offers as Record<string, any>
  for (const field of ["price", "lowPrice", "highPrice"]) {
    const value = node[field]
    if (value !== undefined && value !== null && String(value).trim()) return String(value)
  }
  return priceOf(node.priceSpecification ?? node.offers, depth + 1)
}

/**
 * Product pages carry one or more JSON-LD blocks. We want the node that holds a
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
    for (const node of ldNodes(data)) {
      const name = typeof node.name === "string" ? node.name.trim() : ""
      if (!name) continue
      // Take the first field that yields a real code, not the first field that
      // exists: platforms routinely emit `"gtin13": ""` beside a filled `gtin`.
      // A shop that puts its own stock code in `sku` would name every row
      // wrongly, so only a real GTIN length counts.
      let code: string | null = null
      for (const field of CODE_FIELDS) {
        const value = node[field]
        if (value === undefined || value === null) continue
        const digits = normalizeBarcode(String(value))
        if (digits && digits.length >= 8) {
          code = digits
          break
        }
      }
      if (!code) continue

      const price = priceOf(node.offers)
      const brand = typeof node.brand === "string" ? node.brand : node.brand?.name
      return {
        barcode: code,
        name,
        source: sourceId,
        price,
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

/**
 * Remember an answer, dropping the oldest once the cache is full. A server that
 * stays up for weeks would otherwise hold every barcode anyone ever pasted,
 * misses included, with nothing to release them.
 */
function remember(barcode: string, entry: CatalogEntry | null) {
  if (lookupCache.size >= MAX_LOOKUP_CACHE) {
    // Map iterates in insertion order, so the first key is the oldest.
    const oldest = lookupCache.keys().next()
    if (!oldest.done) lookupCache.delete(oldest.value)
  }
  lookupCache.set(barcode, { entry, at: Date.now() })
}

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

  remember(barcode, entry)
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
