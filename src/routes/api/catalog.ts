import { createFileRoute } from "@tanstack/react-router"
import { isAuthed } from "../../server/auth"
import { CATALOG_SOURCES, CatalogError, shopCatalog } from "../../server/catalog"

export const Route = createFileRoute("/api/catalog")({
  server: {
    handlers: {
      // GET /api/catalog                      → the sources this build knows
      // GET /api/catalog?source=naturenurture → every barcode → name it lists
      GET: async ({ request }) => {
        if (!(await isAuthed(request))) {
          return Response.json({ error: "Unauthorized." }, { status: 401 })
        }
        const url = new URL(request.url)
        const source = url.searchParams.get("source")
        if (!source) return Response.json({ sources: CATALOG_SOURCES })

        try {
          const result = await shopCatalog(source, url.searchParams.get("refresh") === "1")
          return Response.json({
            source: result.source,
            fetchedAt: new Date(result.fetchedAt).toISOString(),
            count: result.entries.length,
            entries: result.entries,
          })
        } catch (err) {
          const status = err instanceof CatalogError ? err.status : 500
          const message = err instanceof Error ? err.message : "Catalog fetch failed."
          return Response.json({ error: message }, { status })
        }
      },
    },
  },
})
