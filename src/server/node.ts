// Typed access to the Node runtime globals we rely on server-side.
// The project's tsconfig uses `types: ["vite/client"]`, so @types/node globals
// are intentionally not ambient. We reach `process`/`Buffer` through globalThis
// to stay decoupled from @types/node (and avoid clashing with the global
// `Buffer` interface that exceljs declares).

type NodeGlobals = {
  process?: { env?: Record<string, string | undefined> }
  Buffer?: { from(data: Uint8Array): { toString(encoding: string): string } }
}

const g = globalThis as unknown as NodeGlobals

export const env: Record<string, string | undefined> = g.process?.env ?? {}

export function bytesToBase64(bytes: Uint8Array): string {
  if (!g.Buffer) throw new Error("Buffer is unavailable in this runtime")
  return g.Buffer.from(bytes).toString("base64")
}

/**
 * The ExcelJS Workbook constructor.
 *
 * ExcelJS is CommonJS, so `import { Workbook } from "exceljs"` is undefined
 * under the dev server's ESM runner even though the production bundler resolves
 * it — every Excel download and every workbook read 500s until the app is
 * built. Reaching through `default` is what makes the two runtimes agree, and
 * loading it on demand keeps a megabyte of spreadsheet writer out of the cold
 * start of routes that never touch one.
 */
export async function loadWorkbook(): Promise<typeof import("exceljs").Workbook> {
  const mod = (await import("exceljs")) as unknown as {
    Workbook?: typeof import("exceljs").Workbook
    default?: { Workbook: typeof import("exceljs").Workbook }
  }
  const Workbook = mod.Workbook ?? mod.default?.Workbook
  if (!Workbook) throw new Error("exceljs could not be loaded")
  return Workbook
}
