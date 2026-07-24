import { createFileRoute } from "@tanstack/react-router"
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react"
import {
  IconAlert,
  IconCheck,
  IconColumns,
  IconDownload,
  IconFile,
  IconLock,
  IconSparkle,
  IconUpload,
  IconX,
} from "../components/icons"
import { inferColumnKinds } from "../lib/cell-value"
import {
  type CombinedColumn,
  combine,
  discoverColumns,
  type ExtractedDoc,
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
const ACCEPT = ".pdf,image/png,image/jpeg,image/webp,image/tiff,image/bmp,image/gif"
/** Two at a time: fast enough to feel batched, gentle on rate limits. */
const CONCURRENCY = 2
const COLUMNS_KEY = "docsheet.combined.columns.v1"
const COMBINED_VIEW = "__combined"

const isPdfFile = (f: File) =>
  f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")

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

function toCsv(sheet: Sheet): string {
  const esc = (v: string) => {
    const s = String(v ?? "")
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines: string[] = []
  if (sheet.columns.length) lines.push(sheet.columns.map(esc).join(","))
  for (const row of sheet.rows) lines.push(row.map(esc).join(","))
  return "﻿" + lines.join("\r\n")
}

const stem = (name: string) =>
  (name.split(/[/\\]/).pop() ?? name).replace(/\.[^.]+$/, "") || "export"

const engineLabel = (id?: string) =>
  id === "pdf-text"
    ? "text layer · free"
    : id === "mistral-ocr"
      ? "Mistral OCR"
      : id === "native"
        ? "native"
        : id

const money = (n: number) =>
  n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// ── Route shell: session → gate or app ────────────────────────────────────
function Page() {
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
        <div className="demo-muted text-sm">Loading…</div>
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
        throw new Error(d.error ?? "Wrong password.")
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
        <p className="island-kicker mb-2">docsheet</p>
        <h1 className="display-title mb-2 text-2xl font-extrabold">Private workspace</h1>
        <p className="demo-muted mb-6 text-sm">Enter the password to continue.</p>
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
          {busy ? "Unlocking…" : "Unlock"}
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

type ColumnPrefs = Record<string, { label: string; include: boolean }>

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
  const [docs, setDocs] = useState<DocState[]>([])
  const [dragging, setDragging] = useState(false)
  const [tier, setTier] = useState<QualityTier>(DEFAULT_TIER)
  const [customModel, setCustomModel] = useState("")
  const [pdfEngine, setPdfEngine] = useState(DEFAULT_PDF_ENGINE)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<string>(COMBINED_VIEW)
  const [activeSheet, setActiveSheet] = useState(0)
  const [busyFmt, setBusyFmt] = useState<string | null>(null)
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
    setView(COMBINED_VIEW)
  }

  const patch = (id: string, next: Partial<DocState>) =>
    setDocs((prev) => prev.map((d) => (d.id === id ? { ...d, ...next } : d)))

  const extractOne = async (doc: DocState) => {
    patch(doc.id, { status: "running", error: undefined })
    try {
      const fd = new FormData()
      fd.append("file", doc.file)
      fd.append("tier", tier)
      if (customModel.trim()) fd.append("model", customModel.trim())
      fd.append("pdfEngine", pdfEngine)

      const res = await fetch("/api/extract", { method: "POST", body: fd })
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
  const extracted: ExtractedDoc[] = useMemo(
    () =>
      docs
        .filter((d) => d.result)
        .map((d) => ({ filename: d.file.name, sheets: d.result?.sheets ?? [] })),
    [docs],
  )

  const discovered = useMemo(() => discoverColumns(extracted), [extracted])
  const columns: CombinedColumn[] = useMemo(
    () =>
      discovered.map((c) => ({
        ...c,
        label: columnPrefs[c.key]?.label ?? c.label,
        include: columnPrefs[c.key]?.include ?? true,
      })),
    [discovered, columnPrefs],
  )
  const combinedSheet = useMemo(() => combine(extracted, columns), [extracted, columns])

  const reconciliations = useMemo(() => {
    const map = new Map<string, Reconciliation | null>()
    for (const d of docs) {
      if (d.result) map.set(d.id, reconcile(d.result.sheets))
    }
    return map
  }, [docs])

  const showCombined = done.length > 1
  const effectiveView = showCombined ? view : (done[0]?.id ?? COMBINED_VIEW)
  const currentDoc = done.find((d) => d.id === effectiveView)
  const currentSheets: Sheet[] = currentDoc
    ? (currentDoc.result?.sheets ?? [])
    : showCombined
      ? [combinedSheet]
      : []

  // Sheet index is per view; keep it in range when the view changes.
  useEffect(() => {
    setActiveSheet(0)
  }, [effectiveView])

  const sheet = currentSheets[Math.min(activeSheet, currentSheets.length - 1)]
  const currentRecon = currentDoc ? reconciliations.get(currentDoc.id) : null

  const numericColumns = useMemo(
    () => (sheet ? inferColumnKinds(sheet, PREVIEW_ROWS).map((k) => k === "number") : []),
    [sheet],
  )

  const totalCost = done.reduce(
    (sum, d) => sum + (typeof d.result?.cost === "number" ? d.result.cost : 0),
    0,
  )
  const totalRows = done.reduce(
    (sum, d) => sum + (d.result?.sheets ?? []).reduce((n, s) => n + s.rows.length, 0),
    0,
  )
  const queued = docs.filter((d) => d.status === "queued" || d.status === "error").length
  const showPdfEngine = docs.some((d) => isPdfFile(d.file))

  const onDownload = async (fmt: "xlsx" | "csv" | "json") => {
    if (!currentSheets.length) return
    setBusyFmt(fmt)
    setError(null)
    try {
      const base = currentDoc ? stem(currentDoc.file.name) : "combined"
      if (fmt === "csv") {
        if (!sheet) return
        downloadBlob(
          new Blob([toCsv(sheet)], { type: "text/csv;charset=utf-8" }),
          `${base}${currentSheets.length > 1 ? `-${stem(sheet.name)}` : ""}.csv`,
        )
      } else if (fmt === "json") {
        downloadBlob(
          new Blob([JSON.stringify({ sheets: currentSheets }, null, 2)], {
            type: "application/json",
          }),
          `${base}.json`,
        )
      } else {
        const res = await fetch("/api/xlsx", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sheets: currentSheets, filename: base }),
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
          <p className="island-kicker">PDF &amp; image → spreadsheet</p>
          {session.authRequired && (
            <button
              type="button"
              onClick={onLogout}
              className="demo-button demo-button-secondary flex-shrink-0 !px-3.5 !py-1.5 text-xs"
            >
              <IconLock size={14} />
              Lock
            </button>
          )}
        </div>
        {/* Only the full stop carries the accent — the eye should land on the
            CTA, not on a noun in the headline. */}
        <h1 className="demo-title mb-3">
          Turn documents into spreadsheets<span className="accent-text">.</span>
        </h1>
        <p className="demo-muted max-w-2xl text-base sm:text-lg">
          Drop a stack of PDFs or photos — the best OCR models pull out every table, check
          the totals add up, and stack them into one sheet you can download as{" "}
          <strong>Excel</strong>, <strong>CSV</strong>, or JSON.
        </p>
      </header>

      {session.keyConfigured === false && (
        <div className="demo-alert mb-6">
          <IconAlert size={17} className="mt-px flex-shrink-0" />
          <span>
            <strong>No OpenRouter key set.</strong> Extraction needs{" "}
            <code>OPENROUTER_API_KEY</code> on the server.
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
              {docs.length
                ? "Add more documents"
                : "Drop PDFs or images, or click to browse"}
            </span>
            <span className="demo-muted text-sm">
              PDF · PNG · JPG · WEBP · TIFF · max 25 MB each
            </span>
          </span>
        </button>
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
                {docs.length} document{docs.length === 1 ? "" : "s"}
              </p>
              <button
                type="button"
                onClick={clearAll}
                className="text-xs font-semibold"
                style={{ color: "var(--ink-faint)" }}
              >
                Clear all
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
                    aria-label={`Remove ${d.file.name}`}
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

        {/* quality */}
        <div className="mt-6">
          <p className="demo-section-title mb-3">Quality</p>
          {/* items-stretch + mt-auto keeps every price hint on one baseline,
              however many lines the blurb above it wraps to. */}
          <div className="grid items-stretch gap-3 sm:grid-cols-3">
            {TIERS.map((t) => {
              const active = tier === t.id
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTier(t.id)}
                  aria-pressed={active}
                  className="demo-card flex flex-col text-left transition"
                  style={{
                    borderColor: active ? "var(--accent)" : "var(--line)",
                    boxShadow: active ? "0 0 0 1px var(--accent)" : undefined,
                  }}
                >
                  <div className="flex h-5 items-center justify-between gap-2">
                    <span className="font-extrabold" style={{ color: "var(--ink)" }}>
                      {t.label}
                    </span>
                    {active && (
                      <span
                        className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
                        style={{ background: "var(--accent)" }}
                      />
                    )}
                  </div>
                  <p className="demo-muted mt-2 text-sm leading-snug">{t.blurb}</p>
                  <p className="mt-auto pt-3 text-xs" style={{ color: "var(--ink-faint)" }}>
                    {t.priceHint}
                  </p>
                </button>
              )
            })}
          </div>
        </div>

        {/* advanced */}
        <details className="mt-4">
          <summary className="demo-muted cursor-pointer text-sm font-bold select-none">
            Advanced options
          </summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="demo-muted mb-1 block text-xs font-bold uppercase tracking-wide">
                Custom model id
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
                  PDF engine
                </span>
                <select
                  className="demo-select"
                  value={pdfEngine}
                  onChange={(e) => setPdfEngine(e.target.value)}
                >
                  {PDF_ENGINES.map((eng) => (
                    <option key={eng.id} value={eng.id}>
                      {eng.label}
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
              ? "Extracting…"
              : queued > 1
                ? `Extract ${queued} documents`
                : "Extract tables"}
          </button>
          {done.length > 0 && (
            <span className="demo-muted text-sm font-semibold">
              {done.length} done · {totalRows} rows
              {totalCost > 0 ? ` · ${formatCost(totalCost)}` : ""}
              {done.length === 1 && done[0].result?.engineUsed
                ? ` · ${engineLabel(done[0].result.engineUsed)}`
                : ""}
            </span>
          )}
        </div>
      </section>

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
                Combined · {combinedSheet.rows.length}
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
                    <strong>Totals reconcile.</strong> “{currentRecon.columnName}” adds up to{" "}
                    {money(currentRecon.sum)}, matching “{currentRecon.statedLabel}” on the
                    document.
                  </>
                ) : (
                  <>
                    <strong>Totals don’t match.</strong> “{currentRecon.columnName}” adds up to{" "}
                    {money(currentRecon.sum)} but the document states {money(currentRecon.stated)}{" "}
                    for “{currentRecon.statedLabel}” — off by {money(Math.abs(currentRecon.delta))}.
                    Worth checking before you use this one.
                  </>
                )}
              </span>
            </div>
          )}

          {/* One sheet needs no tabs — in the combined view that would just
              repeat the "Combined" pill from the view switcher above. */}
          {(currentSheets.length > 1 || effectiveView === COMBINED_VIEW) && (
            <div className="mb-4 flex flex-wrap items-center gap-2">
              {currentSheets.length > 1 &&
                currentSheets.map((s, i) => (
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
              {effectiveView === COMBINED_VIEW && (
                <button
                  type="button"
                  onClick={() => setEditingColumns((v) => !v)}
                  className="demo-pill ml-auto"
                  aria-expanded={editingColumns}
                >
                  <IconColumns size={13} />
                  Columns
                </button>
              )}
            </div>
          )}

          {editingColumns && effectiveView === COMBINED_VIEW && (
            <div className="demo-card mb-4">
              <p className="demo-section-title mb-1">Combined columns</p>
              <p className="demo-muted mb-3 text-xs">
                Rename or switch off columns — the choice is remembered for next time, so a
                supplier’s layout only has to be set up once.
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {columns.map((c) => (
                  <div key={c.key} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={c.include}
                      aria-label={`Include ${c.label}`}
                      onChange={(e) =>
                        savePrefs({
                          ...columnPrefs,
                          [c.key]: { label: c.label, include: e.target.checked },
                        })
                      }
                    />
                    <input
                      className="demo-input !py-1.5 text-sm"
                      value={c.label}
                      aria-label={`Rename ${c.label}`}
                      onChange={(e) =>
                        savePrefs({
                          ...columnPrefs,
                          [c.key]: { label: e.target.value, include: c.include },
                        })
                      }
                    />
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="demo-button demo-button-secondary mt-3 !px-3.5 !py-1.5 text-xs"
                onClick={() => savePrefs({})}
              >
                Reset to detected
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
              ? `Showing first ${PREVIEW_ROWS} of ${sheet.rows.length} rows — the download has them all.`
              : `${sheet.rows.length} row${sheet.rows.length === 1 ? "" : "s"}.`}
            {currentSheets.length > 1 && " CSV saves this sheet only; Excel saves all of them."}
          </p>

          <div className="mt-5 flex flex-wrap gap-2.5">
            <button
              type="button"
              className="demo-button"
              disabled={busyFmt !== null}
              onClick={() => onDownload("xlsx")}
            >
              <IconDownload size={16} />
              {busyFmt === "xlsx" ? "Preparing…" : "Excel"}
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
  if (!reconciliation) return null
  return (
    <span
      className="flex-shrink-0 text-xs font-semibold"
      style={{ color: reconciliation.ok ? "var(--ink-faint)" : "var(--danger)" }}
      title={
        reconciliation.ok
          ? `${reconciliation.columnName} sums to ${money(reconciliation.sum)}, matching ${reconciliation.statedLabel}`
          : `${reconciliation.columnName} sums to ${money(reconciliation.sum)} but the document states ${money(reconciliation.stated)}`
      }
    >
      {reconciliation.ok ? "totals ✓" : "totals ✕"}
    </span>
  )
}
