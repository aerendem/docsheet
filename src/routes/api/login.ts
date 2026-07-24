import { createFileRoute } from "@tanstack/react-router"
import { checkPassword, loginCookie } from "../../server/auth"

export const Route = createFileRoute("/api/login")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => null)) as { password?: string } | null
        if (!checkPassword(String(body?.password ?? ""))) {
          return Response.json({ error: "Wrong password." }, { status: 401 })
        }
        return Response.json({ ok: true }, { headers: { "Set-Cookie": await loginCookie() } })
      },
    },
  },
})
