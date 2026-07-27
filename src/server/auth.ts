// Basic shared-password gate. The password lives ONLY in the APP_PASSWORD env
// var (this repo is public) — if it's unset, the app is open. Auth is proven by
// an httpOnly cookie holding an opaque hash of the password, so it can't be read
// from JS and can't be forged without knowing the password.

import { env } from "./node"

export const COOKIE_NAME = "ds_session"
const MAX_AGE = 60 * 60 * 24 * 30 // 30 days

export function authRequired(): boolean {
  return Boolean((env.APP_PASSWORD ?? "").length)
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

function sessionToken(): Promise<string> {
  return sha256Hex(`docsheet::${env.APP_PASSWORD ?? ""}`)
}

/**
 * Compare the password without leaking it a character — or a length — at a
 * time. Hashing both sides first makes the comparison fixed-width, so a wrong
 * guess of the wrong length costs exactly as much as a wrong guess of the right
 * one.
 */
export async function checkPassword(candidate: string): Promise<boolean> {
  const expected = env.APP_PASSWORD ?? ""
  if (!expected) return false
  const [a, b] = await Promise.all([sha256Hex(candidate), sha256Hex(expected)])
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/**
 * How many guesses an address gets before it has to wait. The gate is one
 * shared password on a public URL, so without a limit it is only as strong as
 * the number of guesses per second the network allows — which is a lot.
 */
const MAX_ATTEMPTS = 10
const WINDOW_MS = 5 * 60_000
const attempts = new Map<string, { count: number; until: number }>()

/** Who is guessing. Behind Railway's proxy the socket address is the proxy. */
function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for") ?? ""
  return forwarded.split(",")[0].trim() || "unknown"
}

/** @returns seconds to wait, or 0 when the attempt may go ahead. */
export function loginRetryAfter(request: Request): number {
  const now = Date.now()
  // Cheap sweep: the map only ever holds addresses that guessed recently.
  for (const [key, seen] of attempts) if (seen.until <= now) attempts.delete(key)

  const seen = attempts.get(clientKey(request))
  if (!seen || seen.count < MAX_ATTEMPTS) return 0
  return Math.ceil((seen.until - now) / 1000)
}

export function recordLoginFailure(request: Request): void {
  const key = clientKey(request)
  const now = Date.now()
  const seen = attempts.get(key)
  if (!seen || seen.until <= now) {
    attempts.set(key, { count: 1, until: now + WINDOW_MS })
    return
  }
  seen.count++
  seen.until = now + WINDOW_MS
}

export function clearLoginFailures(request: Request): void {
  attempts.delete(clientKey(request))
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie")
  if (!header) return null
  for (const part of header.split(";")) {
    const eq = part.indexOf("=")
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim())
  }
  return null
}

export async function isAuthed(request: Request): Promise<boolean> {
  if (!authRequired()) return true
  const cookie = readCookie(request, COOKIE_NAME)
  return cookie !== null && cookie === (await sessionToken())
}

export async function loginCookie(): Promise<string> {
  const token = await sessionToken()
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE}`
}

export function logoutCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
}
