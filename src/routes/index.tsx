import { createFileRoute } from "@tanstack/react-router"
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react"
import {
  IconAlert,
  IconDownload,
  IconFile,
  IconLock,
  IconSparkle,
  IconUpload,
} from "../components/icons"
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

/**
 * Is this cell a figure? Tolerates currency and both decimal conventions
 * ("1.250,00" and "1,250.00") but rejects codes like "15202ST" so reference
 * columns stay left-aligned.
 */
function isNumericCell(value: string): boolean {
  const core = value
    .trim()
    .replace(/^[-+]?\s*/, "")
    .replace(/^(?:[$€£₺¥]|TL|USD|EUR|GBP|TRY)\s*/i, "")
    .replace(/\s*(?:[$€£₺¥]|TL|USD|EUR|GBP|TRY|%)$/i, "")
    .trim()
  return /^\d[\d.,'\s]*$/.test(core)
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

// ── Main app ──────────────────────────────────────────────────────────────
function App({ session, onLogout }: { session: SessionInfo; onLogout: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)
  const [tier, setTier] = useState<QualityTier>(DEFAULT_TIER)
  const [customModel, setCustomModel] = useState("")
  const [pdfEngine, setPdfEngine] = useState(DEFAULT_PDF_ENGINE)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [result, setResult] = useState<ExtractResult | null>(null)
  const [activeSheet, setActiveSheet] = useState(0)
  const [busyFmt, setBusyFmt] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const pickFile = (f: File | null | undefined) => {
    if (!f) return
    setFile(f)
    setResult(null)
    setError(null)
    setStatus(null)
  }

  const onExtract = async () => {
    if (!file) return
    setLoading(true)
    setError(null)
    setStatus("Reading your document…")
    try {
      const fd = new FormData()
      fd.append("file", file)
      fd.append("tier", tier)
      if (customModel.trim()) fd.append("model", customModel.trim())
      fd.append("pdfEngine", pdfEngine)

      const res = await fetch("/api/extract", { method: "POST", body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`)

      const r = data as ExtractResult
      setResult(r)
      setActiveSheet(0)
      const n = r.sheets.length
      const via = r.isPdf && r.engineUsed ? ` · ${engineLabel(r.engineUsed)}` : ""
      const spend = typeof r.cost === "number" ? ` · ${formatCost(r.cost)}` : ""
      setStatus(`${n} table${n === 1 ? "" : "s"} · ${r.model}${via}${spend}`)
    } catch (e) {
      setError((e as Error).message)
      setStatus(null)
    } finally {
      setLoading(false)
    }
  }

  const onDownload = async (fmt: "xlsx" | "csv" | "json") => {
    if (!result) return
    setBusyFmt(fmt)
    setError(null)
    try {
      const base = stem(result.filename)
      if (fmt === "csv") {
        const sheet = result.sheets[activeSheet] ?? result.sheets[0]
        downloadBlob(new Blob([toCsv(sheet)], { type: "text/csv;charset=utf-8" }), `${base}.csv`)
      } else if (fmt === "json") {
        const json = JSON.stringify({ sheets: result.sheets }, null, 2)
        downloadBlob(new Blob([json], { type: "application/json" }), `${base}.json`)
      } else {
        const res = await fetch("/api/xlsx", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sheets: result.sheets, filename: result.filename }),
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

  const sheet = result?.sheets[activeSheet]
  const showPdfEngine = file ? isPdfFile(file) : false

  // A column is a figure column only when every filled cell in it is a figure.
  const numericColumns = useMemo(() => {
    if (!sheet) return []
    const rows = sheet.rows.slice(0, PREVIEW_ROWS)
    const width = Math.max(sheet.columns.length, ...rows.map((r) => r.length), 0)
    return Array.from({ length: width }, (_, ci) => {
      let filled = 0
      for (const row of rows) {
        const cell = row[ci] ?? ""
        if (!cell.trim()) continue
        if (!isNumericCell(cell)) return false
        filled++
      }
      return filled > 0
    })
  }, [sheet])

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
          Drop a PDF or photo — the best OCR models pull out every table. Preview, then
          download as <strong>Excel</strong>, <strong>CSV</strong>, or JSON.
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
            pickFile(e.dataTransfer.files?.[0])
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
            {file ? <IconFile size={20} /> : <IconUpload size={20} />}
          </span>
          {file ? (
            <span className="demo-pill">
              {file.name} · {(file.size / 1024).toFixed(0)} KB
            </span>
          ) : (
            <span className="flex flex-col gap-1">
              <span className="font-bold" style={{ color: "var(--ink)" }}>
                Drop a PDF or image, or click to browse
              </span>
              <span className="demo-muted text-sm">
                PDF · PNG · JPG · WEBP · TIFF · max 25 MB
              </span>
            </span>
          )}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => pickFile(e.target.files?.[0])}
        />

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
          <summary className="demo-muted cursor-pointer text-sm font-bold select-none">Advanced options</summary>
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
                <span className="demo-muted mb-1 block text-xs font-bold uppercase tracking-wide">PDF engine</span>
                <select className="demo-select" value={pdfEngine} onChange={(e) => setPdfEngine(e.target.value)}>
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
          <button type="button" className="demo-button" disabled={!file || loading} onClick={onExtract}>
            <IconSparkle size={16} />
            {loading ? "Extracting…" : "Extract tables"}
          </button>
          {status && <span className="demo-muted text-sm font-semibold">{status}</span>}
        </div>
      </section>

      {/* results */}
      {result && sheet && (
        <section className="demo-panel rise-in mt-6">
          <div className="mb-4 flex flex-wrap gap-2">
            {result.sheets.map((s, i) => (
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
          </div>

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
          </p>

          <div className="mt-5 flex flex-wrap gap-2.5">
            <button type="button" className="demo-button" disabled={busyFmt !== null} onClick={() => onDownload("xlsx")}>
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
