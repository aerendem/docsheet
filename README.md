# docsheet

Turn any **PDF or image into an Excel / CSV spreadsheet** using the best OCR
models — via [OpenRouter](https://openrouter.ai). Drop a file, pick a quality
level, preview the extracted tables, and download as `.xlsx`, `.csv`, or JSON.

Built with **TanStack Start** (React 19 + Vite + Nitro) and deploys free on
**Railway**.

<img alt="docsheet" src="https://img.shields.io/badge/TanStack_Start-React-0ea5e9"> <img alt="Railway" src="https://img.shields.io/badge/deploy-Railway-blueviolet">

---

## How it works

| Input | What happens |
|-------|--------------|
| **Image** (PNG/JPG/WEBP/TIFF/BMP) | Sent to a vision model as an image. |
| **PDF** | Sent through OpenRouter's built-in PDF **file-parser** (Mistral OCR by default) so even scanned pages work. |

The model is asked to return strict JSON describing one sheet per table. The
server (`src/server/ocr.ts`) normalizes that into rows/columns, the browser
previews it, and downloads are generated as real `.xlsx` (via ExcelJS), CSV, or
JSON.

**Your files are streamed straight to OpenRouter and never stored on the server.**

## Barcode → name

Distributor invoices often print a barcode, a quantity and a price — but no
readable product name. The **Barcode → name** panel fills that column in by
matching the barcode column against a catalog.

The barcode column is found by its heading (`Barkod`, `Barcode`, `GTIN`, `EAN`,
`UPC`) or, when it hasn't got one, by the shape of its values. Codes are matched
across UPC-A / EAN-13 / GTIN-14 forms, so a leading zero either way still hits.

### Sources

| Source | Sector | Where it comes from |
|--------|--------|---------------------|
| **Your list** | any | Barcode + name pairs you paste or import as CSV/TSV. Remembered in the browser, and beats every other source. |
| **TİTCK** | pharmacy | Every licensed medicine in Turkey — ~18,000 products with name, marketing-authorisation holder and ATC code — from the SKRS e-reçete list [TİTCK republishes weekly](https://www.titck.gov.tr/dinamikmodul/43). |
| **Nature & Nurture** | beauty | Every product published on [shop.naturenurture.com.tr](https://shop.naturenurture.com.tr). |
| **Procsin** | beauty | Every product published on [procsin.com](https://www.procsin.com). |
| **Any other shop** | any | Paste a shop URL and the server reads that shop's own sitemap and `schema.org` product data. Public https sites only. |
| **Open databases** | any | [Open Food Facts](https://world.openfoodfacts.org) and [Open Beauty Facts](https://world.openbeautyfacts.org) — free, worldwide, no key. |

Sources come in two shapes. A **shop** is small enough to download whole and
match in the browser. A **registry** (TİTCK) and the open databases are not, so
they stay on the server and answer per barcode — only for codes nothing else
could name, and never for the same unknown code twice.

Most Turkish shop platforms (Ticimax, T-Soft, IdeaSoft, WooCommerce) publish
each product's EAN in `schema.org` JSON-LD, which is what "any other shop"
relies on. A shop that puts an internal stock code there instead is ignored
rather than trusted: only real GTIN-length codes are indexed.

**Use all sources** switches everything on at once — the common case — and each
source stays individually switchable, because a name from a crowd-sourced
database isn't the same claim as one from your own list. They merge into a
single catalog in that priority order, so the source you trust most wins any
disagreement.

### Where the names land

Names go into **a new column** (heading of your choice) or **fill the blanks**
in the item column the document already has — an existing name is never
overwritten. **Also add** spills the rest of what a source knows into its own
column: manufacturer, list price, ATC code / category.

The matcher never edits the extraction itself: switch it off and the sheets go
back to exactly what the model read.

## Quality tiers

The UI exposes three tiers instead of a raw model list. They map to models in
[`src/lib/tiers.ts`](src/lib/tiers.ts) — edit that file to swap in newer models.

| Tier | Model (default) | Good for |
|------|-----------------|----------|
| **Fast** | `google/gemini-3.5-flash-lite` | Clean digital docs, lowest cost |
| **Balanced** ⭐ | `google/gemini-3.6-flash` | Best accuracy-for-price (default) |
| **Best** | `openai/gpt-5.6-terra-pro` | Messy scans & dense tables |

You can also paste any OpenRouter model id under **Advanced options**, and choose
the PDF engine (`mistral-ocr`, `native`, or free `pdf-text`).

## Local development

Requires **Node 22+**.

```bash
npm install
cp .env.example .env      # then paste your OPENROUTER_API_KEY
npm run dev               # http://localhost:3000
```

Other scripts:

```bash
npm run build        # production build → .output/
npm run start        # run the built server (node .output/server/index.mjs)
npm run type-check   # tsc --noEmit
```

## Environment variables

| Variable | Required | Default | Notes |
|----------|----------|---------|-------|
| `OPENROUTER_API_KEY` | ✅ | — | From https://openrouter.ai/keys |
| `MAX_UPLOAD_MB` | | `25` | Reject larger uploads |
| `REQUEST_TIMEOUT_MS` | | `240000` | OpenRouter request timeout |
| `OPENROUTER_BASE_URL` | | `https://openrouter.ai/api/v1` | |
| `APP_PUBLIC_URL` | | `https://github.com` | Sent as `HTTP-Referer` to OpenRouter |
| `APP_PASSWORD` | | — | Set it to put the app behind a shared password |
| `CATALOG_TTL_MINUTES` | | `720` | How long a fetched shop catalog is cached |
| `CATALOG_MAX_PRODUCTS` | | `500` | Cap on product pages read per shop crawl |
| `CATALOG_TIMEOUT_MS` | | `20000` | Per-request timeout for catalog fetches |
| `REGISTRY_TTL_MINUTES` | | `1440` | How long the TİTCK index is kept (it is republished weekly) |
| `TITCK_LIST_URL` | | `https://www.titck.gov.tr/dinamikmodul/43` | Page the newest drug list is read from |
| `NATURENURTURE_URL` | | `https://shop.naturenurture.com.tr` | Preset shop, re-pointable |
| `PROCSIN_URL` | | `https://www.procsin.com` | Preset shop, re-pointable |
| `PORT` | | `3000` | Set automatically by Railway |

## Deploy to Railway (free)

1. Push this repo to GitHub (already done if you're reading this there).
2. On [railway.com](https://railway.com) → **New Project → Deploy from GitHub repo** → pick `docsheet`.
3. Railway reads [`railway.json`](railway.json) — **Railpack** builder — building
   with `npm run build` and starting with `npm run start`, health-checking `/api/health`.
4. In the service **Variables** tab, add `OPENROUTER_API_KEY`.
5. **Settings → Networking → Generate Domain** to get a public URL. Done.

> Uses the **Railpack** builder. Node 22+ is pinned via `.node-version`, `.nvmrc`, and `engines`.

## API

The app also exposes plain HTTP endpoints (see `src/routes/api/`):

- `POST /api/extract` — `multipart/form-data` with `file`, `tier`, optional `model`, `pdfEngine` → `{ sheets, model, ... }`
- `POST /api/xlsx` — JSON `{ sheets, filename }` → `.xlsx` download
- `GET  /api/catalog` — the barcode sources this build knows
- `GET  /api/catalog?source=procsin` — `{ count, entries: [{ barcode, name, brand, price }] }` (add `&refresh=1` to bypass the cache)
- `GET  /api/catalog?source=titck` — `{ count, file }` for the drug index
- `POST /api/catalog` — JSON `{ url }` → the same shape for any other public https shop
- `POST /api/barcodes` — JSON `{ barcodes: [...], sources?: ["titck","openfacts"] }` → `{ entries }`
- `GET  /api/health` — `{ ok, keyConfigured }`

## Tech

TanStack Start · React 19 · Vite 8 · Nitro 3 · Tailwind v4 · Biome · ExcelJS · OpenRouter.
