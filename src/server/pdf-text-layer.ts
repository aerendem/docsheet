// Server-only. Decides whether a PDF already carries a real text layer, so the
// "auto" engine can pick pdf-text (free) or mistral-ocr (paid) in ONE model
// call instead of burning a call on an attempt that returns nothing.
//
// This is deliberately a heuristic with a safe bias: it only answers `false`
// when it both failed to find text AND saw image markers typical of a scan.
// Anything it cannot read confidently returns `null`, which keeps the caller on
// the old try-text-then-fall-back path. A wrong `false` would send a digital PDF
// to paid OCR, so that answer has to earn it.

import { inflateRawSync, inflateSync } from "node:zlib"

/** Characters drawn by text operators before we call it a real text layer. */
const MIN_SHOWN_CHARS = 64
/** Below this we clearly failed to decompress the document; don't guess. */
const MIN_DECODED_BYTES = 200

const IMAGE_MARKERS =
  /\/Subtype\s*\/Image|\/DCTDecode|\/CCITTFaxDecode|\/JPXDecode|\/JBIG2Decode/

/**
 * @returns `true` (usable text layer), `false` (looks scanned), or `null` when
 * the PDF could not be read well enough to say.
 */
export function hasTextLayer(bytes: Uint8Array): boolean | null {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  // Encrypted documents won't decompress; let the caller fall back.
  if (buf.includes("/Encrypt")) return null

  let decodedBytes = 0
  let shownChars = 0
  let cursor = 0

  while (cursor < buf.length) {
    const start = buf.indexOf("stream", cursor)
    if (start === -1) break

    const dictStart = buf.lastIndexOf("<<", start)
    let payloadStart = start + "stream".length
    // The stream keyword is followed by CRLF or LF before the data.
    if (buf[payloadStart] === 0x0d) payloadStart++
    if (buf[payloadStart] === 0x0a) payloadStart++

    const end = buf.indexOf("endstream", payloadStart)
    if (end === -1) break
    cursor = end + "endstream".length

    if (dictStart === -1) continue
    const dict = buf.subarray(dictStart, start).toString("latin1")
    const payload = buf.subarray(payloadStart, end)

    let data: Buffer | null = null
    if (/\/Filter[^>]*\/FlateDecode/.test(dict)) {
      try {
        data = inflateSync(payload)
      } catch {
        try {
          data = inflateRawSync(payload)
        } catch {
          data = null // LZW, a broken stream, or an indirect filter — skip it.
        }
      }
    } else if (!/\/Filter/.test(dict)) {
      data = payload
    }
    if (!data) continue

    decodedBytes += data.length
    shownChars += countShownChars(data.toString("latin1"))
  }

  if (decodedBytes < MIN_DECODED_BYTES) return null
  if (shownChars >= MIN_SHOWN_CHARS) return true
  return IMAGE_MARKERS.test(buf.toString("latin1")) ? false : null
}

/**
 * Length of the strings a content stream actually draws. Only counts streams
 * with a BT (begin-text) block, so font programs and metadata don't register.
 */
function countShownChars(content: string): number {
  if (!content.includes("BT")) return 0

  let total = 0
  // Literal strings: (Hello) Tj — escaped chars stay inside the string.
  const literal = /\((?:\\.|[^\\()])*\)/g
  for (const match of content.matchAll(literal)) {
    total += Math.max(0, match[0].length - 2)
  }
  // Hex strings: <48656C6C6F> Tj — two hex digits per glyph.
  const hex = /<([0-9A-Fa-f\s]{2,})>\s*(?:Tj|TJ)/g
  for (const match of content.matchAll(hex)) {
    total += Math.floor(match[1].replace(/\s/g, "").length / 2)
  }
  return total
}
