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
| **Spreadsheet** (XLSX/XLSM/CSV/TSV) | Read on the server (`src/server/sheets.ts`) — no model, no cost. Use this when you already have the table and just want the barcode matcher, the totals check, or a clean export. |

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
`UPC` — with or without a Turkish suffix, so `Barkodu` counts) or, when it hasn't
got one, by the shape of its values. Codes are matched across UPC-A / EAN-13 /
GTIN-14 forms, so a leading zero either way still hits.

### Misread digits

Barcode digits are printed small and condensed, so OCR hands back `B` for `8`,
`O` for `0`, `I` for `1`. Dropping those letters would shorten the code by
exactly the digits that were misread — leaving a plausible code that names the
wrong product, or nothing at all — so each letter is read back as the digit it
was printed as.

A cell is only **rewritten** when the repaired code satisfies the GTIN check
digit, which proves the letters were digits. Anything weaker is looked up
repaired but left in the sheet exactly as it was read, and the panel says how
many cells were corrected. Uploaded spreadsheets get the same treatment: a sheet
that was itself typed up from a scan carries the same misreads.

### Sources

| Source | Sector | Where it comes from |
|--------|--------|---------------------|
| **Your list** | any | Barcode, name and shelf price, pasted or imported as CSV/TSV. Remembered in the browser, and beats every other source. |
| **TİTCK** | pharmacy | Every licensed medicine in Turkey — ~18,000 products with name, marketing-authorisation holder and ATC code — from the SKRS e-reçete list [TİTCK republishes weekly](https://www.titck.gov.tr/dinamikmodul/43). No prices: see below. |
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
relies on. The code is read wherever the platform puts it — at the top level, in
the `@graph` Yoast wraps a page in, or under `mainEntity` — and from whichever
of `gtin13` / `gtin` / `ean` / `sku` actually holds a code, since a shop that
prints an empty `gtin13` beside a filled `gtin` is common. A shop that puts an
internal stock code there instead is ignored rather than trusted: only real
GTIN-length codes are indexed.

The server only ever fetches public `https` addresses, and checks **every
redirect hop**, not just the URL you paste — otherwise a shop could answer with
a redirect and have the server read something inside the network it sits in.
Responses are capped, so a hostile or broken site can't exhaust its memory.

**Every source is on by default** — the common case is wanting names, not
picking suppliers — and switching one off is what sticks, per browser. Each is
individually switchable because a name from a crowd-sourced database isn't the
same claim as one from your own list; they merge into a single catalog in the
priority order above, so the source you trust most wins any disagreement. A
field that source doesn't publish is filled in from the next one down rather
than lost — your own list can name a product the shop prices.

Nothing is fetched until a sheet with barcodes turns up: converting a PDF that
has no barcode column costs no crawls, no registry download and no lookups. A
source that is switched off stops contributing immediately, including answers
already fetched in that session.

### Bring your own spreadsheet

The matcher works on the `{columns, rows}` shape, not on anything the model
produced, so it doesn't need OCR at all. Drop an `.xlsx` or `.csv` into the same
dropzone and it goes straight to the matcher: the quality tiers disappear,
nothing is sent to OpenRouter, and the file costs nothing to read. Barcodes
stored as numbers survive (no `8.69774E+12`), dates come back as `dd.mm.yyyy`,
and a Turkish semicolon-delimited CSV with decimal commas is detected as such.

Mixed batches work too — a scanned invoice and last month's export stack into
one combined sheet, matched together. A figure read out of a workbook keeps the
places its number format declares, so a price drawn as `129,50` doesn't come
back as `129.5` and lose the column its type.

### Shelf price

A barcode and a name don't make a sheet you can use: a scan list arrives with no
price at all, and a price typed in by hand for every line is the work the
conversion was meant to save. So **Shelf price** is on by default, and the
column appears whenever a source published one — a price nothing could supply
adds no empty column to be told to ignore.

Where it comes from depends on the product:

- **Shops** publish it. It is read from the product page's `schema.org` offer,
  including an offer list or an `AggregateOffer`, which is where the platforms
  that don't put a plain `price` at the top level keep it.
- **Medicines have no public price feed.** The list TİTCK republishes weekly
  carries the barcode, the name, the licence holder and the ATC code — and no
  price column at all; the detailed price list is behind a login. So the panel
  says so rather than leaving an empty column looking like a failed match.
- **Your own list is the answer for both.** Paste `Barkod;Ürün Adı;Fiyat` — a
  heading row is read if there is one, and without one the code is the cell that
  looks like a code, the name is the longest cell that isn't a figure, and only
  a figure printed with a decimal is taken as a price (a round `2` beside a
  product is a quantity far more often than a price, and an invented shelf price
  is worse than none). It is remembered per browser, so a price list exported
  from your stock program is pasted once and prices every sheet after it.

However the price is printed at the source — `349`, `"349.00"`, `1.299,90 TL` —
one figure is stored, and the sheet prints it the way the language it is being
read in expects: `349,00` under **TR**, where Turkish Excel reads `349.00` as
text and a stock program importing text reads no price at all.

### Where the names land

Names go into **a new column** (heading of your choice) or **fill the blanks**
in the item column the document already has — an existing name is never
overwritten. **Also add** spills the rest of what a source knows into its own
column: shelf price, manufacturer, ATC code / category.

The catalog fills each document's own table *before* the documents are stacked,
so a matched name and its price are ordinary columns in **Your layout** —
reordered, renamed and switched off like any other, and remembered. Appended
after the stacking they could only ever come out last, which is the wrong place
for whatever program the sheet is pasted into.

The matcher never edits the extraction itself: switch it off and the sheets go
back to exactly what the model read.

## Your layout

Whatever the supplier called a column, the **Your layout** sheet (**Combined**,
once there is more than one document) gives it one identity: `Birim Fiyatı`,
`Birim Fiyat` and `Unit price` are the same column, and Turkish possessive and
plural endings — `Miktarı`, `Tutarı`, `Barkodu` — read as the noun. Two suppliers
spelling a heading differently stack into one column instead of two half-empty
ones.

Under **Columns** you rename, reorder and switch off columns. The layout is
remembered per browser, so the order the program you paste into expects is set
up once rather than redone by hand on every invoice — and it applies to a single
invoice, not just a batch.

## Typed cells

Figures and dates are written to `.xlsx` as real numbers and real dates, not
text — a stock program importing a text price reads no price at all. A column
takes a type when most of its values agree on one, so a single `9,90 TL/AD` in a
price column no longer leaves every price beside it as text; that one cell keeps
its own text. Codes are never figures: a barcode column, and any column holding a
zero-padded value, stays text so its leading zeros survive.

Typing a column would otherwise edit what the document said: `%10` becomes `10`
and `82,00 TL` becomes `82`. So a unit every figure in the column shares is
carried into the **number format** instead — the cell holds `10` and still reads
`%10`, holds `82` and still reads `82,00 TL`. One cell disagreeing means the
column has no shared unit and none is applied.

A cell that opens with `=`, `+` or `@` is marked as text on the way into CSV,
because Excel evaluates such a field on import and a description reading
`=DEVİR 2026` would arrive as `#NAME?`. A leading minus is left alone — that one
really is a negative figure — and reading a CSV back drops the mark again.

CSV follows the language it is downloaded in — semicolon-delimited under **TR**,
because Turkish Excel splits on semicolons and a comma-separated file would open
as one column per row.

## Copy

**Copy** puts the whole sheet on the clipboard, ready to paste into a spreadsheet
that is already open. Selecting the preview by hand is what makes a paste land a
column out — the drag starts mid-cell, the table scrolls under it, and only the
rows on screen come along. This takes every row, tab-separated for a plain paste
and as a real table for Excel, with the code columns marked as text so a 13-digit
barcode stays a barcode instead of arriving as `8,69774E+12`.

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
| `APP_PASSWORD` | | — | Set it to put the app behind a shared password. Guessing is limited to 10 tries per address per 5 minutes |
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

- `POST /api/extract` — `multipart/form-data` with `file`, `tier`, optional `model`, `pdfEngine` → `{ sheets, model, repairedBarcodes, ... }`
- `POST /api/sheet` — `multipart/form-data` with `file` (.xlsx/.xlsm/.csv/.tsv) → `{ sheets, repairedBarcodes }`, no model call
- `POST /api/xlsx` — JSON `{ sheets, filename }` → `.xlsx` download
- `GET  /api/catalog` — the barcode sources this build knows
- `GET  /api/catalog?source=procsin` — `{ count, entries: [{ barcode, name, brand, price }] }` (add `&refresh=1` to bypass the cache)
- `GET  /api/catalog?source=titck` — `{ count, file }` for the drug index
- `POST /api/catalog` — JSON `{ url }` → the same shape for any other public https shop
- `POST /api/barcodes` — JSON `{ barcodes: [...], sources?: ["titck","openfacts"] }` → `{ entries }`
- `GET  /api/health` — `{ ok, keyConfigured }`

## Tech

TanStack Start · React 19 · Vite 8 · Nitro 3 · Tailwind v4 · Biome · ExcelJS · OpenRouter.
