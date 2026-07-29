// Run with `npm test`. No framework: node's own runner, and .ts straight off
// disk on the version this package already requires.

import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  decimalPlaces,
  inferColumnKinds,
  inferDecimalMarks,
  numberFormatFor,
  parseNumber,
} from "./cell-value.ts"
import type { Sheet } from "./tiers.ts"

const sheetOf = (columns: string[], rows: string[][]): Sheet => ({
  name: "Sheet1",
  columns,
  rows,
})

/**
 * A goods-in list a pharmacy was sent by a cosmetics supplier, typed off the
 * screenshot of the sheet that would not paste. The unit costs are printed to
 * three and four places, which is what broke: read cell by cell "837,338" is a
 * thousands group and "711,5625" is nothing at all.
 */
const BOTANIK = sheetOf(
  ["BARKOD", "ürün ismi", "ETİKET FİYATI", "Birim Fiyat", "ADET", "KDV Oranı"],
  [
    ["882381129491", "Darphin Mineral Güneş Koruması Seti", "4200,00", "2.777,25 TL", "2", "20"],
    ["769915233919", "The Ordinary Natural Moisturizing Factors 240ml", "1165,00", "837,338 TL", "1", "20"],
    ["769915234060", "The Ordinary Glikolik Asit %7 Peeling Tonik", "990,00", "711,5625 TL", "2", "20"],
    ["769915196023", "The Ordinary Salicylic Acid 2% Masque", "815,00", "585,787 TL", "2", "20"],
    ["769915234084", "The Ordinary UV Filters SPF45 Serum 60ml", "1515,00", "1.088,9005 TL", "1", "20"],
    ["769915233490", "The Ordinary Hyaluronic Acid 2% B5", "515,00", "370,162 TL", "2", "20"],
    ["769915233889", "The Ordinary Niacinamide 5% Emülsiyonu", "715,00", "513,9005 TL", "2", "20"],
    ["769915195934", "The Ordinary Natural Moisturizing + HA", "795,00", "571,4005 TL", "2", "20"],
    ["769915199338", "The Ordinary Hair Care Moisturizing HA", "1100,00", "697,1875 TL", "2", "20"],
    ["769915234411", "The Ordinary GF 15% Solution Serumu 30ml", "840,00", "603,75 TL", "2", "20"],
    ["769915195712", "The Ordinary Caffeine Solution 5% + EGCG", "505,00", "362,963 TL", "2", "20"],
    ["769915195606", "The Ordinary AHA 30% + BHA 2% Peeling", "555,00", "398,9005 TL", "2", "20"],
    ["8809642714502", "Dr.Jart+ Cryo Rubber Firming Maskesi", "925,00", "593,952 TL", "1", "20"],
    ["1210001218888", "Dr. Jart+ Cryo Rubber Brightening Mask", "925,00", "647,1165 TL", "1", "20"],
    ["769915233506", "The Ordinary Hyaluronic Acid 2% + B5", "890,00", "639,6875 TL", "2", "20"],
    ["769915196061", "The Ordinary Vitamin C Suspension 23%", "500,00", "359,375 TL", "2", "20"],
    ["3522930004639", "Caudalie Vinoperfect El Bakım Kremi 50 ml", "650,00", "436,034 TL", "2", "20"],
    ["3522930004158", "Caudalie Deep Cleansing Exfoliating 60 ml", "1300,00", "872,0795 TL", "1", "20"],
    ["3522930004042", "Caudalie Güneşsiz Bronzlaştırıcı Damla", "950,00", "570,2045 TL", "1", "20"],
    ["3522930005513", "Caudalie Resveratrol Lift Set", "2900,00", "1.903,25 TL", "2", "20"],
    ["3522930004660", "Caudalie Vinoperfect Mikro Peeling 50 ml", "750,00", "503,125 TL", "1", "20"],
    ["8809724476168", "Dr.Jart+Cicapair Tiger Grass Treatment", "1429,00", "908,7645 TL", "1", "20"],
    ["3522930005780", "Caudalie Vinopure Düzensiz Ciltler Kit", "1850,00", "1.078,424 TL", "2", "20"],
    ["3522930005292", "Caudalie Eau des Vignes Parfüm 50 ml", "1450,00", "972,716 TL", "1", "20"],
  ],
)

const BIRIM_FIYAT = 3

describe("the goods-in list that would not paste", () => {
  it("reads the unit cost column as figures, not text", () => {
    const kinds = inferColumnKinds(BOTANIK)
    assert.equal(kinds[BIRIM_FIYAT], "number", "Birim Fiyat must be a figure column")
    assert.equal(kinds[2], "number", "ETİKET FİYATI was already fine and must stay so")
    assert.equal(kinds[1], "text", "the product name is not a figure")
  })

  it("settles on the comma as the column's decimal point", () => {
    assert.equal(inferDecimalMarks(BOTANIK)[BIRIM_FIYAT], ",")
  })

  it("gives every cell a value under a thousand", () => {
    const mark = inferDecimalMarks(BOTANIK)[BIRIM_FIYAT]
    for (const row of BOTANIK.rows) {
      const raw = row[BIRIM_FIYAT]
      const value = parseNumber(raw, mark)
      assert.notEqual(value, null, `${raw} did not parse`)
      assert.ok(value! > 100 && value! < 3000, `${raw} parsed as ${value}`)
    }
  })

  it("reads the three- and four-place costs exactly", () => {
    const mark = inferDecimalMarks(BOTANIK)[BIRIM_FIYAT]
    assert.equal(parseNumber("837,338 TL", mark), 837.338)
    assert.equal(parseNumber("711,5625 TL", mark), 711.5625)
    assert.equal(parseNumber("2.777,25 TL", mark), 2777.25)
    assert.equal(parseNumber("1.088,9005 TL", mark), 1088.9005)
  })

  it("keeps the widest number of places the column prints", () => {
    const mark = inferDecimalMarks(BOTANIK)[BIRIM_FIYAT]
    const places = Math.max(...BOTANIK.rows.map((r) => decimalPlaces(r[BIRIM_FIYAT], mark)))
    assert.equal(places, 4)
  })
})

/**
 * Excel copies what a cell *displays*, so anything in the number format beyond
 * the digits is something the next program has to read past. These are the two
 * marks that empty her Birim Fiyat column, and both have been added to this
 * export before in the name of printing a cell the way the page printed it.
 */
describe("nothing but the figure reaches the number format", () => {
  const priced = (cells: string[]): Sheet => ({
    name: "s",
    columns: ["Ürün", "Birim Fiyat"],
    rows: cells.map((c, i) => [`Ürün ${i}`, c]),
  })
  const formatOf = (cells: string[]) => {
    const sheet = priced(cells)
    return numberFormatFor(sheet, 1, inferDecimalMarks(sheet)[1])
  }

  it("carries no currency, even when every figure in the column prints one", () => {
    // "2777,2500 TL" is not a figure to anything importing it: the cell arrives
    // empty, which is the whole bug this column exists to prevent.
    assert.equal(formatOf(["2.777,25 TL", "837,338 TL", "711,5625 TL"]), "0.0000")
    assert.equal(formatOf(["340,50 TL", "128,75 TL"]), "0.00")
    assert.equal(formatOf(["₺340,50", "₺128,75"]), "0.00")
  })

  it("carries no percent sign", () => {
    assert.equal(formatOf(["%10", "%20", "%20"]), "0")
  })

  it("carries no thousands separator", () => {
    // "2.777,25" read by something that takes the dot for the point is 2,78.
    for (const fmt of [
      formatOf(["2.777,25", "1.903,25"]),
      formatOf(["12.000,00", "1.250,00"]),
      formatOf(["1,250.00", "12,000.00"]),
    ]) {
      assert.ok(!fmt.includes("#"), `${fmt} groups its digits`)
      assert.ok(!fmt.includes(","), `${fmt} groups its digits`)
    }
  })

  it("is only ever zeros and a point", () => {
    for (const cells of [
      ["2.777,25 TL", "837,338 TL"],
      ["%10", "%20"],
      ["1,250.00", "99.95"],
      ["340,50", "128,75"],
      ["12", "40"],
    ]) {
      assert.match(formatOf(cells), /^0(?:\.0+)?$/, `${formatOf(cells)} carries more than the figure`)
    }
  })
})

describe("which separator a column is using", () => {
  const markFor = (cells: string[]) => inferDecimalMarks(sheetOf(["x"], cells.map((c) => [c])))[0]

  it("takes the last of the two when a cell carries both", () => {
    assert.equal(markFor(["1.234,56"]), ",")
    assert.equal(markFor(["1,234.56"]), ".")
  })

  it("takes a tail that no thousands group could have", () => {
    assert.equal(markFor(["711,5625"]), ",", "four digits is not a group")
    assert.equal(markFor(["340,50"]), ",", "two digits is not a group")
    assert.equal(markFor(["340.50"]), ".")
  })

  it("says nothing when every cell is a bare three-digit tail", () => {
    // "1,250" is 1250 in New York and 1,25 in Ankara. Nothing here can tell.
    assert.equal(markFor(["1,250", "2,300", "12,000"]), undefined)
    assert.equal(markFor(["1.250", "2.300"]), undefined)
  })

  it("reads a repeated separator as grouping, which fixes the other", () => {
    assert.equal(markFor(["1.234.567"]), ",")
    assert.equal(markFor(["1,234,567"]), ".")
  })

  it("does not let dates vote", () => {
    assert.equal(markFor(["24.07.2026", "05.08.2026", "31.12.2027"]), undefined)
  })

  it("does not let a lone dissenter carry the column", () => {
    // Eleven Turkish costs and one row someone typed the American way.
    const turkish = ["340,50", "128,75", "99,90", "1.204,30", "78,25", "612,40"]
    assert.equal(markFor([...turkish, "1,234.56"]), ",")
  })

  it("falls back to the cell rule when the column is split down the middle", () => {
    assert.equal(markFor(["340,50", "128.75"]), undefined)
  })
})

describe("reading a cell under a settled convention", () => {
  it("refuses a cell that contradicts the column", () => {
    assert.equal(parseNumber("1,234.56", ","), null, "two marks, wrong way round")
    assert.equal(parseNumber("1.234,56", "."), null)
    assert.equal(parseNumber("1,2,3", ","), null, "two decimal points")
  })

  it("reads a whole number the same either way", () => {
    assert.equal(parseNumber("4200", ","), 4200)
    assert.equal(parseNumber("4200", "."), 4200)
  })

  it("keeps grouping on the integer side", () => {
    assert.equal(parseNumber("1.234.567,89", ","), 1234567.89)
    assert.equal(parseNumber("1,234,567.89", "."), 1234567.89)
  })

  it("still strips what is printed around the figure", () => {
    assert.equal(parseNumber("1.545,49 TL", ","), 1545.49)
    assert.equal(parseNumber("₺340,50", ","), 340.5)
    assert.equal(parseNumber("%10", ","), 10)
    assert.equal(parseNumber("-370,162", ","), -370.162)
    assert.equal(parseNumber("(1.234,50)", ","), -1234.5)
  })

  it("refuses a date, so a date column never becomes figures", () => {
    assert.equal(parseNumber("24.07.2026", ","), null)
    assert.equal(parseNumber("24.07.2026", "."), null)
  })

  it("leaves the cell rule exactly as it was when no mark is given", () => {
    assert.equal(parseNumber("1,250"), 1250)
    assert.equal(parseNumber("1.250"), 1250)
    assert.equal(parseNumber("340,50"), 340.5)
    assert.equal(parseNumber("1.234.567"), 1234567)
    assert.equal(parseNumber("24.07.2026"), null)
  })
})

describe("columns that were already right stay right", () => {
  it("reads an American invoice as before", () => {
    const us = sheetOf(
      ["Item", "Qty", "Unit price", "Amount"],
      [
        ["Widget", "2", "1,250.00", "2,500.00"],
        ["Gasket", "10", "99.95", "999.50"],
        ["Flange", "1", "12,000.00", "12,000.00"],
      ],
    )
    const marks = inferDecimalMarks(us)
    assert.equal(inferColumnKinds(us)[2], "number")
    assert.equal(parseNumber(us.rows[0][2], marks[2]), 1250)
    assert.equal(parseNumber(us.rows[2][2], marks[2]), 12000)
  })

  it("keeps a thousands-only column reading as thousands", () => {
    // No cell here shows a decimal point, so nothing overrides the cell rule.
    const qty = sheetOf(["Adet"], [["1,250"], ["2,300"], ["12,000"]])
    assert.equal(inferDecimalMarks(qty)[0], undefined)
    assert.equal(parseNumber(qty.rows[0][0], inferDecimalMarks(qty)[0]), 1250)
  })

  it("keeps a date column a date column", () => {
    const dated = sheetOf(
      ["Ürün", "SKT"],
      [["A", "24.07.2028"], ["B", "05.08.2026"], ["C", "31.12.2027"]],
    )
    assert.equal(inferColumnKinds(dated)[1], "date")
  })

  it("keeps a padded code text, zeros and all", () => {
    const coded = sheetOf(
      ["Barkod", "Fiyat"],
      [["0885909950805", "340,50"], ["8697742122934", "128,75"], ["0123456789012", "99,90"]],
    )
    assert.equal(inferColumnKinds(coded)[0], "text")
    assert.equal(inferColumnKinds(coded)[1], "number")
  })

  it("types a price column with a blank and a note in it", () => {
    const messy = sheetOf(
      ["Ürün", "Birim Fiyat"],
      [
        ["A", "340,50"],
        ["B", "128,75"],
        ["C", ""],
        ["D", "1.204,30"],
        ["E", "iade"],
        ["F", "99,90"],
        ["G", "612,40"],
        ["H", "78,25"],
      ],
    )
    assert.equal(inferColumnKinds(messy)[1], "number")
  })
})
