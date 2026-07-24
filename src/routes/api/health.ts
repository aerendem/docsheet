import { createFileRoute } from "@tanstack/react-router"
import { isKeyConfigured } from "../../server/ocr"

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () =>
        Response.json({ ok: true, keyConfigured: isKeyConfigured() }),
    },
  },
})
