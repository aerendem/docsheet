import { createFileRoute } from "@tanstack/react-router"
import { useEffect, useRef, useState } from "react"
import {
  DEFAULT_PDF_ENGINE,
  DEFAULT_TIER,
  PDF_ENGINES,
  type ExtractResult,
  type QualityTier,
  type Sheet,
  TIERS,
} from "../lib/tiers"

export const Route = createFileRoute("/")({ component: App })

const PREVIEW_ROWS = 200
const ACCEPT = ".pdf,image/png,image/jpeg,image/webp,image/tiff,image/bmp,image/gif"

function isPdfFile(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
}

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
  return "﻿" + lines.join("\r\n") // BOM so Excel reads UTF-8
}

function stem(name: string): string {
  return (name.split(/[/\\]/).pop() ?? name).replace(/\.[^.]+$/, "") || "export"
}

function App() {
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
  const [keyConfigured, setKeyConfigured] = useState<boolean | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((d) => setKeyConfigured(Boolean(d.keyConfigured)))
      .catch(() => setKeyConfigured(null))
  }, [])

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
    setStatus("Running OCR… this usually takes 10–60s.")
    try {
      const fd = new FormData()
      fd.append("file", file)
      fd.append("tier", tier)
      if (customModel.trim()) fd.append("model", customModel.trim())
      fd.append("pdfEngine", pdfEngine)

      const res = await fetch("/api/extract", { method: "POST", body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`)

      setResult(data as ExtractResult)
      setActiveSheet(0)
      const n = (data as ExtractResult).sheets.length
      setStatus(`Done — ${n} table${n === 1 ? "" : "s"} via ${(data as ExtractResult).model}.`)
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

  return (
    <main className="demo-page demo-page-wide">
      <header className="mb-8">
        <p className="island-kicker mb-2">PDF &amp; image → spreadsheet</p>
        <h1 className="demo-title mb-3">Turn any document into Excel or CSV.</h1>
        <p className="demo-muted max-w-2xl text-base">
          Drop a PDF or photo and the best OCR models (via OpenRouter) pull out every table.
          Preview it, then download as <strong>.xlsx</strong>, <strong>.csv</strong>, or JSON.
        </p>
      </header>

      {keyConfigured === false && (
        <div className="demo-alert mb-6">
          <strong>OPENROUTER_API_KEY is not set on the server.</strong> Extraction will fail until
          you add it (locally in <code>.env</code>, or as a Railway variable), then restart.
        </div>
      )}
      {error && <div className="demo-alert demo-alert-danger mb-6">⚠️ {error}</div>}

      <section className="demo-panel">
        {/* Dropzone */}
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
          className="flex w-full flex-col items-center justify-center rounded-2xl border border-dashed p-8 text-center transition"
          style={{
            borderColor: dragging ? "var(--lagoon-deep)" : "var(--line)",
            background: dragging ? "color-mix(in oklab, var(--lagoon) 12%, transparent)" : "transparent",
          }}
        >
          <span className="mb-2 text-3xl" aria-hidden>
            ⬆︎
          </span>
          {file ? (
            <span className="demo-pill">
              📄 {file.name} · {(file.size / 1024).toFixed(0)} KB
            </span>
          ) : (
            <>
              <span className="font-semibold" style={{ color: "var(--sea-ink)" }}>
                Drop a PDF or image here, or click to browse
              </span>
              <span className="demo-muted mt-1 text-sm">PDF, PNG, JPG, WEBP, TIFF, BMP · max 25 MB</span>
            </>
          )}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => pickFile(e.target.files?.[0])}
        />

        {/* Quality selector */}
        <div className="mt-6">
          <p className="demo-section-title mb-2">Quality</p>
          <div className="grid gap-3 sm:grid-cols-3">
            {TIERS.map((t) => {
              const active = tier === t.id
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTier(t.id)}
                  className="demo-card text-left transition"
                  style={{
                    borderColor: active ? "var(--lagoon-deep)" : "var(--line)",
                    boxShadow: active
                      ? "0 0 0 2px color-mix(in oklab, var(--lagoon) 40%, transparent)"
                      : undefined,
                  }}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold" style={{ color: "var(--sea-ink)" }}>
                      {t.label}
                    </span>
                    {t.id === DEFAULT_TIER && <span className="demo-pill">recommended</span>}
                  </div>
                  <p className="demo-muted mt-1 text-sm">{t.blurb}</p>
                  <p className="demo-muted mt-2 text-xs opacity-80">{t.priceHint}</p>
                </button>
              )
            })}
          </div>
        </div>

        {/* Advanced */}
        <details className="mt-4">
          <summary className="demo-muted cursor-pointer text-sm font-semibold select-none">
            Advanced options
          </summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="demo-muted mb-1 block text-xs font-semibold uppercase tracking-wide">
                Custom model id (overrides quality)
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
                <span className="demo-muted mb-1 block text-xs font-semibold uppercase tracking-wide">
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

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="demo-button"
            disabled={!file || loading}
            onClick={onExtract}
          >
            {loading ? "Extracting…" : "Extract tables"}
          </button>
          {status && <span className="demo-muted text-sm">{status}</span>}
        </div>
      </section>

      {/* Results */}
      {result && sheet && (
        <section className="demo-panel mt-6">
          <div className="mb-3 flex flex-wrap gap-2">
            {result.sheets.map((s, i) => (
              <button
                key={`${s.name}-${i}`}
                type="button"
                onClick={() => setActiveSheet(i)}
                className="demo-pill"
                style={{
                  borderColor: i === activeSheet ? "var(--lagoon-deep)" : "var(--chip-line)",
                  color: i === activeSheet ? "var(--sea-ink)" : "var(--sea-ink-soft)",
                }}
              >
                {s.name || `Sheet ${i + 1}`} ({s.rows.length})
              </button>
            ))}
          </div>

          <div className="demo-table-shell" style={{ maxHeight: 460 }}>
            <table className="demo-table">
              <thead>
                <tr>
                  {sheet.columns.map((c, i) => (
                    <th key={i}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sheet.rows.slice(0, PREVIEW_ROWS).map((row, ri) => (
                  <tr key={ri}>
                    {row.map((cell, ci) => (
                      <td key={ci}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="demo-muted mt-2 text-sm">
            {sheet.rows.length > PREVIEW_ROWS
              ? `Showing first ${PREVIEW_ROWS} of ${sheet.rows.length} rows — the download has them all.`
              : `${sheet.rows.length} row${sheet.rows.length === 1 ? "" : "s"}.`}
          </p>

          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              className="demo-button"
              disabled={busyFmt !== null}
              onClick={() => onDownload("xlsx")}
            >
              {busyFmt === "xlsx" ? "Preparing…" : "⬇︎ Excel (.xlsx)"}
            </button>
            <button
              type="button"
              className="demo-button demo-button-secondary"
              disabled={busyFmt !== null}
              onClick={() => onDownload("csv")}
            >
              ⬇︎ CSV (this sheet)
            </button>
            <button
              type="button"
              className="demo-button demo-button-secondary"
              disabled={busyFmt !== null}
              onClick={() => onDownload("json")}
            >
              ⬇︎ JSON
            </button>
          </div>
        </section>
      )}
    </main>
  )
}
