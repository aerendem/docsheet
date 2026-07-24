import { Link } from '@tanstack/react-router'
import { IconGitHub } from './icons'
import ThemeToggle from './ThemeToggle'

export default function Header() {
  return (
    // No padding here: .page-wrap owns the gutter, so the logo lines up with
    // the page content below it at every width.
    <header className="sticky top-0 z-50 border-b border-[var(--line)] bg-[var(--header-bg)]">
      <nav className="page-wrap flex h-14 items-center gap-3 sm:h-16">
        <h2 className="m-0 flex-shrink-0 text-base font-semibold tracking-tight">
          <Link to="/" className="inline-flex items-center gap-2 text-[var(--ink)] no-underline">
            <span className="h-2 w-2 rounded-full" style={{ background: 'var(--accent)' }} />
            docsheet
          </Link>
        </h2>

        <div className="ml-auto flex items-center gap-1">
          <a
            href="https://github.com/aerendem/docsheet"
            target="_blank"
            rel="noreferrer"
            className="hidden rounded-lg p-2 text-[var(--ink-soft)] transition hover:bg-[var(--surface-sunken)] hover:text-[var(--ink)] sm:block"
          >
            <span className="sr-only">docsheet on GitHub</span>
            <IconGitHub size={18} />
          </a>
          <ThemeToggle />
        </div>
      </nav>
    </header>
  )
}
