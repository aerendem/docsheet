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
