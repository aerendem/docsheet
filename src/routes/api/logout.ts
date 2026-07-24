import { createFileRoute } from "@tanstack/react-router"
import { logoutCookie } from "../../server/auth"

export const Route = createFileRoute("/api/logout")({
  server: {
    handlers: {
      POST: async () =>
        Response.json({ ok: true }, { headers: { "Set-Cookie": logoutCookie() } }),
    },
  },
})
