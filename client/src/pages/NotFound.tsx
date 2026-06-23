import { Link } from 'react-router-dom'
import { Button } from '../components/ui/Button'

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-bg p-6 text-center">
      <p className="text-display-lg text-primary">404</p>
      <h1 className="mt-2 text-headline-lg text-ink">Page not found</h1>
      <p className="mt-1 max-w-sm text-body-md text-ink-muted">
        The page you&apos;re looking for doesn&apos;t exist or has moved.
      </p>
      <Link to="/" className="mt-6">
        <Button>Back to dashboard</Button>
      </Link>
    </div>
  )
}
