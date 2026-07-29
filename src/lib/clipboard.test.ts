// The Copy button's payload. Pasting is the one route to another program that
// never passes through a file, so nothing downstream can rescue it.

import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { clipboardPayload } from "./clipboard.ts"
import type { Sheet } from "./tiers.ts"

const FATURA: Sheet = {
  name: "Giriş Faturası",
  columns: ["Barkod", "Ürün Adı", "Etiket Fiyatı", "Birim Fiyat", "Adet", "KDV"],
  rows: [
    ["882381129491", "Darphin Seti", "4.200,00", "2.777,25 TL", "2", "%20"],
    ["0885909950805", "Caudalie Serum\nGece Bakımı", "1.515,00", "1.088,9005 TL", "1", "%20"],
    ["769915234060", "The Ordinary Tonik", "990,00", "711,5625 TL", "2", "%20"],
    ["769915195606", "İade - AHA Peeling", "555,00", "-398,9005 TL", "-1", "%20"],
  ],
}

/** What a plain paste lands as: one array of fields per row. */
const pasted = (sheet: Sheet, decimal: "," | ".") =>
  clipboardPayload(sheet, decimal).text.split("\r\n").map((l) => l.split("\t"))

/** A stock program reading a Turkish figure out of a pasted cell. */
const reads = (t: string) =>
  /^-?\d+(?:,\d+)?$/.test(t.trim()) ? Number(t.trim().replace(",", ".")) : null

describe("what a paste actually carries", () => {
  const rows = pasted(FATURA, ",")

  it("carries the unit cost as a figure the receiving program can read", () => {
    const want = [2777.25, 1088.9005, 711.5625, -398.9005]
    rows.slice(1).forEach((row, i) => {
      const got = reads(row[3])
      assert.notEqual(got, null, `"${row[3]}" is not a figure — the column arrives empty`)
      assert.ok(Math.abs(got! - want[i]) < 1e-9, `"${row[3]}" read as ${got}, want ${want[i]}`)
    })
  })

  it("carries no unit and no grouping", () => {
    for (const row of rows.slice(1)) {
      assert.ok(!/TL/.test(row[3]), `${row[3]} still carries its unit`)
      assert.ok(!row[3].includes("."), `${row[3]} still groups its digits`)
      assert.ok(!row[2].includes("."), `${row[2]} still groups its digits`)
    }
    assert.deepEqual(rows.slice(1).map((r) => r[5]), ["20", "20", "20", "20"])
  })

  it("copies the headings as they read", () => {
    assert.deepEqual(rows[0], ["Barkod", "Ürün Adı", "Etiket Fiyatı", "Birim Fiyat", "Adet", "KDV"])
  })

  it("keeps every row square, so nothing lands a column out", () => {
    const width = FATURA.columns.length
    for (const row of rows) assert.equal(row.length, width)
    assert.equal(rows.length, FATURA.rows.length + 1, "every row comes along, not just the visible ones")
  })

  it("flattens a line break inside a name rather than splitting the row", () => {
    assert.equal(rows[2][1], "Caudalie Serum Gece Bakımı")
  })

  it("keeps a barcode's leading zero", () => {
    assert.equal(rows[2][0], "0885909950805")
  })

  it("tells Excel which columns are text, and which are not", () => {
    const { html } = clipboardPayload(FATURA, ",")
    const cells = html.slice(html.indexOf("<td")).split("<td").slice(1, 7)
    assert.ok(cells[0].includes("mso-number-format"), "Barkod must be pinned as text")
    assert.ok(cells[1].includes("mso-number-format"), "Ürün Adı must be pinned as text")
    assert.ok(!cells[3].includes("mso-number-format"), "Birim Fiyat must be left a figure")
  })

  it("escapes a name that would otherwise be markup", () => {
    const risky: Sheet = {
      name: "s",
      columns: ["Ürün"],
      rows: [["<b>A & B</b>"]],
    }
    const { html, text } = clipboardPayload(risky, ",")
    assert.ok(html.includes("&lt;b&gt;A &amp; B&lt;/b&gt;"), html)
    assert.ok(text.includes("<b>A & B</b>"), "the plain form is not markup and needs no escaping")
  })

  it("follows the reader's language", () => {
    assert.equal(pasted(FATURA, ".")[1][3], "2777.2500")
  })
})
