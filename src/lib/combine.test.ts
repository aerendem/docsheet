import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { combine, discoverColumns, headerKey } from "./combine.ts"
import type { ExtractedDoc } from "./combine.ts"

const doc = (filename: string, columns: string[], rows: string[][]): ExtractedDoc => ({
  filename,
  sheets: [{ name: "s", columns, rows }],
})

/** A table needs a row to be the one worth stacking. */
const withRow = (columns: string[]) =>
  doc("a.pdf", columns, [columns.map((_, i) => `v${i}`)])

/** The identity each heading resolves to, which is what stacking matches on. */
const keysOf = (...docs: ExtractedDoc[]) => discoverColumns(docs).map((c) => c.key)

describe("what a heading is understood to mean", () => {
  it("knows the names a Turkish invoice gives its goods column", () => {
    for (const header of [
      "Ürün Adı", "Ürün İsmi", "Ürün Cinsi", "Eşya Adı", "Eşya Cinsi", "Mal Adı",
      "Malın Cinsi", "Emtia Cinsi", "Emtianın Cinsi", "Mal/Hizmet Cinsi", "Cinsi",
      "Malzeme Adı", "Stok Adı", "İlaç Adı", "Ticari Adı", "Preparat Adı",
      "Müstahzar Adı", "Ürünün Adı", "Açıklama",
    ]) {
      assert.equal(headerKey(header), "item", `${header} is a goods column`)
    }
  })

  it("knows the English ones too", () => {
    for (const header of [
      "Product Name", "Product Description", "Item Name", "Item Description",
      "Description", "Goods Description", "Article", "Name", "Item",
    ]) {
      assert.equal(headerKey(header), "item", `${header} is a goods column`)
    }
  })

  it("does not mistake a neighbouring column for the goods column", () => {
    // Each of these opens with the letters of a goods term and is not one.
    assert.equal(headerKey("Malzeme Kodu"), "code")
    assert.equal(headerKey("Mal Kodu"), "code")
    assert.equal(headerKey("Ürün Kodu"), "code")
    for (const header of ["Maliyet", "Miktar", "Adet", "KDV Oranı", "Birim Fiyatı"]) {
      assert.notEqual(headerKey(header), "item", `${header} was read as a goods column`)
    }
  })

  it("still resolves the columns around it as it did", () => {
    assert.deepEqual(
      keysOf(withRow(["Barkodu", "Mal/Hizmet Cinsi", "Miktarı", "Birim", "Birim Fiyatı",
        "İskonto", "KDV Oranı", "Mal Hizmet Tutarı", "Tarih", "Malzeme Kodu"])),
      ["__source", "barcode", "item", "quantity", "unit", "unit_price",
        "discount", "vat", "amount", "date", "code"],
    )
  })

  it("reads a possessive heading, which is how invoices print them", () => {
    // The ending lands on both nouns: "Ürün Adı" is printed "Ürünün Adı".
    assert.equal(headerKey("Ürünün Adı"), "item")
    assert.equal(headerKey("Malın Cinsi"), "item")
    assert.equal(headerKey("Emtianın Cinsi"), "item")
    assert.equal(headerKey("Ürünün Kodu"), "code")
    // And the plainest name of the three is the one that keeps the identity.
    assert.deepEqual(
      keysOf(withRow(["Malın Cinsi", "Ürünün Adı", "Emtianın Cinsi"])),
      ["__source", "item:malin cinsi", "item", "item:emtianin cinsi"],
    )
  })
})

/**
 * The failure this guards: two suppliers, both printing a name column and a
 * description column, in opposite orders. The generic identity used to go to
 * whichever came first, so one document's description stacked under the other
 * document's product name.
 */
describe("two name columns in one table", () => {
  const A = doc("fatura-A.pdf", ["Barkod", "Açıklama", "Ürün Adı", "Adet"],
    [["8690000000001", "30 tablet, blister", "Aspirin 500mg", "2"]])
  const B = doc("fatura-B.pdf", ["Barkod", "Ürün Adı", "Açıklama", "Adet"],
    [["8690000000002", "Parol 500mg", "20 tablet kutu", "1"]])

  it("gives the product name the shared identity, whichever order it is printed in", () => {
    // Both tables carry the same two headings, so both must answer the same
    // way about which of them is the product name.
    assert.deepEqual([...keysOf(A)].sort(), [...keysOf(B)].sort())
    assert.deepEqual([...keysOf(A, B)].sort(), [...keysOf(B, A)].sort())
    assert.equal(keysOf(A).filter((k) => k === "item").length, 1)
  })

  it("stacks names under names and descriptions under descriptions", () => {
    const columns = discoverColumns([A, B])
    const out = combine([A, B], columns)
    const item = columns.filter((c) => c.include).findIndex((c) => c.key === "item")
    const note = columns.filter((c) => c.include).findIndex((c) => c.key === "item:aciklama")

    assert.deepEqual([out.rows[0][item], out.rows[1][item]], ["Aspirin 500mg", "Parol 500mg"])
    assert.deepEqual([out.rows[0][note], out.rows[1][note]], ["30 tablet, blister", "20 tablet kutu"])
  })

  it("prefers a name over a description whichever pair of words is used", () => {
    const en = doc("c.pdf", ["Description", "Product Name"], [["a note", "Aspirin"]])
    const columns = discoverColumns([en]).filter((c) => c.include)
    const at = columns.findIndex((c) => c.key === "item")
    assert.equal(combine([en], columns).rows[0][at], "Aspirin")
  })

  it("still gives a lone description column the shared identity", () => {
    // Nothing outranks it, so an English invoice headed only "Description"
    // stacks with a Turkish one headed "Ürün Adı", which is what should happen.
    const only = doc("d.pdf", ["Barkod", "Description"], [["869", "Aspirin"]])
    assert.deepEqual(keysOf(only), ["__source", "barcode", "item"])
  })

  it("keeps three name columns apart rather than overwriting", () => {
    const wide = doc("e.pdf", ["Ürün Adı", "Eşya Cinsi", "Açıklama"], [["A", "B", "C"]])
    const columns = discoverColumns([wide]).filter((c) => c.include)
    assert.deepEqual(columns.map((c) => c.key),
      ["__source", "item", "item:esya cinsi", "item:aciklama"])
    assert.deepEqual(combine([wide], columns).rows[0], ["e.pdf", "A", "B", "C"])
  })
})
