// Next.js calls this once per worker on boot.
//
// We intentionally do *not* import @sentry/nextjs here — Turbopack resolves
// dynamic imports at build time, so a missing dep would fail the build.
// To enable Sentry: install `@sentry/nextjs` (once it supports Next 16) and
// wire its `register` / `onRequestError` exports here directly. See the
// README's "Observability" section.

export async function register(): Promise<void> {
  // intentional no-op
}
