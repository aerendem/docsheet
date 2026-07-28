import { createFileRoute } from "@tanstack/react-router"
import { detectBarcodeColumn } from "../../lib/barcode"
import {
  type DecimalMark,
  columnPlaces,
  inferColumnKinds,
  inferDecimalMarks,
  parseDateCell,
  parseNumber,
} from "../../lib/cell-value"
import type { Sheet } from "../../lib/tiers"
import { isAuthed } from "../../server/auth"
import { loadWorkbook } from "../../server/node"

const DATE_FORMAT = "dd.mm.yyyy"

/**
 * Match the format to how the document printed it: 340,50 keeps two places.
 *
 * No thousands separator, deliberately. Excel puts what a cell *displays* on
 * the clipboard, and these sheets are made to be pasted into a stock program:
 * "2.777,25" read by something that takes the dot for the decimal point is
 * 2,78 — a wrong cost, silently — where "2777,25" is either read right or
 * refused outright.
 */
function numberFormatFor(sheet: Sheet, columnIndex: number, mark?: DecimalMark): string {
  const places = columnPlaces(sheet, columnIndex, mark)
  return places > 0 ? `0.${"0".repeat(places)}` : "0"
}

function sanitizeFilename(name: string): string {
  const stem = (name.split(/[/\\]/).pop() ?? name).replace(/\.[^.]+$/, "")
  return stem.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "export"
}

function safeSheetTitle(name: string, used: Set<string>): string {
  let title = (name || "Sheet").replace(/[[\]*?/\\:]/g, " ").trim().slice(0, 31) || "Sheet"
  const base = title
  let n = 1
  while (used.has(title.toLowerCase())) {
    const suffix = ` (${n++})`
    title = base.slice(0, 31 - suffix.length) + suffix
  }
  used.add(title.toLowerCase())
  return title
}

export const Route = createFileRoute("/api/xlsx")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await isAuthed(request))) {
          return Response.json({ error: "Unauthorized." }, { status: 401 })
        }
        const body = (await request.json().catch(() => null)) as
          | { sheets?: Sheet[]; filename?: string }
          | null
        const sheets = Array.isArray(body?.sheets) ? body.sheets : []
        const base = sanitizeFilename(body?.filename ?? "export")

        const Workbook = await loadWorkbook()
        const wb = new Workbook()
        wb.creator = "docsheet"
        const used = new Set<string>()

        if (sheets.length === 0) wb.addWorksheet("Sheet1")

        for (const [i, sheet] of sheets.entries()) {
          const ws = wb.addWorksheet(safeSheetTitle(sheet.name || `Sheet${i + 1}`, used))
          const columns = Array.isArray(sheet.columns) ? sheet.columns : []
          const widths = columns.map((c) => String(c).length)

          if (columns.length) {
            const header = ws.addRow(columns)
            header.font = { bold: true }
            header.eachCell((cell) => {
              cell.fill = {
                type: "pattern",
                pattern: "solid",
                fgColor: { argb: "FFF2F2F4" },
              }
            })
            ws.views = [{ state: "frozen", ySplit: 1 }]
          }

          // Write figures and dates as real values, not text. Otherwise every
          // cell arrives as a string and SUM over a price column returns 0.
          const kinds = inferColumnKinds(sheet)
          // Each column is read under the convention its own figures agree on,
          // so a cost printed "711,5625" is 711.5625 and not a failed parse.
          const marks = inferDecimalMarks(sheet)
          // A barcode is an identifier, not a figure. Written as a number it
          // loses any leading zero and Excel renders it 8.697.742.122.934.
          const barcodeAt = detectBarcodeColumn(sheet)
          if (barcodeAt !== -1) kinds[barcodeAt] = "text"
          const formats = kinds.map((kind, ci) =>
            kind === "number" ? numberFormatFor(sheet, ci, marks[ci]) : DATE_FORMAT,
          )

          for (const row of sheet.rows ?? []) {
            const typed = row.map((val, ci) => {
              const text = String(val ?? "")
              if (!text.trim()) return null
              if (kinds[ci] === "number") return parseNumber(text, marks[ci]) ?? text
              if (kinds[ci] === "date") return parseDateCell(text) ?? text
              return text
            })

            const added = ws.addRow(typed)
            added.eachCell((cell, colNumber) => {
              const kind = kinds[colNumber - 1]
              if (kind === "number" && typeof cell.value === "number") {
                cell.numFmt = formats[colNumber - 1]
              } else if (kind === "date" && cell.value instanceof Date) {
                cell.numFmt = DATE_FORMAT
              }
            })

            row.forEach((val, idx) => {
              const len = String(val ?? "").length
              widths[idx] = Math.max(widths[idx] ?? 0, len)
            })
          }

          widths.forEach((w, idx) => {
            ws.getColumn(idx + 1).width = Math.min(Math.max(w + 2, 8), 60)
          })
        }

        const buffer = await wb.xlsx.writeBuffer()
        return new Response(buffer, {
          headers: {
            "Content-Type":
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "Content-Disposition": `attachment; filename="${base}.xlsx"`,
            "Cache-Control": "no-store",
          },
        })
      },
    },
  },
})
