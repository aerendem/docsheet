import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import {
  type Lang,
  LANG_LABEL,
  LANGS,
  localeFor,
  type StringKey,
  translate,
} from '../lib/i18n'

const STORAGE_KEY = 'docsheet.lang'

interface LangValue {
  lang: Lang
  locale: string
  setLang: (lang: Lang) => void
  t: (key: StringKey, vars?: Record<string, string | number>) => string
}

const LangContext = createContext<LangValue>({
  lang: 'en',
  locale: 'en-US',
  setLang: () => {},
  t: (key, vars) => translate('en', key, vars),
})

export function useLang() {
  return useContext(LangContext)
}

export function LangProvider({ children }: { children: React.ReactNode }) {
  // Server renders English; the stored choice is applied on mount. The app body
  // only renders after the session request resolves, so the switch lands before
  // there is anything to flash.
  const [lang, setLangState] = useState<Lang>('en')

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY)
      if (stored === 'en' || stored === 'tr') setLangState(stored)
    } catch {
      /* private mode */
    }
  }, [])

  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  const setLang = useCallback((next: Lang) => {
    setLangState(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* private mode — the session still works, it just won't be remembered */
    }
  }, [])

  const value = useMemo<LangValue>(
    () => ({
      lang,
      locale: localeFor(lang),
      setLang,
      t: (key, vars) => translate(lang, key, vars),
    }),
    [lang, setLang],
  )

  return <LangContext.Provider value={value}>{children}</LangContext.Provider>
}

export function LangToggle() {
  const { lang, setLang, t } = useLang()
  const next = LANGS[(LANGS.indexOf(lang) + 1) % LANGS.length]

  return (
    <button
      type="button"
      onClick={() => setLang(next)}
      aria-label={t('lang_switch')}
      title={t('lang_switch')}
      className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[var(--ink-soft)] transition hover:bg-[var(--surface-sunken)] hover:text-[var(--ink)]"
    >
      {LANG_LABEL[lang]}
    </button>
  )
}
