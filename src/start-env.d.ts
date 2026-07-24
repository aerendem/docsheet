// Pulls in @tanstack/react-start's ambient module augmentation of
// @tanstack/router-core, which adds the `server` option (API route handlers)
// to createFileRoute. Without this reference the strict type-check doesn't see
// `server` on route options.
/// <reference types="@tanstack/react-start" />
