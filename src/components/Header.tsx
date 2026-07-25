import { Link } from '@tanstack/react-router'
import { IconColumns, IconGitHub } from './icons'
import { LangToggle, useLang } from './lang'
import ThemeToggle from './ThemeToggle'

export default function Header() {
  const { t } = useLang()

  return (
    // No padding here: .page-wrap owns the gutter, so the logo lines up with
    // the page content below it at every width.
    <header className="sticky top-0 z-50 border-b border-[var(--line)] bg-[var(--header-bg)]">
      <nav className="page-wrap flex h-14 items-center gap-3 sm:h-16">
        <h2 className="m-0 flex-shrink-0">
          <Link
            to="/"
            className="group inline-flex items-center gap-2 text-[var(--ink)] no-underline"
          >
            <span
              className="grid h-6 w-6 place-items-center rounded-[7px] transition"
              style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
            >
              <IconColumns size={14} />
            </span>
            {/* Tight, heavy set with the accent full stop — the same device the
                headline uses, so the mark and the page read as one voice. */}
            <span className="display-title text-[15px] font-extrabold tracking-[-0.035em]">
              docsheet<span style={{ color: 'var(--accent)' }}>.</span>
            </span>
          </Link>
        </h2>

        <div className="ml-auto flex items-center gap-1">
          <a
            href="https://github.com/aerendem/docsheet"
            target="_blank"
            rel="noreferrer"
            className="hidden rounded-lg p-2 text-[var(--ink-soft)] transition hover:bg-[var(--surface-sunken)] hover:text-[var(--ink)] sm:block"
          >
            <span className="sr-only">{t('nav_github')}</span>
            <IconGitHub size={18} />
          </a>
          <LangToggle />
          <ThemeToggle />
        </div>
      </nav>
    </header>
  )
}
