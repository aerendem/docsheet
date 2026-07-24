import { createFileRoute } from "@tanstack/react-router"
import { Workbook } from "exceljs"
import type { Sheet } from "../../lib/tiers"
import { isAuthed } from "../../server/auth"

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
                fgColor: { argb: "FFEFF3F0" },
              }
            })
            ws.views = [{ state: "frozen", ySplit: 1 }]
          }

          for (const row of sheet.rows ?? []) {
            ws.addRow(row)
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
