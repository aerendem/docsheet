// Server-only OCR logic. Talks to OpenRouter, then normalizes the model's reply
// into clean spreadsheet "sheets". Never import this from client code — it reads
// process.env and uses Buffer.

import { DEFAULT_PDF_ENGINE, modelForTier, type Sheet } from "../lib/tiers"
import { bytesToBase64, env } from "./node"

const OPENROUTER_BASE_URL = (
  env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1"
).replace(/\/+$/, "")
const APP_PUBLIC_URL = env.APP_PUBLIC_URL ?? "https://github.com"
const REQUEST_TIMEOUT_MS = Number(env.REQUEST_TIMEOUT_MS ?? 240_000)

const SYSTEM_PROMPT =
  "You are a precise OCR and table-extraction engine. " +
  "Extract ALL tabular and structured data from the provided document or image. " +
  "Return ONLY a single valid JSON object — no markdown, no code fences, no commentary. " +
  'Schema: {"sheets": [{"name": string, "columns": [string, ...], "rows": [[cell, ...], ...]}]}. ' +
  "Rules: create one sheet per distinct table and give each a meaningful name. " +
  "Every row must have the same number of cells as `columns`; use empty strings for blanks. " +
  "Preserve original text and numbers exactly as printed — do not round, reformat, or localize. " +
  'For two-column key/value blocks (label → value pairs such as invoice headers or totals), ALWAYS ' +
  'use the exact header columns ["Field", "Value"] and put every label/value pair as its own data row — ' +
  "never promote an actual label/value pair into the header row. " +
  'If the document contains no tables, return one sheet named "Text" with a single column ' +
  '"content" and one row per line of extracted text.'

const USER_PROMPT =
  "Extract every table from this file into the JSON schema. " +
  "Use the header row as `columns`. Return JSON only."

export class OcrError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.name = "OcrError"
  }
}

export function isKeyConfigured(): boolean {
  return Boolean((env.OPENROUTER_API_KEY ?? "").trim())
}

export interface OcrInput {
  name: string
  type: string
  bytes: Uint8Array
}

export interface OcrOptions {
  tier: string
  modelOverride?: string | null
  pdfEngine?: string
}

export interface OcrResult {
  sheets: Sheet[]
  model: string
  isPdf: boolean
  usage?: Record<string, unknown>
  engineUsed?: string
}

function buildContent(
  file: OcrInput,
  isPdf: boolean,
  base64: string,
): Array<Record<string, unknown>> {
  const content: Array<Record<string, unknown>> = [{ type: "text", text: USER_PROMPT }]
  if (isPdf) {
    content.push({
      type: "file",
      file: { filename: file.name, file_data: `data:application/pdf;base64,${base64}` },
    })
  } else {
    const mime = file.type.startsWith("image/") ? file.type : "image/png"
    content.push({ type: "image_url", image_url: { url: `data:${mime};base64,${base64}` } })
  }
  return content
}

function hasContent(sheets: Sheet[]): boolean {
  return sheets.some((s) => s.rows.length > 0)
}

async function callModel(
  apiKey: string,
  model: string,
  content: Array<Record<string, unknown>>,
  pdfEngine: string | undefined,
): Promise<{ sheets: Sheet[]; usage?: Record<string, unknown> }> {
  const payload: Record<string, unknown> = {
    model,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content },
    ],
  }
  if (pdfEngine) {
    payload.plugins = [{ id: "file-parser", pdf: { engine: pdfEngine } }]
  }

  const body = await callOpenRouter(apiKey, payload)

  let text: unknown = body?.choices?.[0]?.message?.content
  if (Array.isArray(text)) {
    text = text
      .map((part) =>
        part && typeof part === "object" && "text" in part ? String((part as { text: unknown }).text) : "",
      )
      .join("")
  }
  if (typeof text !== "string") {
    throw new OcrError(502, "Unexpected response shape from the model.")
  }
  return { sheets: normalizeSheets(text), usage: body?.usage }
}

export async function runOcr(file: OcrInput, opts: OcrOptions): Promise<OcrResult> {
  const apiKey = (env.OPENROUTER_API_KEY ?? "").trim()
  if (!apiKey) {
    throw new OcrError(500, "OPENROUTER_API_KEY is not configured on the server.")
  }

  const model = modelForTier(opts.tier, opts.modelOverride)
  const isPdf =
    file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")

  // Images go straight to the vision model.
  if (!isPdf) {
    const content = buildContent(file, false, bytesToBase64(file.bytes))
    const r = await callModel(apiKey, model, content, undefined)
    return { sheets: r.sheets, model, isPdf: false, usage: r.usage }
  }

  // PDFs use OpenRouter's file-parser. "auto" tries the free text layer first,
  // then falls back to Mistral OCR for scanned/photographed pages.
  const content = buildContent(file, true, bytesToBase64(file.bytes))
  const requested = (opts.pdfEngine || DEFAULT_PDF_ENGINE).trim()

  if (requested === "auto") {
    const viaText = await callModel(apiKey, model, content, "pdf-text")
    if (hasContent(viaText.sheets)) {
      return { sheets: viaText.sheets, model, isPdf: true, usage: viaText.usage, engineUsed: "pdf-text" }
    }
    const viaOcr = await callModel(apiKey, model, content, "mistral-ocr")
    return { sheets: viaOcr.sheets, model, isPdf: true, usage: viaOcr.usage, engineUsed: "mistral-ocr" }
  }

  const r = await callModel(apiKey, model, content, requested)
  return { sheets: r.sheets, model, isPdf: true, usage: r.usage, engineUsed: requested }
}

async function callOpenRouter(
  apiKey: string,
  payload: Record<string, unknown>,
): Promise<any> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  let resp: Response
  try {
    resp = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": APP_PUBLIC_URL,
        "X-Title": "docsheet",
      },
      body: JSON.stringify(payload),
    })
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new OcrError(504, "The model took too long to respond. Try a smaller file or the Fast tier.")
    }
    throw new OcrError(502, `Failed to reach OpenRouter: ${(err as Error).message}`)
  } finally {
    clearTimeout(timer)
  }

  if (!resp.ok) {
    let detail = await resp.text()
    try {
      const parsed = JSON.parse(detail)
      detail = parsed?.error?.message ?? parsed?.error ?? detail
    } catch {
      /* keep raw text */
    }
    // Some models reject response_format — retry once without it.
    if (String(detail).toLowerCase().includes("response_format") && "response_format" in payload) {
      const rest = { ...payload }
      delete rest.response_format
      return callOpenRouter(apiKey, rest)
    }
    throw new OcrError(resp.status, `OpenRouter error: ${detail}`)
  }

  return resp.json()
}

// ---- Parsing helpers -------------------------------------------------------

function cellToStr(value: unknown): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE"
  if (typeof value === "number") return String(value)
  if (typeof value === "object") return JSON.stringify(value)
  return String(value)
}

function extractJson(text: string): any {
  let t = text.trim()
  if (t.startsWith("```")) {
    t = t.replace(/^```[a-zA-Z0-9]*\n?/, "").replace(/\n?```$/, "").trim()
  }
  try {
    return JSON.parse(t)
  } catch {
    const start = t.indexOf("{")
    const end = t.lastIndexOf("}")
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(t.slice(start, end + 1))
      } catch {
        /* fall through */
      }
    }
  }
  return null
}

export function normalizeSheets(text: string): Sheet[] {
  const raw = extractJson(text)
  const sheetsIn: unknown = raw && typeof raw === "object" ? raw.sheets : null

  if (!Array.isArray(sheetsIn) || sheetsIn.length === 0) {
    const lines = text.split("\n").filter((l) => l.trim())
    return [{ name: "Text", columns: ["content"], rows: lines.map((l) => [l]) }]
  }

  const sheets: Sheet[] = []
  sheetsIn.forEach((s, i) => {
    if (!s || typeof s !== "object") return
    const sheet = s as Record<string, unknown>
    const name = String(sheet.name ?? `Sheet${i + 1}`)
    const columns = Array.isArray(sheet.columns) ? sheet.columns.map(cellToStr) : []

    const rows: string[][] = []
    const rowsIn = Array.isArray(sheet.rows) ? sheet.rows : []
    for (const r of rowsIn) {
      if (Array.isArray(r)) {
        rows.push(r.map(cellToStr))
      } else if (r && typeof r === "object") {
        const obj = r as Record<string, unknown>
        rows.push(columns.length ? columns.map((c) => cellToStr(obj[c] ?? "")) : Object.values(obj).map(cellToStr))
      } else {
        rows.push([cellToStr(r)])
      }
    }

    const width = Math.max(columns.length, ...rows.map((r) => r.length), 0)
    for (const r of rows) while (r.length < width) r.push("")
    while (columns.length < width) columns.push("")

    sheets.push({ name, columns, rows })
  })

  return sheets.length ? sheets : [{ name: "Text", columns: ["content"], rows: [] }]
}
