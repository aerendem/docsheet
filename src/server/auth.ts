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

export function checkPassword(candidate: string): boolean {
  const expected = env.APP_PASSWORD ?? ""
  if (!expected || candidate.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) {
    diff |= candidate.charCodeAt(i) ^ expected.charCodeAt(i)
  }
  return diff === 0
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
