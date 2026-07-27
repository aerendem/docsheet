import { createFileRoute } from "@tanstack/react-router"
import {
  checkPassword,
  clearLoginFailures,
  loginCookie,
  loginRetryAfter,
  recordLoginFailure,
} from "../../server/auth"

export const Route = createFileRoute("/api/login")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Guessing is rate-limited per address: one shared password on a public
        // URL is otherwise only as strong as the guesses per second the network
        // allows, which is a lot.
        const wait = loginRetryAfter(request)
        if (wait > 0) {
          return Response.json(
            { error: `Too many attempts. Try again in ${Math.ceil(wait / 60)} min.` },
            { status: 429, headers: { "Retry-After": String(wait) } },
          )
        }

        const body = (await request.json().catch(() => null)) as { password?: string } | null
        if (!(await checkPassword(String(body?.password ?? "")))) {
          recordLoginFailure(request)
          return Response.json({ error: "Wrong password." }, { status: 401 })
        }

        clearLoginFailures(request)
        return Response.json({ ok: true }, { headers: { "Set-Cookie": await loginCookie() } })
      },
    },
  },
})
