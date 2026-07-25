// The barcode → name matcher.
//
// State lives here (and in localStorage) rather than in the page: the catalog
// outlives any single upload, so a supplier's list only has to be set up once.
// The page uses `catalog` + `options` to fill a column into whatever sheets it
// is about to show or download.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  buildCatalog,
  type Catalog,
  type CatalogEntry,
  type FillMode,
  type FillOptions,
  parseCatalogList,
} from "../lib/barcode"
import {
  IconAlert,
  IconBarcode,
  IconCheck,
  IconDownload,
  IconRefresh,
  IconSearch,
} from "./icons"
import { useLang } from "./lang"

const STORAGE_KEY = "docsheet.matcher.v1"
const SHOP_SOURCE = "naturenurture"
/** Enough to paste a supplier's whole price list, not enough to wedge storage. */
const MAX_LIST_CHARS = 500_000

interface Persisted {
  enabled: boolean
  mode: FillMode
  label: string
  ownText: string
  useShop: boolean
}

const DEFAULTS: Persisted = {
  enabled: true,
  mode: "new",
  label: "",
  ownText: "",
  useShop: false,
}

interface SourceInfo {
  id: string
  label: string
  site: string
}

export interface MatcherApi {
  state: Persisted
  set: (patch: Partial<Persisted>) => void
  catalog: Catalog
  options: FillOptions
  ownCount: number
  ownSkipped: number
  shop: { entries: CatalogEntry[]; info: SourceInfo | null; loading: boolean }
  lookupCount: number
  lookingUp: boolean
  error: string | null
  loadShop: (refresh?: boolean) => Promise<void>
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

export function useBarcodeMatcher(): MatcherApi {
  const { t } = useLang()
  const [state, setState] = useState<Persisted>(DEFAULTS)
  const [hydrated, setHydrated] = useState(false)
  const [shopEntries, setShopEntries] = useState<CatalogEntry[]>([])
  const [shopInfo, setShopInfo] = useState<SourceInfo | null>(null)
  const [shopLoading, setShopLoading] = useState(false)
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

  const set = useCallback((patch: Partial<Persisted>) => {
    setState((prev) => ({ ...prev, ...patch }))
  }, [])

  const own = useMemo(
    () => parseCatalogList(state.ownText, "own"),
    [state.ownText],
  )

  // Priority runs left to right: a name you pasted yourself beats the shop,
  // which beats whatever a public database guessed. A source that is switched
  // off contributes nothing, but its entries stay in memory so switching it
  // back on doesn't mean fetching them again.
  const catalog = useMemo(
    () => buildCatalog([lookupEntries, state.useShop ? shopEntries : [], own.entries]),
    [lookupEntries, shopEntries, state.useShop, own.entries],
  )

  const options: FillOptions = useMemo(
    () => ({ label: state.label.trim() || t("matcher_default_label"), mode: state.mode }),
    [state.label, state.mode, t],
  )

  const loadShop = useCallback(
    async (refresh = false) => {
      setShopLoading(true)
      setError(null)
      try {
        const res = await fetch(
          `/api/catalog?source=${SHOP_SOURCE}${refresh ? "&refresh=1" : ""}`,
        )
        const data = await res.json()
        if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`)
        setShopEntries(data.entries as CatalogEntry[])
        setShopInfo(data.source as SourceInfo)
      } catch (e) {
        setError((e as Error).message)
        throw e
      } finally {
        setShopLoading(false)
      }
    },
    [],
  )

  const lookUp = useCallback(async (barcodes: string[]) => {
    if (!barcodes.length) return
    setLookingUp(true)
    setError(null)
    try {
      const res = await fetch("/api/barcodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ barcodes }),
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
  }, [])

  const importFile = useCallback(async (file: File) => {
    setError(null)
    const text = await file.text()
    setState((prev) => {
      const joined = prev.ownText.trim() ? `${prev.ownText.trim()}\n${text}` : text
      return { ...prev, ownText: joined.slice(0, MAX_LIST_CHARS) }
    })
  }, [])

  // Switching the shop on — now, or in a session three days ago whose choice
  // was remembered — is what fetches its catalog. `attempted` keeps a failure
  // from retrying on every render; flipping the switch off clears it.
  const attempted = useRef(false)
  useEffect(() => {
    if (!hydrated) return
    if (!state.useShop) {
      attempted.current = false
      return
    }
    if (attempted.current || shopEntries.length) return
    attempted.current = true
    loadShop().catch(() => set({ useShop: false }))
  }, [hydrated, state.useShop, shopEntries.length, loadShop, set])

  const reset = useCallback(() => {
    setLookupEntries([])
    set({ ownText: "" })
  }, [set])

  return {
    state,
    set,
    catalog,
    options,
    ownCount: own.entries.length,
    ownSkipped: own.skipped,
    shop: { entries: shopEntries, info: shopInfo, loading: shopLoading },
    lookupCount: lookupEntries.length,
    lookingUp,
    error,
    loadShop,
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
}

const UNMATCHED_SHOWN = 24

export default function BarcodeMatcher({
  matcher,
  stats,
}: {
  matcher: MatcherApi
  stats: MatchStats
}) {
  const { t } = useLang()
  const [open, setOpen] = useState(false)
  const { state, set, shop } = matcher

  // Turning the shop off shouldn't throw away a crawl that took 150 requests,
  // so its entries stay loaded and only stop counting.
  const activeShopEntries = state.useShop ? shop.entries.length : 0
  const total = matcher.ownCount + activeShopEntries + matcher.lookupCount

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
          </>
        )}
        <span className="demo-muted ml-auto text-xs">
          {t("matcher_catalog_size", { n: total })}
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
      <p className="demo-section-title mt-5 mb-2">{t("matcher_sources")}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="demo-card flex flex-col">
          <p className="font-extrabold">{t("matcher_own")}</p>
          <p className="demo-muted mt-1 text-sm leading-snug">{t("matcher_own_blurb")}</p>
          <p className="mt-auto pt-3 text-xs" style={{ color: "var(--ink-faint)" }}>
            {t("matcher_own_count", { n: matcher.ownCount })}
            {matcher.ownSkipped > 0 ? ` · ${t("matcher_own_skipped", { n: matcher.ownSkipped })}` : ""}
          </p>
        </div>

        <div className="demo-card flex flex-col">
          <div className="flex items-start justify-between gap-2">
            <p className="font-extrabold">Nature &amp; Nurture</p>
            <input
              type="checkbox"
              className="mt-1"
              checked={state.useShop}
              aria-label={t("matcher_shop_toggle")}
              onChange={(e) => set({ useShop: e.target.checked })}
            />
          </div>
          <p className="demo-muted mt-1 text-sm leading-snug">{t("matcher_shop_blurb")}</p>
          <div className="mt-auto flex items-center gap-2 pt-3 text-xs">
            <a
              href={shop.info?.site ?? "https://shop.naturenurture.com.tr"}
              target="_blank"
              rel="noreferrer"
              className="font-semibold"
              style={{ color: "var(--ink-faint)" }}
            >
              shop.naturenurture.com.tr
            </a>
            {state.useShop && (
              <button
                type="button"
                onClick={() => matcher.loadShop(true).catch(() => {})}
                disabled={shop.loading}
                className="ml-auto inline-flex items-center gap-1 font-semibold"
                style={{ color: "var(--ink-faint)" }}
              >
                <IconRefresh size={12} />
                {shop.loading ? t("matcher_loading") : t("matcher_refresh")}
              </button>
            )}
          </div>
          {activeShopEntries > 0 && (
            <p className="mt-1 text-xs" style={{ color: "var(--ink-faint)" }}>
              {t("matcher_shop_count", { n: activeShopEntries })}
            </p>
          )}
        </div>

        <div className="demo-card flex flex-col">
          <p className="font-extrabold">{t("matcher_open")}</p>
          <p className="demo-muted mt-1 text-sm leading-snug">{t("matcher_open_blurb")}</p>
          <button
            type="button"
            className="demo-button demo-button-secondary mt-3 !px-3.5 !py-1.5 text-xs"
            disabled={matcher.lookingUp || stats.unmatched.length === 0}
            onClick={() => matcher.lookUp(stats.unmatched)}
          >
            <IconSearch size={13} />
            {matcher.lookingUp
              ? t("matcher_looking_up")
              : t("matcher_look_up", { n: stats.unmatched.length })}
          </button>
          {matcher.lookupCount > 0 && (
            <p className="mt-2 text-xs" style={{ color: "var(--ink-faint)" }}>
              {t("matcher_open_count", { n: matcher.lookupCount })}
            </p>
          )}
        </div>
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
