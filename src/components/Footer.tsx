import { useLang } from './lang'

export default function Footer() {
  const { t } = useLang()
  const year = new Date().getFullYear()

  return (
    <footer className="mt-20 border-t border-[var(--line)] pb-14 pt-10 text-[var(--ink-soft)]">
      <div className="page-wrap flex flex-col items-center justify-between gap-2 text-center sm:flex-row sm:text-left">
        <p className="m-0 text-sm">
          &copy; {year} docsheet · {t('footer_note')}
        </p>
        <p className="island-kicker m-0">{t('footer_tag')}</p>
      </div>
    </footer>
  )
}
