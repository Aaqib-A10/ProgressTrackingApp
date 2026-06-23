import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { MailCheck } from 'lucide-react'
import { AuthLayout } from './AuthLayout'
import { TextField, PasswordField, PasswordStrength } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../components/ui/Toast'
import { ApiError } from '../../lib/api'
import type { Department } from '../../lib/types'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DEPARTMENTS: { value: Department; label: string }[] = [
  { value: 'ITAD', label: 'ITAD' },
  { value: 'LEAD_GEN', label: 'Lead Generation' },
  { value: 'MARKETING', label: 'Marketing' },
]

const selectClass =
  'h-10 w-full rounded-btn border border-line bg-card px-3 text-body-md text-ink focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10'

export default function Signup() {
  const { signup } = useAuth()
  const { addToast } = useToast()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [department, setDepartment] = useState<Department | ''>('')
  const [error, setError] = useState<string>()
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(undefined)
    if (!name.trim()) return setError('Please enter your full name')
    if (!EMAIL_RE.test(email)) return setError('Please enter a valid work email')
    if (password.length < 8) return setError('Password must be at least 8 characters')
    if (password !== confirm) return setError('Passwords do not match')
    if (!department) return setError('Please select the department you’ll lead')

    setSubmitting(true)
    try {
      await signup({ name, email, password, companyName: companyName || undefined, department })
      setSubmitted(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <AuthLayout
        headline="One platform for every team's progress."
        testimonial={{
          quote: 'PulseTrack transformed how we manage our outbound teams. High visibility, zero friction.',
          name: 'Alex Rivera',
          role: 'TechGen',
        }}
      >
        <div className="flex flex-col items-center text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-success/10 text-success">
            <MailCheck size={28} />
          </span>
          <h1 className="mt-4 text-headline-lg text-ink">Request submitted</h1>
          <p className="mt-2 max-w-sm text-body-md text-ink-muted">
            Your Team Lead account request has been sent to the administrator. You’ll be able to log in once it’s
            approved — we’ll notify you by email.
          </p>
          <Link to="/login" className="mt-6 w-full">
            <Button className="w-full">Back to log in</Button>
          </Link>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      headline="One platform for every team's progress."
      testimonial={{
        quote: 'PulseTrack transformed how we manage our outbound teams. High visibility, zero friction.',
        name: 'Alex Rivera',
        role: 'TechGen',
      }}
    >
      <h1 className="text-headline-lg text-ink">Register as a Team Lead</h1>
      <p className="mt-1 text-body-md text-ink-muted">
        Team Leads request access here. Once an admin approves you, you can invite your team members.
      </p>

      <Button
        variant="secondary"
        className="mt-5 w-full"
        onClick={() => addToast({ type: 'info', message: 'Google sign-up is coming in a later phase.' })}
      >
        Sign up with Google
      </Button>

      <div className="my-4 flex items-center gap-3 text-body-sm text-ink-muted">
        <span className="h-px flex-1 bg-line" /> or register with email <span className="h-px flex-1 bg-line" />
      </div>

      <form onSubmit={onSubmit} className="space-y-3.5" noValidate>
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Full name" placeholder="Alex Rivera" value={name} onChange={(e) => setName(e.target.value)} />
          <TextField label="Work email" type="email" placeholder="alex@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <PasswordField label="Password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          <PasswordField label="Confirm password" placeholder="••••••••" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
        </div>
        <PasswordStrength value={password} />
        <TextField label="Company name" placeholder="TechGen Inc." value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
        <div>
          <label className="mb-1 block text-body-sm font-semibold text-ink">Department you’ll lead</label>
          <select className={selectClass} value={department} onChange={(e) => setDepartment(e.target.value as Department)}>
            <option value="">Select department</option>
            {DEPARTMENTS.map((d) => (
              <option key={d.value} value={d.value}>{d.label}</option>
            ))}
          </select>
        </div>

        {error && <p className="rounded-btn bg-danger/10 px-3 py-2 text-body-sm text-danger">{error}</p>}

        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? 'Submitting request…' : 'Request Team Lead access'}
        </Button>
      </form>

      <p className="mt-4 rounded-btn bg-bg px-3 py-2 text-center text-body-sm text-ink-muted">
        Not a Team Lead? Employees are added by their Team Lead — ask yours for an invite.
      </p>

      <p className="mt-4 text-center text-body-sm text-ink-muted">
        Already have an account?{' '}
        <Link to="/login" className="font-semibold text-primary hover:underline">Log in</Link>
      </p>
    </AuthLayout>
  )
}
