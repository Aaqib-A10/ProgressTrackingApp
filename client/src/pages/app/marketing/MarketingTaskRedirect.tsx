import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../../lib/auth'
import { getTask } from '../../../lib/marketingApi'

/**
 * The Marketing Board was retired. Old links to it (in emails, notifications and My Tasks:
 * /app/marketing/board?task=<id>) land here and go on to where that kind of work now lives.
 */
const HOME: Record<string, string> = { SOCIAL: '/app/marketing/planner', CONTENT: '/app/marketing/content', SEO: '/app/marketing/seo' }
const BY_SUB: Record<string, string> = { social: '/app/marketing/planner', content: '/app/marketing/content', seo: '/app/marketing/seo', ads: '/app/marketing/ads', email: '/app/marketing/email' }

export default function MarketingTaskRedirect() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  useEffect(() => {
    const fallback = (user?.subDepartment && BY_SUB[user.subDepartment]) || '/app/marketing/plan'
    const id = params.get('task')
    if (!id) { navigate(fallback, { replace: true }); return }
    getTask(id)
      .then((r) => navigate(HOME[r.task.discipline] ?? fallback, { replace: true }))
      .catch(() => navigate(fallback, { replace: true }))
  }, [params, navigate, user?.subDepartment])
  return <p className="py-10 text-center text-body-md text-ink-muted">Opening…</p>
}
