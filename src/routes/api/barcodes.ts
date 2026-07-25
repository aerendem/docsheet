import { createFileRoute } from "@tanstack/react-router"
import { isAuthed } from "../../server/auth"
import { CatalogError, lookupOpenFacts } from "../../server/catalog"

export const Route = createFileRoute("/api/barcodes")({
  server: {
    handlers: {
      // POST /api/barcodes { barcodes: ["8697742122934", ...] }
      // → { entries: [{ barcode, name, source }] } for the ones a public GTIN
      //   database knows. Unknown codes are simply missing from the reply.
      POST: async ({ request }) => {
        if (!(await isAuthed(request))) {
          return Response.json({ error: "Unauthorized." }, { status: 401 })
        }
        const body = (await request.json().catch(() => null)) as { barcodes?: unknown } | null
        const barcodes = Array.isArray(body?.barcodes)
          ? body.barcodes.filter((b): b is string => typeof b === "string")
          : []
        if (!barcodes.length) {
          return Response.json({ error: "No barcodes supplied." }, { status: 400 })
        }

        try {
          return Response.json({ entries: await lookupOpenFacts(barcodes) })
        } catch (err) {
          const status = err instanceof CatalogError ? err.status : 500
          const message = err instanceof Error ? err.message : "Lookup failed."
          return Response.json({ error: message }, { status })
        }
      },
    },
  },
})
