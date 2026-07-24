import { createFileRoute } from "@tanstack/react-router"
import { authRequired, isAuthed } from "../../server/auth"
import { isKeyConfigured } from "../../server/ocr"

export const Route = createFileRoute("/api/session")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        Response.json({
          authRequired: authRequired(),
          authed: await isAuthed(request),
          keyConfigured: isKeyConfigured(),
        }),
    },
  },
})
