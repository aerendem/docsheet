// The barcode → name matcher.
//
// State lives here (and in localStorage) rather than in the page: the catalog
// outlives any single upload, so a supplier's list only has to be set up once.
// The page uses `catalog` + `options` to fill columns into whatever sheets it
// is about to show or download.
//
// Sources come in two shapes. A brand shop is small enough to download whole
// and match in the browser; a registry (the TİTCK drug list) and the open GTIN
// databases are far too big for that, so they answer per barcode and only for
// the codes nothing else could name.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  buildCatalog,
  type Catalog,
  type CatalogEntry,
  EXTRA_FIELDS,
  type ExtraField,
  type FillMode,
  type FillOptions,
  parseCatalogList,
} from "../lib/barcode"
import type { StringKey } from "../lib/i18n"
import {
  IconAlert,
  IconBarcode,
  IconCheck,
  IconDownload,
  IconRefresh,
  IconSearch,
} from "./icons"
import { useLang } from "./lang"

const STORAGE_KEY = "docsheet.matcher.v2"
/**
 * Shops that are on by default. The server is the authority on which presets
 * exist (GET /api/catalog); this list only decides what a first-time visitor
 * starts with, so an id that no longer ships is simply never loaded.
 */
const PRESET_SHOP_IDS = ["naturenurture", "procsin"]
const REGISTRY_ID = "titck"
const OPEN_ID = "openfacts"
/** Enough to paste a supplier's whole price list, not enough to wedge storage. */
const MAX_LIST_CHARS = 500_000
const UNMATCHED_SHOWN = 24
/** Matches the server's per-request cap on per-barcode lookups. */
const AUTO_BATCH = 200

export interface SourceInfo {
  id: string
  label: string
  site: string
  kind: "shop" | "registry" | "open"
  sector?: string
}

interface Persisted {
  enabled: boolean
  mode: FillMode
  label: string
  ownText: string
  useOwn: boolean
  /** Preset shop ids and pasted shop URLs, both crawled the same way. */
  shops: string[]
  useRegistry: boolean
  /** Look codes up in the open databases without being asked each time. */
  autoOpen: boolean
  extras: ExtraField[]
}

// Every source is on out of the box: the common case is wanting names, not
// picking suppliers. Switching one off is the deliberate act, and it sticks.
// Nothing is actually fetched until a sheet with barcodes turns up — see the
// effects at the bottom of the panel.
const DEFAULTS: Persisted = {
  enabled: true,
  mode: "new",
  label: "",
  ownText: "",
  useOwn: true,
  shops: PRESET_SHOP_IDS,
  useRegistry: true,
  autoOpen: true,
  extras: [],
}

export interface MatcherApi {
  state: Persisted
  set: (patch: Partial<Persisted>) => void
  catalog: Catalog
  options: FillOptions
  sources: SourceInfo[]
  ownCount: number
  ownSkipped: number
  /** Loaded shop catalogs, keyed by preset id or pasted URL. */
  shopEntries: Record<string, CatalogEntry[]>
  loadingShops: string[]
  registryCount: number | null
  lookupCount: number
  lookingUp: boolean
  error: string | null
  loadShop: (idOrUrl: string, refresh?: boolean) => Promise<void>
  loadRegistry: () => Promise<void>
  dropShop: (key: string) => void
  lookUp: (barcodes: string[]) => Promise<void>
  importFile: (file: File) => Promise<void>
  reset: () => void
}

function load(): Persisted {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === "object" ? { ...DEFAULTS, ...parsed } : DEFAULTS
  } catch {
    return DEFAULTS
  }
}

const isUrl = (s: string) => /^https?:/i.test(s)

export function useBarcodeMatcher(): MatcherApi {
  const { t } = useLang()
  const [state, setState] = useState<Persisted>(DEFAULTS)
  const [hydrated, setHydrated] = useState(false)
  const [sources, setSources] = useState<SourceInfo[]>([])
  const [shopEntries, setShopEntries] = useState<Record<string, CatalogEntry[]>>({})
  const [loadingShops, setLoadingShops] = useState<string[]>([])
  const [registryCount, setRegistryCount] = useState<number | null>(null)
  const [lookupEntries, setLookupEntries] = useState<CatalogEntry[]>([])
  const [lookingUp, setLookingUp] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // localStorage is browser-only; reading it during render would break SSR.
  useEffect(() => {
    setState(load())
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (!hydrated) return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      /* private mode — the session still works, it just won't be remembered */
    }
  }, [state, hydrated])

  // Which sources this build ships is the server's business, not the bundle's.
  useEffect(() => {
    fetch("/api/catalog")
      .then((r) => r.json())
      .then((d) => setSources((d.sources ?? []) as SourceInfo[]))
      .catch(() => setSources([]))
  }, [])

  const set = useCallback((patch: Partial<Persisted>) => {
    setState((prev) => ({ ...prev, ...patch }))
  }, [])

  const own = useMemo(() => parseCatalogList(state.ownText, "own"), [state.ownText])

  // Priority runs left to right: a name you pasted yourself beats a shop, which
  // beats whatever a registry or public database answered. A source that is
  // switched off contributes nothing, but its entries stay in memory so
  // switching it back on doesn't mean fetching them again.
  const catalog = useMemo(() => {
    const shops = state.shops.map((key) => shopEntries[key] ?? [])
    // Answers already fetched are kept in memory, but a source that has been
    // switched off stops contributing them — otherwise unticking it leaves its
    // names on screen until a reload.
    const lookups = lookupEntries.filter((entry) =>
      entry.source === REGISTRY_ID ? state.useRegistry : state.autoOpen,
    )
    return buildCatalog([lookups, ...shops, state.useOwn ? own.entries : []])
  }, [
    lookupEntries,
    shopEntries,
    state.shops,
    state.useOwn,
    state.useRegistry,
    state.autoOpen,
    own.entries,
  ])

  const options: FillOptions = useMemo(
    () => ({
      label: state.label.trim() || t("matcher_default_label"),
      mode: state.mode,
      extras: state.extras.map((field) => ({
        field,
        label: t(`matcher_extra_${field}` as StringKey),
      })),
    }),
    [state.label, state.mode, state.extras, t],
  )

  const loadShop = useCallback(async (idOrUrl: string, refresh = false) => {
    setLoadingShops((prev) => (prev.includes(idOrUrl) ? prev : [...prev, idOrUrl]))
    setError(null)
    try {
      // A pasted URL is POSTed rather than put in the query string: the server
      // has to validate it before fetching anything either way.
      const res = isUrl(idOrUrl)
        ? await fetch("/api/catalog", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: idOrUrl }),
          })
        : await fetch(`/api/catalog?source=${idOrUrl}${refresh ? "&refresh=1" : ""}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`)
      setShopEntries((prev) => ({ ...prev, [idOrUrl]: (data.entries ?? []) as CatalogEntry[] }))
    } catch (e) {
      setError((e as Error).message)
      throw e
    } finally {
      setLoadingShops((prev) => prev.filter((k) => k !== idOrUrl))
    }
  }, [])

  const lookUp = useCallback(
    async (barcodes: string[]) => {
      const wanted = [
        ...(state.useRegistry ? [REGISTRY_ID] : []),
        ...(state.autoOpen ? [OPEN_ID] : []),
      ]
      if (!barcodes.length || !wanted.length) return
      setLookingUp(true)
      setError(null)
      try {
        const res = await fetch("/api/barcodes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ barcodes, sources: wanted }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`)
        const found = (data.entries ?? []) as CatalogEntry[]
        // Keep earlier answers: a second pass over a longer invoice shouldn't
        // drop the names the first one found.
        setLookupEntries((prev) => {
          const merged = new Map(prev.map((e) => [e.barcode, e]))
          for (const entry of found) merged.set(entry.barcode, entry)
          return [...merged.values()]
        })
      } catch (e) {
        setError((e as Error).message)
      } finally {
        setLookingUp(false)
      }
    },
    [state.useRegistry, state.autoOpen],
  )

  const importFile = useCallback(async (file: File) => {
    setError(null)
    const text = await file.text()
    setState((prev) => {
      const joined = prev.ownText.trim() ? `${prev.ownText.trim()}\n${text}` : text
      return { ...prev, ownText: joined.slice(0, MAX_LIST_CHARS) }
    })
  }, [])

  // The registry index lives on the server; all the browser needs is proof it
  // is there and how much it covers. A failure switches the source off rather
  // than leaving a checkbox ticked with nothing behind it.
  // A ref, not just `registryCount`: two effect runs in the same commit would
  // both pass a state-based guard and ask the server twice.
  const registryLoading = useRef(false)
  const loadRegistry = useCallback(async () => {
    if (registryCount !== null || registryLoading.current) return
    registryLoading.current = true
    try {
      const res = await fetch(`/api/catalog?source=${REGISTRY_ID}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`)
      setRegistryCount(data.count as number)
    } catch (e) {
      setError((e as Error).message)
      setState((prev) => ({ ...prev, useRegistry: false }))
    } finally {
      registryLoading.current = false
    }
  }, [registryCount])

  const dropShop = useCallback((key: string) => {
    setState((prev) => ({ ...prev, shops: prev.shops.filter((s) => s !== key) }))
  }, [])

  const reset = useCallback(() => {
    setLookupEntries([])
    set({ ownText: "" })
  }, [set])

  return {
    state,
    set,
    catalog,
    options,
    sources,
    ownCount: own.entries.length,
    ownSkipped: own.skipped,
    shopEntries,
    loadingShops,
    registryCount,
    lookupCount: lookupEntries.length,
    lookingUp,
    error,
    loadShop,
    loadRegistry,
    dropShop,
    lookUp,
    importFile,
    reset,
  }
}

export interface MatchStats {
  /** Rows in the visible sheets that carry a barcode. */
  rows: number
  matched: number
  unmatched: string[]
  hasBarcodeColumn: boolean
  /** Barcode cells whose misread letters were read back as digits. */
  repaired: number
}

// ── Panel ─────────────────────────────────────────────────────────────────

function SourceCard({
  title,
  blurb,
  chip,
  checked,
  toggleLabel,
  onToggle,
  footer,
}: {
  title: React.ReactNode
  blurb: string
  chip?: string
  checked: boolean
  toggleLabel: string
  onToggle: (on: boolean) => void
  footer?: React.ReactNode
}) {
  return (
    <div className="demo-card flex flex-col">
      <div className="flex items-start justify-between gap-2">
        <p className="font-extrabold">{title}</p>
        <input
          type="checkbox"
          className="mt-1 flex-shrink-0"
          checked={checked}
          aria-label={toggleLabel}
          onChange={(e) => onToggle(e.target.checked)}
        />
      </div>
      {chip && <p className="island-kicker mt-1">{chip}</p>}
      <p className="demo-muted mt-1 text-sm leading-snug">{blurb}</p>
      <div className="mt-auto pt-3 text-xs" style={{ color: "var(--ink-faint)" }}>
        {footer}
      </div>
    </div>
  )
}

export default function BarcodeMatcher({
  matcher,
  stats,
}: {
  matcher: MatcherApi
  stats: MatchStats
}) {
  const { t } = useLang()
  const [open, setOpen] = useState(false)
  const [newShop, setNewShop] = useState("")
  const { state, set } = matcher

  const presets = matcher.sources.filter((s) => s.kind === "shop")
  const customShops = state.shops.filter((s) => isUrl(s))
  const shopCount = state.shops.reduce((n, key) => n + (matcher.shopEntries[key]?.length ?? 0), 0)
  const total = (state.useOwn ? matcher.ownCount : 0) + shopCount + matcher.lookupCount

  const allOn =
    state.useOwn &&
    state.useRegistry &&
    state.autoOpen &&
    presets.every((p) => state.shops.includes(p.id))

  const setAll = (on: boolean) =>
    set({
      useOwn: on,
      useRegistry: on,
      autoOpen: on,
      // Pasted shops are kept either way: they were added deliberately.
      shops: on ? [...new Set([...state.shops, ...presets.map((p) => p.id)])] : customShops,
    })

  const toggleShop = (id: string, on: boolean) =>
    set({ shops: on ? [...state.shops, id] : state.shops.filter((s) => s !== id) })

  const addShop = () => {
    const url = newShop.trim()
    if (!url) return
    const normalized = /^https?:/i.test(url) ? url : `https://${url}`
    if (!state.shops.includes(normalized)) set({ shops: [...state.shops, normalized] })
    setNewShop("")
  }

  // Nothing is fetched until there is something to match. Every source being on
  // by default would otherwise mean two shop crawls and an 18,000-row workbook
  // for someone who only wanted to convert a PDF.
  const needed = state.enabled && stats.hasBarcodeColumn
  const attempted = useRef(new Set<string>())
  useEffect(() => {
    if (!needed) return
    for (const key of attempted.current) {
      if (!state.shops.includes(key)) attempted.current.delete(key)
    }
    for (const key of state.shops) {
      // `attempted` keeps a failure from retrying on every render; switching
      // the source off and on again is what asks for another go.
      if (attempted.current.has(key) || matcher.shopEntries[key]) continue
      attempted.current.add(key)
      matcher.loadShop(key).catch(() => matcher.dropShop(key))
    }
    if (state.useRegistry) matcher.loadRegistry()
  }, [needed, state.shops, state.useRegistry, matcher.shopEntries, matcher.loadShop, matcher.loadRegistry, matcher.dropShop])

  // Every code already sent to a per-barcode source. Without it an unknown
  // barcode comes back unnamed, stays unmatched, and asks to be looked up
  // again — forever.
  const tried = useRef(new Set<string>())
  const perCodeOn = state.useRegistry || state.autoOpen
  // Wait for the shop catalogs before asking a registry about codes a shop is
  // about to name. A failed crawl drops the shop, so this can't wait forever.
  const shopsPending = state.shops.some((key) => !matcher.shopEntries[key])
  useEffect(() => {
    if (!needed || !perCodeOn || matcher.lookingUp || shopsPending) return
    const fresh = stats.unmatched.filter((code) => !tried.current.has(code))
    if (!fresh.length) return
    const batch = fresh.slice(0, AUTO_BATCH)
    for (const code of batch) tried.current.add(code)
    matcher.lookUp(batch)
  }, [needed, perCodeOn, stats.unmatched, matcher.lookingUp, matcher.lookUp, shopsPending])

  return (
    <section className="demo-panel rise-in mt-6">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg"
          style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
        >
          <IconBarcode size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="demo-section-title">{t("matcher_title")}</p>
          <p className="demo-muted text-sm">{t("matcher_subtitle")}</p>
        </div>
        <label className="flex flex-shrink-0 items-center gap-2 text-sm font-semibold">
          <input
            type="checkbox"
            checked={state.enabled}
            onChange={(e) => set({ enabled: e.target.checked })}
          />
          {t("matcher_enable")}
        </label>
      </div>

      {/* status */}
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        {!state.enabled ? (
          <span className="demo-muted">{t("matcher_off")}</span>
        ) : !stats.hasBarcodeColumn ? (
          <span className="demo-muted">{t("matcher_no_column")}</span>
        ) : (
          <>
            <span className="font-semibold">
              {stats.matched > 0 && (
                <IconCheck
                  size={14}
                  className="mr-1 inline-block align-[-2px]"
                  style={{ color: "var(--accent)" }}
                />
              )}
              {t("matcher_matched", { matched: stats.matched, rows: stats.rows })}
            </span>
            {stats.unmatched.length > 0 && (
              <button
                type="button"
                className="demo-pill"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
              >
                <IconAlert size={13} />
                {t("matcher_unmatched", { n: stats.unmatched.length })}
              </button>
            )}
            {matcher.lookingUp && (
              <span className="demo-muted text-xs">{t("matcher_looking_up")}</span>
            )}
          </>
        )}
        {/* A correction to what was read, not a match — worth saying out loud
            even with the matcher switched off, since it changed the document. */}
        {stats.repaired > 0 && (
          <span className="demo-muted text-xs">
            {t(stats.repaired === 1 ? "matcher_repaired_one" : "matcher_repaired_many", {
              n: stats.repaired,
            })}
          </span>
        )}
        <span className="demo-muted ml-auto text-xs">
          {t(total === 1 ? "matcher_catalog_size_one" : "matcher_catalog_size_many", { n: total })}
        </span>
      </div>

      {open && stats.unmatched.length > 0 && (
        <div className="demo-card mt-3">
          <p className="demo-muted mb-2 text-xs">{t("matcher_unmatched_hint")}</p>
          <p className="m-0 font-mono text-xs leading-relaxed break-all">
            {stats.unmatched.slice(0, UNMATCHED_SHOWN).join("  ")}
            {stats.unmatched.length > UNMATCHED_SHOWN
              ? ` … +${stats.unmatched.length - UNMATCHED_SHOWN}`
              : ""}
          </p>
        </div>
      )}

      {/* sources */}
      <div className="mt-5 mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="demo-section-title">{t("matcher_sources")}</p>
        {/* One switch for all of them. They stay individually switchable
            because a name from a crowd-sourced database is not the same claim
            as one from your own list — but "use everything" is the common case. */}
        <label className="flex items-center gap-2 text-xs font-semibold">
          <input
            type="checkbox"
            checked={allOn}
            aria-label={t("matcher_all")}
            onChange={(e) => setAll(e.target.checked)}
          />
          {t("matcher_all")}
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <SourceCard
          title={t("matcher_own")}
          blurb={t("matcher_own_blurb")}
          checked={state.useOwn}
          toggleLabel={t("matcher_own_toggle")}
          onToggle={(on) => set({ useOwn: on })}
          footer={
            <>
              {t(matcher.ownCount === 1 ? "matcher_own_count_one" : "matcher_own_count_many", {
                n: matcher.ownCount,
              })}
              {matcher.ownSkipped > 0
                ? ` · ${t(
                    matcher.ownSkipped === 1
                      ? "matcher_own_skipped_one"
                      : "matcher_own_skipped_many",
                    { n: matcher.ownSkipped },
                  )}`
                : ""}
            </>
          }
        />

        <SourceCard
          title="TİTCK"
          chip={t("matcher_sector_pharmacy")}
          blurb={t("matcher_registry_blurb")}
          checked={state.useRegistry}
          toggleLabel={t("matcher_registry_toggle")}
          onToggle={(on) => set({ useRegistry: on })}
          footer={
            <div className="flex items-center gap-2">
              <a
                href="https://www.titck.gov.tr/dinamikmodul/43"
                target="_blank"
                rel="noreferrer"
                className="font-semibold"
                style={{ color: "var(--ink-faint)" }}
              >
                titck.gov.tr
              </a>
              {state.useRegistry && (
                <span className="ml-auto">
                  {matcher.registryCount === null
                    ? t("matcher_loading")
                    : t("matcher_registry_count", { n: matcher.registryCount })}
                </span>
              )}
            </div>
          }
        />

        <SourceCard
          title={t("matcher_open")}
          blurb={state.autoOpen ? t("matcher_open_auto") : t("matcher_open_blurb")}
          checked={state.autoOpen}
          toggleLabel={t("matcher_open_toggle")}
          onToggle={(on) => set({ autoOpen: on })}
          footer={
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="demo-button demo-button-secondary !px-3 !py-1 text-xs"
                disabled={matcher.lookingUp || stats.unmatched.length === 0 || !perCodeOn}
                onClick={() => matcher.lookUp(stats.unmatched.slice(0, AUTO_BATCH))}
              >
                <IconSearch size={12} />
                {t(
                  stats.unmatched.length === 1 ? "matcher_look_up_one" : "matcher_look_up_many",
                  { n: stats.unmatched.length },
                )}
              </button>
              {matcher.lookupCount > 0 && (
                <span className="ml-auto">
                  {t(
                    matcher.lookupCount === 1
                      ? "matcher_open_count_one"
                      : "matcher_open_count_many",
                    { n: matcher.lookupCount },
                  )}
                </span>
              )}
            </div>
          }
        />

        {[...presets.map((p) => ({ ...p })), ...customShops.map(customSource)].map((shop) => {
          const key = shop.id === "custom" ? shop.site : shop.id
          const on = state.shops.includes(key)
          const loading = matcher.loadingShops.includes(key)
          const count = matcher.shopEntries[key]?.length ?? 0
          return (
            <SourceCard
              key={key}
              title={shop.label}
              chip={shop.sector ? t(`matcher_sector_${shop.sector}` as StringKey) : undefined}
              blurb={t("matcher_shop_blurb", { site: hostOf(shop.site) })}
              checked={on}
              toggleLabel={t("matcher_shop_toggle", { name: shop.label })}
              onToggle={(next) => toggleShop(key, next)}
              footer={
                <div className="flex items-center gap-2">
                  <a
                    href={shop.site}
                    target="_blank"
                    rel="noreferrer"
                    className="truncate font-semibold"
                    style={{ color: "var(--ink-faint)" }}
                  >
                    {hostOf(shop.site)}
                  </a>
                  {on && (
                    <button
                      type="button"
                      onClick={() => matcher.loadShop(key, true).catch(() => {})}
                      disabled={loading}
                      className="ml-auto inline-flex flex-shrink-0 items-center gap-1 font-semibold"
                      style={{ color: "var(--ink-faint)" }}
                    >
                      <IconRefresh size={12} />
                      {loading
                        ? t("matcher_loading")
                        : t("matcher_shop_count", { n: count })}
                    </button>
                  )}
                </div>
              }
            />
          )
        })}
      </div>

      {/* any other shop */}
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="min-w-[16rem] flex-1">
          <span className="demo-muted mb-1 block text-xs font-bold tracking-wide uppercase">
            {t("matcher_add_shop")}
          </span>
          <input
            className="demo-input"
            placeholder="https://shop.markaniz.com.tr"
            value={newShop}
            onChange={(e) => setNewShop(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                addShop()
              }
            }}
          />
        </label>
        <button
          type="button"
          className="demo-button demo-button-secondary !py-2.5"
          onClick={addShop}
          disabled={!newShop.trim()}
        >
          {t("matcher_add")}
        </button>
        <p className="demo-muted w-full text-xs">{t("matcher_add_shop_hint")}</p>
      </div>

      {/* own list */}
      <div className="mt-4">
        <label className="block">
          <span className="demo-muted mb-1 block text-xs font-bold tracking-wide uppercase">
            {t("matcher_list_label")}
          </span>
          <textarea
            className="demo-input font-mono text-xs"
            rows={5}
            spellCheck={false}
            placeholder={"8697742122934, Barrier Yağ 100ml\n8697742122965; Kakao Yağı 150ml"}
            value={state.ownText}
            onChange={(e) => set({ ownText: e.target.value.slice(0, MAX_LIST_CHARS) })}
          />
        </label>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className="demo-button demo-button-secondary !px-3.5 !py-1.5 text-xs">
            <IconDownload size={13} className="rotate-180" />
            {t("matcher_import")}
            <input
              type="file"
              accept=".csv,.tsv,.txt,text/csv,text/plain"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) matcher.importFile(file)
                e.target.value = ""
              }}
            />
          </label>
          <button
            type="button"
            className="demo-button demo-button-secondary !px-3.5 !py-1.5 text-xs"
            onClick={matcher.reset}
          >
            {t("matcher_clear")}
          </button>
          <span className="demo-muted text-xs">{t("matcher_list_hint")}</span>
        </div>
      </div>

      {/* where the names land */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="demo-muted mb-1 block text-xs font-bold tracking-wide uppercase">
            {t("matcher_mode")}
          </span>
          <select
            className="demo-select"
            value={state.mode}
            onChange={(e) => set({ mode: e.target.value as FillMode })}
          >
            <option value="new">{t("matcher_mode_new")}</option>
            <option value="fill">{t("matcher_mode_fill")}</option>
          </select>
        </label>
        <label className="block">
          <span className="demo-muted mb-1 block text-xs font-bold tracking-wide uppercase">
            {t("matcher_column_label")}
          </span>
          <input
            className="demo-input"
            placeholder={t("matcher_default_label")}
            value={state.label}
            onChange={(e) => set({ label: e.target.value })}
            disabled={state.mode === "fill"}
          />
        </label>
      </div>

      {/* the rest of what a source knows */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="demo-muted text-xs font-bold tracking-wide uppercase">
          {t("matcher_extras")}
        </span>
        {EXTRA_FIELDS.map((field) => (
          <label key={field} className="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={state.extras.includes(field)}
              onChange={(e) =>
                set({
                  extras: e.target.checked
                    ? [...state.extras, field]
                    : state.extras.filter((f) => f !== field),
                })
              }
            />
            {t(`matcher_extra_${field}` as StringKey)}
          </label>
        ))}
      </div>

      {matcher.error && (
        <p
          className="mt-3 flex items-center gap-1.5 text-sm font-semibold"
          style={{ color: "var(--danger)" }}
        >
          <IconAlert size={15} />
          {matcher.error}
        </p>
      )}
    </section>
  )
}

const hostOf = (site: string) => {
  try {
    return new URL(site).hostname.replace(/^www\./, "")
  } catch {
    return site
  }
}

const customSource = (url: string): SourceInfo => ({
  id: "custom",
  label: hostOf(url),
  site: url,
  kind: "shop",
})
