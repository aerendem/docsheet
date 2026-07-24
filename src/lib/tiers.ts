// Shared, dependency-free data + types used by both the browser UI and the
// server routes. No secrets and no env access here so it is safe to bundle to
// the client.

export type QualityTier = "fast" | "balanced" | "best"

export interface TierInfo {
  id: QualityTier
  label: string
  blurb: string
  /** OpenRouter model id — verified live against /api/v1/models (July 2026). */
  model: string
  priceHint: string
}

// The server maps tier -> model at request time; the client only renders the
// labels. Swap these ids whenever OpenRouter ships something newer.
export const TIERS: TierInfo[] = [
  {
    id: "fast",
    label: "Fast",
    blurb: "Quick & cheap — great for clean digital docs",
    model: "google/gemini-3.5-flash-lite",
    priceHint: "≈ $0.30 / 1M input tokens",
  },
  {
    id: "balanced",
    label: "Balanced",
    blurb: "Best accuracy-for-price — the sweet spot",
    model: "google/gemini-3.6-flash",
    priceHint: "≈ $1.50 / 1M input tokens",
  },
  {
    id: "best",
    label: "Best",
    blurb: "Highest accuracy — messy scans & dense tables",
    model: "openai/gpt-5.6-terra-pro",
    priceHint: "≈ $2.50 / 1M input tokens",
  },
]

export const DEFAULT_TIER: QualityTier = "balanced"

export interface PdfEngineInfo {
  id: string
  label: string
}

// OpenRouter's built-in PDF file-parser engines (used only for PDF uploads).
export const PDF_ENGINES: PdfEngineInfo[] = [
  { id: "auto", label: "Auto — free text layer, OCR fallback for scans (recommended)" },
  { id: "mistral-ocr", label: "Mistral OCR — best for scans/photos ($2 / 1k pages)" },
  { id: "native", label: "Model native — the model reads the PDF itself" },
  { id: "pdf-text", label: "PDF text — free, digital (text) PDFs only" },
]

export const DEFAULT_PDF_ENGINE = "auto"

export function modelForTier(tier: string, override?: string | null): string {
  const cleaned = override?.trim()
  if (cleaned) return cleaned
  const found = TIERS.find((t) => t.id === tier)
  const fallback = TIERS.find((t) => t.id === DEFAULT_TIER)
  return (found ?? fallback ?? TIERS[0]).model
}

export interface Sheet {
  name: string
  columns: string[]
  rows: string[][]
}

export interface ExtractResult {
  filename: string
  model: string
  isPdf: boolean
  sheets: Sheet[]
  usage?: Record<string, unknown>
  engineUsed?: string
}

export interface SessionInfo {
  authRequired: boolean
  authed: boolean
  keyConfigured: boolean
}
