import { createFileRoute } from "@tanstack/react-router"
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react"
import {
  IconAlert,
  IconArrowDown,
  IconArrowUp,
  IconCheck,
  IconColumns,
  IconCopy,
  IconDownload,
  IconFile,
  IconLock,
  IconSparkle,
  IconUpload,
  IconX,
} from "../components/icons"
import BarcodeMatcher, {
  type MatchStats,
  useBarcodeMatcher,
} from "../components/BarcodeMatcher"
import { useLang } from "../components/lang"
import type { StringKey } from "../lib/i18n"
import { detectBarcodeColumn, fillNames } from "../lib/barcode"
import { inferColumnKinds, parseNumber } from "../lib/cell-value"
import {
  type CombinedColumn,
  combine,
  discoverColumns,
  type ExtractedDoc,
  pickPrimarySheet,
  resolvePrimary,
} from "../lib/combine"
import { type Reconciliation, reconcile } from "../lib/reconcile"
import {
  DEFAULT_PDF_ENGINE,
  DEFAULT_TIER,
  type ExtractResult,
  formatCost,
  PDF_ENGINES,
  type QualityTier,
  type SessionInfo,
  type Sheet,
  TIERS,
} from "../lib/tiers"

export const Route = createFileRoute("/")({ component: Page })

const PREVIEW_ROWS = 200
const ACCEPT =
  ".pdf,image/png,image/jpeg,image/webp,image/tiff,image/bmp,image/gif,.xlsx,.xlsm,.csv,.tsv"
/** Two at a time: fast enough to feel batched, gentle on rate limits. */
const CONCURRENCY = 2
const COLUMNS_KEY = "docsheet.combined.columns.v1"
const COMBINED_VIEW = "__combined"

const isPdfFile = (f: File) =>
  f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")

/** A spreadsheet is already a spreadsheet — it skips the model entirely. */
const isSheetFile = (f: File) => /\.(xlsx|xlsm|xltx|csv|tsv)$/i.test(f.name)

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/**
 * Turkish Excel splits a CSV on semicolons, because the comma is the decimal
 * point — a comma-separated file opens as one column per row, with every price
 * in quotes. So the separator follows the language the sheet is being read in,
 * which is also the convention this app's own CSV reader expects.
 */
function toCsv(sheet: Sheet, delimiter: string): string {
  const needsQuotes = new RegExp(`["\\n\\r${delimiter}]`)
  const esc = (v: string) => {
    const s = String(v ?? "")
    // Excel evaluates a CSV field that opens with =, + or @ — a description
    // read as "=DEVİR 2026" would arrive as #NAME? instead of as itself. The
    // apostrophe is Excel's own "this is text" mark and isn't displayed. A
    // leading minus is left alone: that one really is a negative figure.
    const cell = /^[=+@]/.test(s) && parseNumber(s) === null ? `'${s}` : s
    return needsQuotes.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell
  }
  const lines: string[] = []
  if (sheet.columns.length) lines.push(sheet.columns.map(esc).join(delimiter))
  for (const row of sheet.rows) lines.push(row.map(esc).join(delimiter))
  return "﻿" + lines.join("\r\n")
}

const stem = (name: string) =>
  (name.split(/[/\\]/).pop() ?? name).replace(/\.[^.]+$/, "") || "export"

const escapeHtml = (value: string) =>
  value.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"))

/**
 * Put the whole sheet on the clipboard in both shapes Excel understands.
 *
 * Selecting the preview by hand is what makes a paste land a column out: the
 * drag starts mid-cell, the table scrolls under it, and only the rows on screen
 * come along. Copying here takes every row — tab-separated for a plain paste,
 * and as a real table for Excel, where the code columns are marked as text so a
 * 13-digit barcode stays a barcode instead of arriving as 8,69774E+12.
 */
async function copySheet(sheet: Sheet): Promise<void> {
  const width = Math.max(sheet.columns.length, ...sheet.rows.map((r) => r.length), 0)
  const kinds = inferColumnKinds(sheet)
  const barcodeAt = detectBarcodeColumn(sheet)
  // Figures and dates are left for Excel to read; everything else is pinned as
  // text, which is what saves a leading zero and a long code.
  const asText = Array.from(
    { length: width },
    (_, i) => i === barcodeAt || (kinds[i] !== "number" && kinds[i] !== "date"),
  )

  // A tab or a newline inside a cell is the other way a paste shifts.
  const clean = (cell: string) => String(cell ?? "").replace(/[\t\r\n]+/g, " ")
  const line = (cells: string[]) =>
    Array.from({ length: width }, (_, i) => clean(cells[i] ?? "")).join("\t")
  const htmlRow = (cells: string[], tag: "th" | "td") =>
    `<tr>${Array.from({ length: width }, (_, i) => {
      const style = asText[i] ? ` style="mso-number-format:'\\@'"` : ""
      return `<${tag}${style}>${escapeHtml(clean(cells[i] ?? ""))}</${tag}>`
    }).join("")}</tr>`

  const text = [line(sheet.columns), ...sheet.rows.map(line)].join("\r\n")
  const html = `<table>${htmlRow(sheet.columns, "th")}${sheet.rows
    .map((row) => htmlRow(row, "td"))
    .join("")}</table>`

  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/plain": new Blob([text], { type: "text/plain" }),
        "text/html": new Blob([html], { type: "text/html" }),
      }),
    ])
    return
  }
  // Older browsers get the tab-separated form, which Excel still splits into
  // columns — it just can't be told which of them are text.
  if (!navigator.clipboard) throw new Error("This browser won't let a page write to the clipboard.")
  await navigator.clipboard.writeText(text)
}

const ENGINE_KEYS: Record<string, StringKey> = {
  "pdf-text": "engine_used_text",
  "mistral-ocr": "engine_used_ocr",
  native: "engine_used_native",
}

const ENGINE_LABEL_KEYS: Record<string, StringKey> = {
  auto: "engine_auto",
  "mistral-ocr": "engine_mistral",
  native: "engine_native",
  "pdf-text": "engine_pdf_text",
}

const COLUMN_LABEL_KEYS: Record<string, StringKey> = {
  __source: "col_source",
  barcode: "col_barcode",
  code: "col_code",
  item: "col_item",
  quantity: "col_quantity",
  unit: "col_unit",
  unit_price: "col_unit_price",
  discount: "col_discount",
  vat: "col_vat",
  amount: "col_amount",
  date: "col_date",
}

const money = (n: number, locale: string) =>
  n.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// ── Route shell: session → gate or app ────────────────────────────────────
function Page() {
  const { t } = useLang()
  const [session, setSession] = useState<SessionInfo | null>(null)

  const refresh = () =>
    fetch("/api/session")
      .then((r) => r.json())
      .then((d: SessionInfo) => setSession(d))
      .catch(() => setSession({ authRequired: false, authed: true, keyConfigured: false }))

  useEffect(() => {
    refresh()
  }, [])

  if (!session) {
    return (
      <main className="demo-page demo-center">
        <div className="demo-muted text-sm">{t("loading")}</div>
      </main>
    )
  }
  if (session.authRequired && !session.authed) {
    return <PasswordGate onUnlocked={refresh} />
  }
  return (
    <App
      session={session}
      onLogout={async () => {
        await fetch("/api/logout", { method: "POST" })
        refresh()
      }}
    />
  )
}

// ── Password gate ─────────────────────────────────────────────────────────
function PasswordGate({ onUnlocked }: { onUnlocked: () => void }) {
  const { t } = useLang()
  const [pw, setPw] = useState("")
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pw }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error ?? t("gate_wrong"))
      }
      onUnlocked()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="demo-page demo-center">
      <form onSubmit={submit} className="demo-panel rise-in w-full max-w-sm text-center">
        <div
          className="mx-auto mb-5 grid h-12 w-12 place-items-center rounded-xl"
          style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
        >
          <IconLock size={20} />
        </div>
        <p className="island-kicker mb-2">{t("gate_kicker")}</p>
        <h1 className="display-title mb-2 text-2xl font-extrabold">{t("gate_title")}</h1>
        <p className="demo-muted mb-6 text-sm">{t("gate_hint")}</p>
        <input
          autoFocus
          type="password"
          className="demo-input mb-3 text-center tracking-[0.3em]"
          placeholder="••••••••••"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
        />
        {err && (
          <p
            className="mb-3 flex items-center justify-center gap-1.5 text-sm font-semibold"
            style={{ color: "var(--danger)" }}
          >
            <IconAlert size={15} />
            {err}
          </p>
        )}
        <button type="submit" className="demo-button w-full" disabled={busy || !pw}>
          {busy ? t("gate_unlocking") : t("gate_unlock")}
        </button>
      </form>
    </main>
  )
}

// ── Batch queue ───────────────────────────────────────────────────────────
type DocStatus = "queued" | "running" | "done" | "error"

interface DocState {
  id: string
  file: File
  status: DocStatus
  result?: ExtractResult
  error?: string
}

/**
 * Per-column layout, remembered across sessions. `order` is the position the
 * user dragged the column to — the order the program they paste into expects,
 * which is otherwise redone by hand on every invoice.
 */
type ColumnPrefs = Record<string, { label: string; include: boolean; order?: number }>

function loadColumnPrefs(): ColumnPrefs {
  try {
    const raw = localStorage.getItem(COLUMNS_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === "object" ? (parsed as ColumnPrefs) : {}
  } catch {
    return {}
  }
}

/** Run tasks with a small pool so a stack of invoices doesn't fire at once. */
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

// ── Main app ──────────────────────────────────────────────────────────────
function App({ session, onLogout }: { session: SessionInfo; onLogout: () => void }) {
  const { t, locale } = useLang()
  const [docs, setDocs] = useState<DocState[]>([])
  /** Which table from each document feeds the combined sheet. */
  const [primary, setPrimary] = useState<Record<string, number>>({})
  const [dragging, setDragging] = useState(false)
  const [tier, setTier] = useState<QualityTier>(DEFAULT_TIER)
  const [customModel, setCustomModel] = useState("")
  const [pdfEngine, setPdfEngine] = useState(DEFAULT_PDF_ENGINE)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Empty means "whatever came in first" — a pill click pins the choice. */
  const [view, setView] = useState<string>("")
  const [activeSheet, setActiveSheet] = useState(0)
  const [busyFmt, setBusyFmt] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [columnPrefs, setColumnPrefs] = useState<ColumnPrefs>({})
  const [editingColumns, setEditingColumns] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // localStorage only exists in the browser; reading it in render would break SSR.
  useEffect(() => {
    setColumnPrefs(loadColumnPrefs())
  }, [])

  const savePrefs = (next: ColumnPrefs) => {
    setColumnPrefs(next)
    try {
      localStorage.setItem(COLUMNS_KEY, JSON.stringify(next))
    } catch {
      /* private mode — the session still works, it just won't be remembered */
    }
  }

  const addFiles = (list: FileList | null | undefined) => {
    const incoming = Array.from(list ?? [])
    if (!incoming.length) return
    setError(null)
    setDocs((prev) => [
      ...prev,
      ...incoming.map((file, i) => ({
        id: `${Date.now()}-${i}-${file.name}`,
        file,
        status: "queued" as DocStatus,
      })),
    ])
  }

  const removeDoc = (id: string) => setDocs((prev) => prev.filter((d) => d.id !== id))
  const clearAll = () => {
    setDocs([])
    setError(null)
    setView("")
  }

  const patch = (id: string, next: Partial<DocState>) =>
    setDocs((prev) => prev.map((d) => (d.id === id ? { ...d, ...next } : d)))

  const extractOne = async (doc: DocState) => {
    patch(doc.id, { status: "running", error: undefined })
    try {
      const sheetOnly = isSheetFile(doc.file)
      const fd = new FormData()
      fd.append("file", doc.file)
      if (!sheetOnly) {
        fd.append("tier", tier)
        if (customModel.trim()) fd.append("model", customModel.trim())
        fd.append("pdfEngine", pdfEngine)
      }

      // A workbook is read on the server and comes back in the same shape an
      // extraction does — no model, no cost.
      const res = await fetch(sheetOnly ? "/api/sheet" : "/api/extract", {
        method: "POST",
        body: fd,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`)
      patch(doc.id, { status: "done", result: data as ExtractResult })
    } catch (e) {
      patch(doc.id, { status: "error", error: (e as Error).message })
    }
  }

  const onExtract = async () => {
    const pending = docs.filter((d) => d.status === "queued" || d.status === "error")
    if (!pending.length) return
    setRunning(true)
    setError(null)
    try {
      await runPool(pending, CONCURRENCY, extractOne)
    } finally {
      setRunning(false)
    }
  }

  const done = docs.filter((d) => d.result)

  // Barcode → name. The catalog fills each document's own table *before* the
  // documents are stacked, so a matched name and its shelf price are ordinary
  // columns in Your layout — reorderable, renamable and remembered, like every
  // other column. Appended after the stacking they could only ever land last,
  // which is the wrong place for whatever program the sheet is pasted into.
  const matcher = useBarcodeMatcher()
  const matcherOn = matcher.state.enabled && matcher.catalog.size > 0

  const filled = useMemo(
    () =>
      docs
        .filter((d) => d.result)
        .map((d) => {
          const sheets = d.result?.sheets ?? []
          // Filled whether or not the matcher is on: with an empty catalog the
          // fill is what reports which codes nothing knows yet, which is what
          // asks for them to be looked up.
          const fills = sheets.map((s) => fillNames(s, matcher.catalog, matcher.options))
          return {
            id: d.id,
            filename: d.file.name,
            fills,
            sheets: matcherOn ? fills.map((f) => f.sheet) : sheets,
            // Which table feeds the combined sheet is decided on the document as
            // it was read: a filled column widens a two-column header block,
            // which would otherwise let it outscore the line-item table.
            primaryIndex: primary[d.id] ?? pickPrimarySheet(sheets),
          }
        }),
    [docs, primary, matcherOn, matcher.catalog, matcher.options],
  )

  const extracted: ExtractedDoc[] = useMemo(
    () => filled.map(({ filename, sheets, primaryIndex }) => ({ filename, sheets, primaryIndex })),
    [filled],
  )

  const labelFor = useMemo(
    () => (key: string, fallback: string) =>
      COLUMN_LABEL_KEYS[key] ? t(COLUMN_LABEL_KEYS[key]) : fallback,
    [t],
  )
  const discovered = useMemo(
    () => discoverColumns(extracted, labelFor),
    [extracted, labelFor],
  )
  const columns: CombinedColumn[] = useMemo(
    () =>
      discovered
        .map((c, at) => ({
          column: {
            ...c,
            label: columnPrefs[c.key]?.label ?? c.label,
            include: columnPrefs[c.key]?.include ?? true,
          },
          // A column this document brought that the saved layout has never
          // seen lands after it, in the order it was discovered.
          order: columnPrefs[c.key]?.order ?? Number.POSITIVE_INFINITY,
          at,
        }))
        .sort((a, b) => a.order - b.order || a.at - b.at)
        .map((entry) => entry.column),
    [discovered, columnPrefs],
  )

  /** Move a column one place up or down, and pin the whole order it lands in. */
  const moveColumn = (key: string, delta: number) => {
    const from = columns.findIndex((c) => c.key === key)
    const to = from + delta
    if (from === -1 || to < 0 || to >= columns.length) return
    const next = [...columns]
    next.splice(to, 0, ...next.splice(from, 1))
    savePrefs({
      // Merged, not replaced: a rename saved for a supplier who isn't in this
      // batch shouldn't be forgotten because another supplier's columns moved.
      ...columnPrefs,
      ...Object.fromEntries(
        next.map((c, order) => [c.key, { label: c.label, include: c.include, order }]),
      ),
    })
  }
  const combinedSheet = useMemo(() => combine(extracted, columns), [extracted, columns])

  const reconciliations = useMemo(() => {
    const map = new Map<string, Reconciliation | null>()
    for (const d of docs) {
      if (d.result) map.set(d.id, reconcile(d.result.sheets))
    }
    return map
  }, [docs])

  // The combined sheet is also the layout sheet: normalised headings, in the
  // order you put them in. That is worth having for a single invoice too — it
  // is what gets pasted into a stock program — so it is offered from the first
  // document, with the document itself still what you land on.
  const showCombined = done.length > 0
  const effectiveView = view || done[0]?.id || COMBINED_VIEW
  const currentDoc = done.find((d) => d.id === effectiveView)
  const currentEntry = filled.find((e) => e.id === effectiveView)
  // The matcher never edits the extraction itself: switch it off and the
  // document's own sheets are what shows, exactly as the model read them.
  const outputSheets: Sheet[] = useMemo(
    () => (currentEntry ? currentEntry.sheets : showCombined ? [combinedSheet] : []),
    [currentEntry, showCombined, combinedSheet],
  )
  // Misread codes are repaired when the document is read, so the count belongs
  // to the documents on screen rather than to this pass of the matcher.
  const repaired = useMemo(
    () =>
      (currentDoc ? [currentDoc] : done).reduce(
        (n, d) => n + (d.result?.repairedBarcodes ?? 0),
        0,
      ),
    [currentDoc, done],
  )
  // What the panel reports is what is on screen: every table of this document,
  // or the one table per document that the combined sheet stacks.
  const matchStats: MatchStats = useMemo(() => {
    const shown = currentEntry
      ? currentEntry.fills
      : filled.map((e) => e.fills[e.primaryIndex]).filter((f) => f !== undefined)

    const unmatched = new Set<string>()
    let rows = 0
    let matched = 0
    let priced = 0
    let hasBarcodeColumn = false
    for (const fill of shown) {
      if (fill.barcodeColumn === -1) continue
      hasBarcodeColumn = true
      rows += fill.barcodeRows
      matched += fill.matched
      priced += fill.priced
      for (const code of fill.unmatched) unmatched.add(code)
    }
    return { rows, matched, priced, unmatched: [...unmatched], hasBarcodeColumn, repaired }
  }, [currentEntry, filled, repaired])

  // Sheet index is per view; keep it in range when the view changes.
  useEffect(() => {
    setActiveSheet(0)
  }, [effectiveView])

  const sheet = outputSheets[Math.min(activeSheet, outputSheets.length - 1)]
  const currentRecon = currentDoc ? reconciliations.get(currentDoc.id) : null
  const isPrimaryHere = currentDoc
    ? resolvePrimary({
        filename: currentDoc.file.name,
        sheets: currentDoc.result?.sheets ?? [],
        primaryIndex: primary[currentDoc.id],
      }) === activeSheet
    : false

  // Barcodes parse as numbers but aren't figures — keep them left-aligned, the
  // way the export keeps them text.
  const numericColumns = useMemo(() => {
    if (!sheet) return []
    const barcodeAt = detectBarcodeColumn(sheet)
    return inferColumnKinds(sheet, PREVIEW_ROWS).map(
      (kind, i) => kind === "number" && i !== barcodeAt,
    )
  }, [sheet])

  const totalCost = done.reduce(
    (sum, d) => sum + (typeof d.result?.cost === "number" ? d.result.cost : 0),
    0,
  )
  const totalRows = done.reduce(
    (sum, d) => sum + (d.result?.sheets ?? []).reduce((n, s) => n + s.rows.length, 0),
    0,
  )
  const pending = docs.filter((d) => d.status === "queued" || d.status === "error")
  const queued = pending.length
  const showPdfEngine = docs.some((d) => isPdfFile(d.file))
  /** Nothing queued needs a model, so the tier and engine choices are noise. */
  const sheetsOnly = docs.length > 0 && docs.every((d) => isSheetFile(d.file))

  // The tick goes back to the button after a moment; it says the clipboard has
  // the sheet, not that anything is still happening.
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])

  const onCopy = async () => {
    if (!sheet) return
    setError(null)
    try {
      await copySheet(sheet)
      setCopied(true)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const onDownload = async (fmt: "xlsx" | "csv" | "json") => {
    if (!outputSheets.length) return
    setBusyFmt(fmt)
    setError(null)
    try {
      const base = currentDoc ? stem(currentDoc.file.name) : "combined"
      if (fmt === "csv") {
        if (!sheet) return
        downloadBlob(
          new Blob([toCsv(sheet, locale === "tr-TR" ? ";" : ",")], {
            type: "text/csv;charset=utf-8",
          }),
          `${base}${outputSheets.length > 1 ? `-${stem(sheet.name)}` : ""}.csv`,
        )
      } else if (fmt === "json") {
        downloadBlob(
          new Blob([JSON.stringify({ sheets: outputSheets }, null, 2)], {
            type: "application/json",
          }),
          `${base}.json`,
        )
      } else {
        const res = await fetch("/api/xlsx", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sheets: outputSheets, filename: base }),
        })
        if (!res.ok) throw new Error(`Export failed (HTTP ${res.status})`)
        downloadBlob(await res.blob(), `${base}.xlsx`)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusyFmt(null)
    }
  }

  return (
    <main className="demo-page">
      {/* hero */}
      <header className="mb-8">
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="island-kicker">{t("hero_kicker")}</p>
          {session.authRequired && (
            <button
              type="button"
              onClick={onLogout}
              className="demo-button demo-button-secondary flex-shrink-0 !px-3.5 !py-1.5 text-xs"
            >
              <IconLock size={14} />
              {t("lock")}
            </button>
          )}
        </div>
        {/* Only the full stop carries the accent — the eye should land on the
            CTA, not on a noun in the headline. */}
        <h1 className="demo-title mb-3">
          {t("hero_title_lead")}
          <span className="accent-text">.</span>
        </h1>
        <p className="demo-muted max-w-2xl text-base sm:text-lg">{t("hero_body")}</p>
      </header>

      {session.keyConfigured === false && (
        <div className="demo-alert mb-6">
          <IconAlert size={17} className="mt-px flex-shrink-0" />
          <span>
            <strong>{t("no_key_title")}</strong>{" "}
            {t("no_key_body", { code: "OPENROUTER_API_KEY" })
              .split("OPENROUTER_API_KEY")
              .flatMap((part, i) => (i === 0 ? [part] : [<code key={i}>OPENROUTER_API_KEY</code>, part]))}{" "}
            {t("no_key_sheets")}
          </span>
        </div>
      )}
      {error && (
        <div className="demo-alert demo-alert-danger mb-6">
          <IconAlert size={17} className="mt-px flex-shrink-0" style={{ color: "var(--danger)" }} />
          <span>{error}</span>
        </div>
      )}

      <section className="demo-panel rise-in">
        {/* dropzone */}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragEnter={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={(e) => {
            e.preventDefault()
            setDragging(false)
          }}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            addFiles(e.dataTransfer.files)
          }}
          className="flex w-full flex-col items-center justify-center gap-3 rounded-2xl border border-dashed px-6 py-12 text-center transition"
          style={{
            borderColor: dragging ? "var(--accent)" : "var(--line-strong)",
            background: dragging ? "var(--accent-soft)" : "var(--surface-sunken)",
          }}
        >
          <span
            className="grid h-11 w-11 place-items-center rounded-full"
            style={{
              background: "var(--surface)",
              border: "1px solid var(--line)",
              color: dragging ? "var(--accent)" : "var(--ink-soft)",
            }}
          >
            {docs.length ? <IconFile size={20} /> : <IconUpload size={20} />}
          </span>
          <span className="flex flex-col gap-1">
            <span className="font-bold" style={{ color: "var(--ink)" }}>
              {docs.length ? t("drop_more") : t("drop_first")}
            </span>
            <span className="demo-muted text-sm">{t("drop_types")}</span>
          </span>
        </button>
        <p className="demo-muted mt-2 text-center text-xs">{t("drop_sheet_note")}</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            addFiles(e.target.files)
            e.target.value = ""
          }}
        />

        {/* queue */}
        {docs.length > 0 && (
          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="demo-section-title">
                {t(docs.length === 1 ? "queue_count_one" : "queue_count_many", {
                  n: docs.length,
                })}
              </p>
              <button
                type="button"
                onClick={clearAll}
                className="text-xs font-semibold"
                style={{ color: "var(--ink-faint)" }}
              >
                {t("queue_clear")}
              </button>
            </div>
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {docs.map((d) => (
                <li
                  key={d.id}
                  className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm"
                  style={{ background: "var(--surface-sunken)" }}
                >
                  <StatusMark status={d.status} />
                  <span className="min-w-0 flex-1 truncate font-semibold">{d.file.name}</span>
                  {isSheetFile(d.file) && (
                    <span className="island-kicker flex-shrink-0">{t("sheet_badge")}</span>
                  )}
                  {d.status === "done" && (
                    <ReconMark reconciliation={reconciliations.get(d.id) ?? null} />
                  )}
                  {d.error && (
                    <span className="truncate text-xs" style={{ color: "var(--danger)" }}>
                      {d.error}
                    </span>
                  )}
                  <span className="demo-muted flex-shrink-0 text-xs tabular-nums">
                    {(d.file.size / 1024).toFixed(0)} KB
                  </span>
                  <button
                    type="button"
                    onClick={() => removeDoc(d.id)}
                    aria-label={t("queue_remove", { name: d.file.name })}
                    className="flex-shrink-0 rounded p-1"
                    style={{ color: "var(--ink-faint)" }}
                  >
                    <IconX size={14} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* quality — hidden when nothing queued needs a model */}
        <div className="mt-6" hidden={sheetsOnly}>
          <p className="demo-section-title mb-3">{t("quality")}</p>
          {/* items-stretch + mt-auto keeps every price hint on one baseline,
              however many lines the blurb above it wraps to. */}
          <div className="grid items-stretch gap-3 sm:grid-cols-3">
            {TIERS.map((info) => {
              const active = tier === info.id
              return (
                <button
                  key={info.id}
                  type="button"
                  onClick={() => setTier(info.id)}
                  aria-pressed={active}
                  className="demo-card flex flex-col text-left transition"
                  style={{
                    borderColor: active ? "var(--accent)" : "var(--line)",
                    boxShadow: active ? "0 0 0 1px var(--accent)" : undefined,
                  }}
                >
                  <div className="flex h-5 items-center justify-between gap-2">
                    <span className="font-extrabold" style={{ color: "var(--ink)" }}>
                      {t(`tier_${info.id}_label` as StringKey)}
                    </span>
                    {active && (
                      <span
                        className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
                        style={{ background: "var(--accent)" }}
                      />
                    )}
                  </div>
                  <p className="demo-muted mt-2 text-sm leading-snug">
                    {t(`tier_${info.id}_blurb` as StringKey)}
                  </p>
                  <p className="mt-auto pt-3 text-xs" style={{ color: "var(--ink-faint)" }}>
                    {t("tier_price", {
                      price: money(Number(info.pricePerMillion), locale),
                    })}
                  </p>
                </button>
              )
            })}
          </div>
        </div>

        {/* advanced */}
        <details className="mt-4" hidden={sheetsOnly}>
          <summary className="demo-muted cursor-pointer text-sm font-bold select-none">
            {t("advanced")}
          </summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="demo-muted mb-1 block text-xs font-bold uppercase tracking-wide">
                {t("custom_model")}
              </span>
              <input
                className="demo-input"
                placeholder={TIERS.find((t) => t.id === tier)?.model}
                value={customModel}
                onChange={(e) => setCustomModel(e.target.value)}
              />
            </label>
            {showPdfEngine && (
              <label className="block">
                <span className="demo-muted mb-1 block text-xs font-bold uppercase tracking-wide">
                  {t("pdf_engine")}
                </span>
                <select
                  className="demo-select"
                  value={pdfEngine}
                  onChange={(e) => setPdfEngine(e.target.value)}
                >
                  {PDF_ENGINES.map((eng) => (
                    <option key={eng.id} value={eng.id}>
                      {ENGINE_LABEL_KEYS[eng.id] ? t(ENGINE_LABEL_KEYS[eng.id]) : eng.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </details>

        <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-3">
          <button
            type="button"
            className="demo-button"
            disabled={!queued || running}
            onClick={onExtract}
          >
            <IconSparkle size={16} />
            {running
              ? t(sheetsOnly ? "sheet_reading" : "extracting")
              : queued > 1
                ? t(sheetsOnly ? "sheet_read_many" : "extract_many", { n: queued })
                : t(sheetsOnly ? "sheet_read_one" : "extract_one")}
          </button>
          {done.length > 0 && (
            <span className="demo-muted text-sm font-semibold">
              {t("status_done", { n: done.length, rows: totalRows })}
              {totalCost > 0 ? ` · ${formatCost(totalCost)}` : ""}
              {done.length === 1 && done[0].result?.engineUsed
                ? ` · ${
                    ENGINE_KEYS[done[0].result.engineUsed]
                      ? t(ENGINE_KEYS[done[0].result.engineUsed])
                      : done[0].result.engineUsed
                  }`
                : ""}
            </span>
          )}
        </div>
      </section>

      {/* barcode → name */}
      {done.length > 0 && <BarcodeMatcher matcher={matcher} stats={matchStats} />}

      {/* results */}
      {done.length > 0 && sheet && (
        <section className="demo-panel rise-in mt-6">
          {showCombined && (
            <div className="mb-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setView(COMBINED_VIEW)}
                aria-pressed={effectiveView === COMBINED_VIEW}
                className={`demo-pill${effectiveView === COMBINED_VIEW ? " demo-pill-active" : ""}`}
              >
                {/* With one document there is nothing to combine — the same
                    sheet is simply your columns, in your order. */}
                {t(done.length > 1 ? "combined" : "layout")} · {combinedSheet.rows.length}
              </button>
              {done.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setView(d.id)}
                  aria-pressed={effectiveView === d.id}
                  className={`demo-pill${effectiveView === d.id ? " demo-pill-active" : ""}`}
                >
                  {d.file.name}
                </button>
              ))}
            </div>
          )}

          {currentRecon && (
            <div
              className="demo-alert mb-4"
              style={
                currentRecon.ok
                  ? { borderLeftColor: "var(--accent)" }
                  : { borderColor: "var(--danger-line)", borderLeftColor: "var(--danger)" }
              }
            >
              {currentRecon.ok ? (
                <IconCheck size={17} className="mt-px flex-shrink-0" style={{ color: "var(--accent)" }} />
              ) : (
                <IconAlert size={17} className="mt-px flex-shrink-0" style={{ color: "var(--danger)" }} />
              )}
              <span>
                {currentRecon.ok ? (
                  <>
                    <strong>{t("recon_ok_title")}</strong>{" "}
                    {t("recon_ok_body", {
                      column: currentRecon.columnName,
                      sum: money(currentRecon.sum, locale),
                      label: currentRecon.statedLabel,
                    })}
                  </>
                ) : (
                  <>
                    <strong>{t("recon_bad_title")}</strong>{" "}
                    {t("recon_bad_body", {
                      column: currentRecon.columnName,
                      sum: money(currentRecon.sum, locale),
                      stated: money(currentRecon.stated, locale),
                      label: currentRecon.statedLabel,
                      delta: money(Math.abs(currentRecon.delta), locale),
                    })}
                  </>
                )}
              </span>
            </div>
          )}

          {/* One sheet needs no tabs — in the combined view that would just
              repeat the "Combined" pill from the view switcher above. */}
          {(outputSheets.length > 1 || effectiveView === COMBINED_VIEW) && (
            <div className="mb-4 flex flex-wrap items-center gap-2">
              {outputSheets.length > 1 &&
                outputSheets.map((s, i) => (
                  <button
                    key={`${s.name}-${i}`}
                    type="button"
                    onClick={() => setActiveSheet(i)}
                    aria-pressed={i === activeSheet}
                    className={`demo-pill${i === activeSheet ? " demo-pill-active" : ""}`}
                  >
                    {s.name || `Sheet ${i + 1}`} · {s.rows.length}
                  </button>
                ))}
              {/* Which of this document's tables feeds the combined sheet.
                  The automatic pick is the largest table, which is right for an
                  invoice but wrong when a document holds two real tables. */}
              {currentDoc && showCombined && outputSheets.length > 1 && (
                <button
                  type="button"
                  onClick={() => setPrimary((prev) => ({ ...prev, [currentDoc.id]: activeSheet }))}
                  disabled={isPrimaryHere}
                  aria-pressed={isPrimaryHere}
                  className={`demo-pill ml-auto${isPrimaryHere ? " demo-pill-active" : ""}`}
                >
                  {isPrimaryHere ? <IconCheck size={13} /> : <IconColumns size={13} />}
                  {isPrimaryHere ? t("in_combined") : t("use_in_combined")}
                </button>
              )}
              {effectiveView === COMBINED_VIEW && (
                <button
                  type="button"
                  onClick={() => setEditingColumns((v) => !v)}
                  className="demo-pill ml-auto"
                  aria-expanded={editingColumns}
                >
                  <IconColumns size={13} />
                  {t("columns")}
                </button>
              )}
            </div>
          )}

          {editingColumns && effectiveView === COMBINED_VIEW && (
            <div className="demo-card mb-4">
              <p className="demo-section-title mb-1">{t("columns_title")}</p>
              <p className="demo-muted mb-3 text-xs">{t("columns_hint")}</p>
              {/* One per line, top to bottom: the list reads in the order the
                  columns come out in, which is the point of being able to
                  move them. */}
              <div className="grid gap-2">
                {columns.map((c, at) => (
                  <div key={c.key} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={c.include}
                      aria-label={t("columns_include", { name: c.label })}
                      onChange={(e) =>
                        savePrefs({
                          ...columnPrefs,
                          [c.key]: {
                            label: c.label,
                            include: e.target.checked,
                            order: columnPrefs[c.key]?.order,
                          },
                        })
                      }
                    />
                    <input
                      className="demo-input !py-1.5 text-sm"
                      value={c.label}
                      aria-label={t("columns_rename", { name: c.label })}
                      onChange={(e) =>
                        savePrefs({
                          ...columnPrefs,
                          [c.key]: {
                            label: e.target.value,
                            include: c.include,
                            order: columnPrefs[c.key]?.order,
                          },
                        })
                      }
                    />
                    <button
                      type="button"
                      onClick={() => moveColumn(c.key, -1)}
                      disabled={at === 0}
                      aria-label={t("columns_move_up", { name: c.label })}
                      className="flex-shrink-0 rounded p-1 disabled:opacity-30"
                      style={{ color: "var(--ink-faint)" }}
                    >
                      <IconArrowUp size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveColumn(c.key, 1)}
                      disabled={at === columns.length - 1}
                      aria-label={t("columns_move_down", { name: c.label })}
                      className="flex-shrink-0 rounded p-1 disabled:opacity-30"
                      style={{ color: "var(--ink-faint)" }}
                    >
                      <IconArrowDown size={14} />
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="demo-button demo-button-secondary mt-3 !px-3.5 !py-1.5 text-xs"
                onClick={() => savePrefs({})}
              >
                {t("columns_reset")}
              </button>
            </div>
          )}

          <div className="demo-table-shell" style={{ maxHeight: 460 }}>
            <table className="demo-table">
              <thead>
                <tr>
                  {sheet.columns.map((c, i) => (
                    <th key={i} className={numericColumns[i] ? "is-numeric" : undefined}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sheet.rows.slice(0, PREVIEW_ROWS).map((row, ri) => (
                  <tr key={ri}>
                    {row.map((cell, ci) => (
                      <td key={ci} className={numericColumns[ci] ? "is-numeric" : undefined}>
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="demo-muted mt-3 text-sm">
            {sheet.rows.length > PREVIEW_ROWS
              ? t("rows_truncated", { n: PREVIEW_ROWS, total: sheet.rows.length })
              : t(sheet.rows.length === 1 ? "rows_one" : "rows_many", { n: sheet.rows.length })}
            {outputSheets.length > 1 && t("csv_note")} {t("copy_note")}
          </p>

          <div className="mt-5 flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              className="demo-button"
              disabled={busyFmt !== null}
              onClick={() => onDownload("xlsx")}
            >
              <IconDownload size={16} />
              {busyFmt === "xlsx" ? t("preparing") : "Excel"}
            </button>
            {/* Straight into an open spreadsheet, every row of it, without
                going through a file — which is how this sheet is most often
                actually used. */}
            <button type="button" className="demo-button demo-button-secondary" onClick={onCopy}>
              {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
              {copied ? t("copied") : t("copy")}
            </button>
            <button
              type="button"
              className="demo-button demo-button-secondary"
              disabled={busyFmt !== null}
              onClick={() => onDownload("csv")}
            >
              <IconDownload size={16} />
              CSV
            </button>
            <button
              type="button"
              className="demo-button demo-button-secondary"
              disabled={busyFmt !== null}
              onClick={() => onDownload("json")}
            >
              <IconDownload size={16} />
              JSON
            </button>
          </div>
        </section>
      )}
    </main>
  )
}

function StatusMark({ status }: { status: DocStatus }) {
  if (status === "done") {
    return <IconCheck size={15} style={{ color: "var(--accent)" }} className="flex-shrink-0" />
  }
  if (status === "error") {
    return <IconAlert size={15} style={{ color: "var(--danger)" }} className="flex-shrink-0" />
  }
  return (
    <span
      className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
      style={{
        background: status === "running" ? "var(--accent)" : "var(--ink-faint)",
        opacity: status === "running" ? 1 : 0.5,
      }}
    />
  )
}

function ReconMark({ reconciliation }: { reconciliation: Reconciliation | null }) {
  const { t, locale } = useLang()
  if (!reconciliation) return null
  return (
    <span
      className="flex-shrink-0 text-xs font-semibold"
      style={{ color: reconciliation.ok ? "var(--ink-faint)" : "var(--danger)" }}
      title={
        reconciliation.ok
          ? t("recon_ok_body", {
              column: reconciliation.columnName,
              sum: money(reconciliation.sum, locale),
              label: reconciliation.statedLabel,
            })
          : t("recon_bad_body", {
              column: reconciliation.columnName,
              sum: money(reconciliation.sum, locale),
              stated: money(reconciliation.stated, locale),
              label: reconciliation.statedLabel,
              delta: money(Math.abs(reconciliation.delta), locale),
            })
      }
    >
      {reconciliation.ok ? t("totals_ok") : t("totals_bad")}
    </span>
  )
}
