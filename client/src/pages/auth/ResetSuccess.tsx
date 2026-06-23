import { Link } from 'react-router-dom'
import { CheckCircle2 } from 'lucide-react'
import { AuthLayout } from './AuthLayout'
import { Button } from '../../components/ui/Button'

export default function ResetSuccess() {
  return (
    <AuthLayout headline="You're all set.">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-success/10 text-success">
        <CheckCircle2 size={28} />
      </div>
      <h1 className="text-headline-lg text-ink">Password reset</h1>
      <p className="mt-1 text-body-md text-ink-muted">
        Your password has been updated successfully. You can now log in with your new password.
      </p>
      <Link to="/login" className="mt-6 block">
        <Button className="w-full">Back to log in</Button>
      </Link>
    </AuthLayout>
  )
}
