import { createFileRoute } from "@tanstack/react-router"
import { DEFAULT_PDF_ENGINE, DEFAULT_TIER } from "../../lib/tiers"
import { isAuthed } from "../../server/auth"
import { env } from "../../server/node"
import { OcrError, runOcr } from "../../server/ocr"

const MAX_UPLOAD_MB = Number(env.MAX_UPLOAD_MB ?? 25)

export const Route = createFileRoute("/api/extract")({
  server: {
    handlers: {
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

          const tier = String(form.get("tier") ?? DEFAULT_TIER)
          const modelOverride = form.get("model") ? String(form.get("model")) : null
          const pdfEngine = String(form.get("pdfEngine") ?? DEFAULT_PDF_ENGINE)
          const bytes = new Uint8Array(await file.arrayBuffer())

          const result = await runOcr(
            { name: file.name || "upload", type: file.type || "", bytes },
            { tier, modelOverride, pdfEngine },
          )

          return Response.json({ filename: file.name || "upload", ...result })
        } catch (err) {
          const status = err instanceof OcrError ? err.status : 500
          const message = err instanceof Error ? err.message : "Extraction failed."
          return Response.json({ error: message }, { status })
        }
      },
    },
  },
})
