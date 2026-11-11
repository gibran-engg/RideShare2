import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { finishSignIn } from '../lib/auth'
import { useSession } from '../lib/session'

/** Auth0 (or the dev sign-in) sends the browser back here with a code to swap for tokens. */
export default function AuthCallback() {
  const { refreshMe } = useSession()
  const navigate = useNavigate()
  const [error, setError] = useState(null)
  const started = useRef(false)

  useEffect(() => {
    // The code works once; React may run effects twice in development.
    if (started.current) return
    started.current = true
    finishSignIn(window.location.search)
      .then(refreshMe)
      .then((me) => navigate(me.next === 'ready' ? '/home' : '/onboarding', { replace: true }))
      .catch((err) => setError(err.message))
  }, [navigate, refreshMe])

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      {error ? (
        <>
          <p className="text-lg font-semibold">Sign-in didn&apos;t work</p>
          <p className="text-neutral-600">{error}</p>
          <Link to="/" className="btn-primary">
            Try again
          </Link>
        </>
      ) : (
        <p className="text-neutral-600">Signing you in…</p>
      )}
    </div>
  )
}
