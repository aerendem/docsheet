// Where a matched name is put. Getting the column wrong is worse than finding
// no name: it writes over a column the document filled in itself.

import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { detectNameColumn, fillNames } from "./barcode.ts"
import type { Catalog } from "./barcode.ts"
import type { Sheet } from "./tiers.ts"

const CATALOG: Catalog = new Map([
  ["8690000000001", { barcode: "8690000000001", name: "Aspirin 500 mg 20 Tablet", source: "titck" }],
  ["8690000000002", { barcode: "8690000000002", name: "Parol 500 mg 20 Tablet", source: "titck" }],
])

const sheetOf = (columns: string[], rows: string[][]): Sheet => ({ name: "s", columns, rows })

describe("which column a matched name belongs in", () => {
  it("finds the goods column under any of its names", () => {
    for (const header of ["Ürün Adı", "Eşya Cinsi", "Malın Cinsi", "Product Name", "Açıklama"]) {
      assert.equal(detectNameColumn(sheetOf(["Barkod", header, "Adet"], [])), 1, header)
    }
  })

  it("does not take a code column for the goods column", () => {
    // "Malzeme Kodu" opens with a goods term. Taken for the name column it
    // stopped the names being added at all, and would have written them into
    // any blank code cell.
    for (const header of ["Malzeme Kodu", "Mal Kodu", "Ürün Kodu", "Stok Kodu"]) {
      assert.equal(detectNameColumn(sheetOf(["Barkod", header, "Adet"], [])), -1, header)
    }
  })

  it("appends the names when there is no goods column to fill", () => {
    const sheet = sheetOf(["Barkod", "Malzeme Kodu", "Adet"], [["8690000000001", "MLZ-4471", "2"]])
    const out = fillNames(sheet, CATALOG, { label: "Ürün Adı", mode: "fill" })
    assert.deepEqual(out.sheet.columns, ["Barkod", "Malzeme Kodu", "Adet", "Ürün Adı"])
    assert.deepEqual(out.sheet.rows[0], ["8690000000001", "MLZ-4471", "2", "Aspirin 500 mg 20 Tablet"])
  })

  it("fills only the blanks when the document names its own products", () => {
    const sheet = sheetOf(["Barkod", "Ürün Adı", "Adet"],
      [["8690000000001", "ASPIRIN 500MG", "2"], ["8690000000002", "", "1"]])
    const out = fillNames(sheet, CATALOG, { label: "Ürün Adı", mode: "fill" })
    assert.deepEqual(out.sheet.columns, ["Barkod", "Ürün Adı", "Adet"])
    assert.equal(out.sheet.rows[0][1], "ASPIRIN 500MG", "the document's own name is kept")
    assert.equal(out.sheet.rows[1][1], "Parol 500 mg 20 Tablet")
  })
})

describe("a heading the sheet already carries", () => {
  const named = sheetOf(["Barkod", "Ürün Adı", "Adet"],
    [["8690000000001", "ASPIRIN 500MG", "2"], ["8690000000002", "", "1"]])

  it("is numbered rather than repeated, so no two columns share a name", () => {
    const out = fillNames(named, CATALOG, { label: "Ürün Adı", mode: "new" })
    assert.deepEqual(out.sheet.columns, ["Barkod", "Ürün Adı", "Adet", "Ürün Adı (2)"])
    assert.equal(out.sheet.rows[0][3], "Aspirin 500 mg 20 Tablet")
  })

  it("counts up when the numbered one is taken too", () => {
    const twice = sheetOf(["Barkod", "Ürün Adı", "Ürün Adı (2)"], [["8690000000001", "A", "B"]])
    const out = fillNames(twice, CATALOG, { label: "Ürün Adı", mode: "new" })
    assert.equal(out.sheet.columns.at(-1), "Ürün Adı (3)")
  })

  it("leaves the heading alone when nothing clashes", () => {
    const scanned = sheetOf(["Barkod", "Adet"], [["8690000000001", "2"]])
    const out = fillNames(scanned, CATALOG, { label: "Ürün Adı", mode: "new" })
    assert.deepEqual(out.sheet.columns, ["Barkod", "Adet", "Ürün Adı"])
  })

  it("numbers an added extra column the same way", () => {
    const priced = sheetOf(["Barkod", "Raf Fiyatı"], [["8690000000001", "10,00"]])
    const catalog: Catalog = new Map([
      ["8690000000001", { barcode: "8690000000001", name: "Aspirin", source: "s", price: "42.00" }],
    ])
    const out = fillNames(priced, catalog, {
      label: "Ürün Adı",
      mode: "new",
      extras: [{ field: "price", label: "Raf Fiyatı" }],
      decimal: ",",
    })
    assert.deepEqual(out.sheet.columns, ["Barkod", "Raf Fiyatı", "Ürün Adı", "Raf Fiyatı (2)"])
    assert.equal(out.sheet.rows[0][3], "42,00")
  })
})
