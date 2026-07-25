import { createFileRoute } from "@tanstack/react-router"
import type { CatalogEntry } from "../../lib/barcode"
import { isAuthed } from "../../server/auth"
import { CatalogError, lookupOpenFacts, normalizeLookupInput } from "../../server/catalog"
import { lookupRegistry } from "../../server/registry"

export const Route = createFileRoute("/api/barcodes")({
  server: {
    handlers: {
      // POST /api/barcodes { barcodes: [...], sources?: ["titck", "openfacts"] }
      // → { entries: [{ barcode, name, brand, note, source }] } for the codes a
      //   per-barcode source knows. Unknown codes are simply missing.
      //
      // The registry answers from an in-memory index, so it is asked first and
      // only what it doesn't know costs a request to the open databases.
      POST: async ({ request }) => {
        if (!(await isAuthed(request))) {
          return Response.json({ error: "Unauthorized." }, { status: 401 })
        }
        const body = (await request.json().catch(() => null)) as
          | { barcodes?: unknown; sources?: unknown }
          | null
        const barcodes = Array.isArray(body?.barcodes)
          ? body.barcodes.filter((b): b is string => typeof b === "string")
          : []
        if (!barcodes.length) {
          return Response.json({ error: "No barcodes supplied." }, { status: 400 })
        }
        const wanted = Array.isArray(body?.sources)
          ? new Set(body.sources.filter((s): s is string => typeof s === "string"))
          : null
        const uses = (id: string) => !wanted || wanted.has(id)

        try {
          const codes = normalizeLookupInput(barcodes)
          const entries: CatalogEntry[] = []
          const named = new Set<string>()

          if (uses("titck")) {
            // A registry failure (the weekly file moved, say) shouldn't take
            // the open databases down with it.
            try {
              for (const entry of await lookupRegistry(codes)) {
                entries.push(entry)
                named.add(entry.barcode)
              }
            } catch (err) {
              if (!(err instanceof CatalogError)) throw err
            }
          }

          if (uses("openfacts")) {
            entries.push(...(await lookupOpenFacts(codes.filter((c) => !named.has(c)))))
          }

          return Response.json({ entries })
        } catch (err) {
          const status = err instanceof CatalogError ? err.status : 500
          const message = err instanceof Error ? err.message : "Lookup failed."
          return Response.json({ error: message }, { status })
        }
      },
    },
  },
})
