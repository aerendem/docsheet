import { createFileRoute } from "@tanstack/react-router"
import { isAuthed } from "../../server/auth"
import { env } from "../../server/node"
import { isSpreadsheetName, readSpreadsheet, SheetError } from "../../server/sheets"

const MAX_UPLOAD_MB = Number(env.MAX_UPLOAD_MB ?? 25)

export const Route = createFileRoute("/api/sheet")({
  server: {
    handlers: {
      // POST /api/sheet — multipart with `file` (.xlsx/.xlsm/.csv/.tsv)
      // → { filename, sheets } — the same shape /api/extract returns, without
      //   the model call. A spreadsheet you already have doesn't need OCR to
      //   run through the matcher, the totals check or the exports.
      POST: async ({ request }) => {
        try {
          if (!(await isAuthed(request))) {
            return Response.json({ error: "Unauthorized." }, { status: 401 })
          }
          const form = await request.formData()
          const file = form.get("file")
          if (!file || typeof file === "string") {
            return Response.json({ error: "No file uploaded." }, { status: 400 })
          }
          if (file.size === 0) {
            return Response.json({ error: "The uploaded file is empty." }, { status: 400 })
          }
          if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
            return Response.json(
              { error: `File too large (max ${MAX_UPLOAD_MB} MB).` },
              { status: 413 },
            )
          }
          const name = file.name || "upload.csv"
          if (!isSpreadsheetName(name)) {
            return Response.json(
              { error: "That isn't a spreadsheet — upload .xlsx, .xlsm, .csv or .tsv." },
              { status: 415 },
            )
          }

          const { sheets, repairedBarcodes } = await readSpreadsheet(
            name,
            await file.arrayBuffer(),
          )
          return Response.json({ filename: name, sheets, repairedBarcodes, isSpreadsheet: true })
        } catch (err) {
          const status = err instanceof SheetError ? err.status : 500
          const message = err instanceof Error ? err.message : "Could not read that file."
          return Response.json({ error: message }, { status })
        }
      },
    },
  },
})
