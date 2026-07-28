import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { toCsv } from "./csv.ts"
import type { Sheet } from "./tiers.ts"

const FATURA: Sheet = {
  name: "Giriş Faturası",
  columns: ["Barkod", "Ürün Adı", "Etiket Fiyatı", "Birim Fiyat", "Adet", "KDV"],
  rows: [
    ["882381129491", "Darphin Seti", "4200,00", "2.777,25 TL", "2", "%20"],
    ["0885909950805", "Caudalie Serum; gece", "1515,00", "1.088,9005 TL", "1", "%20"],
    ["769915234060", "The Ordinary Tonik", "990,00", "711,5625 TL", "2", "%20"],
    ["769915195606", "İade - AHA Peeling", "555,00", "-398,9005 TL", "-1", "%20"],
  ],
}

/** Split a written line back into fields, respecting the quoting we emit. */
function fields(line: string, delimiter: string): string[] {
  const out: string[] = []
  let cur = ""
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (c === '"') quoted = false
      else cur += c
    } else if (c === '"') quoted = true
    else if (c === delimiter) { out.push(cur); cur = "" }
    else cur += c
  }
  out.push(cur)
  return out
}

const rowsOf = (csv: string, delimiter: string) =>
  csv.replace("﻿", "").split("\r\n").map((l) => fields(l, delimiter))

describe("the CSV a stock program has to read", () => {
  const written = toCsv(FATURA, ";", ",")
  const rows = rowsOf(written, ";")

  it("writes a unit cost as a figure, not as what the page printed", () => {
    assert.equal(rows[1][3], "2777,2500")
    assert.equal(rows[2][3], "1088,9005")
    assert.equal(rows[3][3], "711,5625")
  })

  it("keeps the sign on a return line", () => {
    assert.equal(rows[4][3], "-398,9005")
  })

  it("drops the unit from a percent column", () => {
    assert.equal(rows[1][5], "20")
  })

  it("leaves a barcode exactly as it was printed", () => {
    assert.equal(rows[2][0], "0885909950805", "a leading zero is not a rounding error")
    assert.equal(rows[1][0], "882381129491")
  })

  it("still quotes a name carrying the delimiter", () => {
    assert.ok(written.includes('"Caudalie Serum; gece"'))
    assert.equal(rows[2][1], "Caudalie Serum; gece")
  })

  it("writes no thousands separator, which is the one a reader can misread", () => {
    for (const row of rows.slice(1)) {
      assert.ok(!row[3].includes("."), `${row[3]} carries a grouping separator`)
      assert.ok(!row[2].includes("."), `${row[2]} carries a grouping separator`)
    }
  })

  it("follows the reader's language for both separators", () => {
    const en = rowsOf(toCsv(FATURA, ",", "."), ",")
    assert.equal(en[1][3], "2777.2500")
    assert.equal(en[1][2], "4200.00")
  })

  it("leaves a cell its column cannot read as its own text", () => {
    const withNote: Sheet = {
      name: "s",
      columns: ["Ürün", "Birim Fiyat"],
      rows: [["A", "340,50"], ["B", "128,75"], ["C", "sorulacak"], ["D", "99,90"], ["E", "612,40"]],
    }
    const out = rowsOf(toCsv(withNote, ";", ","), ";")
    assert.equal(out[3][1], "sorulacak")
    assert.equal(out[1][1], "340,50")
  })

  it("leaves a text column alone entirely", () => {
    assert.equal(rows[1][1], "Darphin Seti")
  })
})
