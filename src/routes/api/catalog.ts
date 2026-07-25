import { createFileRoute } from "@tanstack/react-router"
import { isAuthed } from "../../server/auth"
import { CatalogError, SHOP_SOURCES, resolveShop, shopCatalog } from "../../server/catalog"
import { REGISTRY_SOURCE, registryStatus } from "../../server/registry"

const OPEN_SOURCES = [
  {
    id: "openfacts",
    label: "Open Food Facts / Open Beauty Facts",
    site: "https://world.openfoodfacts.org",
    kind: "open" as const,
  },
]

function fail(err: unknown) {
  const status = err instanceof CatalogError ? err.status : 500
  const message = err instanceof Error ? err.message : "Catalog fetch failed."
  return Response.json({ error: message }, { status })
}

export const Route = createFileRoute("/api/catalog")({
  server: {
    handlers: {
      // GET /api/catalog                      → the sources this build knows
      // GET /api/catalog?source=naturenurture → every barcode → name it lists
      // GET /api/catalog?source=titck         → how big the registry index is
      GET: async ({ request }) => {
        if (!(await isAuthed(request))) {
          return Response.json({ error: "Unauthorized." }, { status: 401 })
        }
        const url = new URL(request.url)
        const source = url.searchParams.get("source")
        if (!source) {
          return Response.json({
            sources: [...SHOP_SOURCES, REGISTRY_SOURCE, ...OPEN_SOURCES],
          })
        }

        try {
          if (source === REGISTRY_SOURCE.id) {
            return Response.json({ source: REGISTRY_SOURCE, ...(await registryStatus()) })
          }
          const shop = resolveShop(source)
          const result = await shopCatalog(shop, url.searchParams.get("refresh") === "1")
          return Response.json({
            source: shop,
            fetchedAt: new Date(result.fetchedAt).toISOString(),
            count: result.entries.length,
            entries: result.entries,
          })
        } catch (err) {
          return fail(err)
        }
      },

      // POST /api/catalog { url } → read any other shop's published products.
      // Same crawl as a preset; the URL is checked to be a public https site
      // before the server fetches anything.
      POST: async ({ request }) => {
        if (!(await isAuthed(request))) {
          return Response.json({ error: "Unauthorized." }, { status: 401 })
        }
        const body = (await request.json().catch(() => null)) as { url?: unknown } | null
        if (typeof body?.url !== "string" || !body.url.trim()) {
          return Response.json({ error: "No shop URL supplied." }, { status: 400 })
        }

        try {
          const shop = resolveShop(body.url.trim())
          const result = await shopCatalog(shop)
          return Response.json({
            source: shop,
            fetchedAt: new Date(result.fetchedAt).toISOString(),
            count: result.entries.length,
            entries: result.entries,
          })
        } catch (err) {
          return fail(err)
        }
      },
    },
  },
})
