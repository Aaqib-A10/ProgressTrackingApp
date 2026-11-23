import { Languages } from 'lucide-react'
import { api } from '../../lib/api'
import { Card } from '../ui/Card'
import { useToast } from '../ui/Toast'
import { LANGS, getLang, setLang, t, useLang, type Lang } from '../../lib/i18n'
import { cn } from '../../lib/cn'

/** Settings, "Language": English, Urdu or Arabic. Kept with the account, so it follows the person to any device. */
export function LanguageCard() {
  const { addToast } = useToast()
  const lang = useLang()
  async function pick(l: Lang) {
    const before = getLang()
    setLang(l)
    try { await api.put('/auth/me/language', { language: l }) } catch { setLang(before); addToast({ type: 'error', message: 'Could not save the language. Try again.' }) }
  }
  return (
    <Card title={<span className="flex items-center gap-2"><Languages size={16} className="text-primary" />{t('Language')}</span>} subtitle={t('The language of the menus. Screens not translated yet stay in English.')}>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Language">
        {LANGS.map((l) => (
          <button key={l.key} type="button" role="radio" aria-checked={lang === l.key} onClick={() => void pick(l.key)}
            className={cn('rounded-btn border px-4 py-2 text-body-md font-medium', lang === l.key ? 'border-primary bg-primary-50 text-primary-ink' : 'border-line bg-card text-ink hover:border-line-strong')}>
            {l.label}{l.key !== 'en' && <span className="ms-1.5 text-body-sm font-normal text-ink-muted">({l.english})</span>}
          </button>
        ))}
      </div>
    </Card>
  )
}
