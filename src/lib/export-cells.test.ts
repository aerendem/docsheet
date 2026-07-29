// The rule the CSV download and the Copy button share. Both hand a sheet
// straight to another program, so both have to hand it figures.

import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { writerFor } from "./export-cells.ts"
import type { Sheet } from "./tiers.ts"

const FATURA: Sheet = {
  name: "Giriş Faturası",
  columns: ["Barkod", "Ürün Adı", "Etiket Fiyatı", "Birim Fiyat", "Adet", "KDV", "SKT"],
  rows: [
    ["882381129491", "Darphin Seti", "4.200,00", "2.777,25 TL", "2", "%20", "24.07.2028"],
    ["0885909950805", "Caudalie Serum", "1.515,00", "1.088,9005 TL", "1", "%20", "05.08.2026"],
    ["769915234060", "The Ordinary Tonik", "990,00", "711,5625 TL", "2", "%20", "31.12.2027"],
    ["769915195606", "İade - AHA Peeling", "555,00", "-398,9005 TL", "-1", "%20", "22.11.2026"],
  ],
}

const written = (sheet: Sheet, decimal: "," | ".") => {
  const w = writerFor(sheet, decimal)
  return sheet.rows.map((row) => row.map((v, ci) => w.cell(v, ci)))
}

describe("what reaches the clipboard and the CSV", () => {
  const rows = written(FATURA, ",")

  it("hands over the figure, not the text the page printed", () => {
    assert.deepEqual(rows.map((r) => r[3]), ["2777,2500", "1088,9005", "711,5625", "-398,9005"])
  })

  it("drops the unit a whole column shares", () => {
    // This is the one that empties Birim Fiyat: nothing reads "2777,2500 TL".
    for (const row of rows) assert.ok(!/TL/.test(row[3]), `${row[3]} still carries its unit`)
    assert.deepEqual(rows.map((r) => r[5]), ["20", "20", "20", "20"])
  })

  it("drops the grouping a foreign reader could take for a decimal point", () => {
    assert.deepEqual(rows.map((r) => r[2]), ["4200,00", "1515,00", "990,00", "555,00"])
  })

  it("leaves a barcode exactly as printed, leading zero and all", () => {
    assert.deepEqual(rows.map((r) => r[0]),
      ["882381129491", "0885909950805", "769915234060", "769915195606"])
  })

  it("leaves names and dates alone", () => {
    assert.equal(rows[0][1], "Darphin Seti")
    assert.equal(rows[0][6], "24.07.2028")
  })

  it("follows the reader's language", () => {
    const en = written(FATURA, ".")
    assert.deepEqual(en.map((r) => r[3]), ["2777.2500", "1088.9005", "711.5625", "-398.9005"])
  })

  it("marks the code column for Excel to take as text", () => {
    const w = writerFor(FATURA, ",")
    assert.equal(w.isText[0], true, "Barkod")
    assert.equal(w.isText[1], true, "Ürün Adı")
    assert.equal(w.isText[3], false, "Birim Fiyat is a figure")
    assert.equal(w.isText[6], false, "SKT is a date")
  })

  it("leaves a cell its column cannot read as its own text", () => {
    const messy: Sheet = {
      name: "s",
      columns: ["Ürün", "Birim Fiyat"],
      rows: [["A", "340,50"], ["B", "128,75"], ["C", "sorulacak"], ["D", "99,90"], ["E", "612,40"]],
    }
    assert.deepEqual(written(messy, ",").map((r) => r[1]),
      ["340,50", "128,75", "sorulacak", "99,90", "612,40"])
  })

  it("does not invent a figure where the column is text", () => {
    const codes: Sheet = {
      name: "s",
      columns: ["Kod", "Ürün"],
      rows: [["0532", "A"], ["0741", "B"], ["0088", "C"]],
    }
    assert.deepEqual(written(codes, ",").map((r) => r[0]), ["0532", "0741", "0088"])
  })
})
