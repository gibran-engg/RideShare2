import { useState } from 'react'
import { startSignIn } from '../lib/auth'
import { useSession } from '../lib/session'
import { ErrorText } from '../components/ui'

/** First screen: sign in with Google, or with email and password (or create an account), all through Auth0. */
export default function Welcome() {
  const { config, error: configError } = useSession()
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const isDev = config?.auth.provider === 'mock'

  async function signIn(options) {
    setBusy(true)
    setError(null)
    try {
      await startSignIn(options)
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full flex-col bg-black text-white">
      <div className="flex flex-1 flex-col justify-center px-8">
        <p className="text-5xl font-bold tracking-tight">RideShare</p>
        <p className="mt-3 text-lg text-neutral-300">Rides across the city in minutes. Bike, auto or car.</p>
        <ul className="mt-8 space-y-2 text-sm text-neutral-400">
          <li>
            <i className="ri-shield-check-line mr-2" />
            OTP-verified pickups, live trip sharing and SOS
          </li>
          <li>
            <i className="ri-chat-3-line mr-2" />
            Chat with your driver without sharing your number
          </li>
          <li>
            <i className="ri-steering-2-line mr-2" />
            Drive with us: get verified and go online
          </li>
        </ul>
      </div>
      <div className="space-y-3 rounded-t-3xl bg-white p-6 text-black">
        <button className="btn-primary w-full" disabled={busy || !config} onClick={() => signIn({ connection: 'google-oauth2' })}>
          <i className="ri-google-fill" /> Continue with Google
        </button>
        <button className="btn-secondary w-full" disabled={busy || !config} onClick={() => signIn()}>
          <i className="ri-mail-line" /> Sign in with email
        </button>
        <button className="w-full py-2 text-sm font-medium underline" disabled={busy || !config} onClick={() => signIn({ signup: true })}>
          New here? Create an account
        </button>
        {isDev && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Development mode: Auth0 isn&apos;t configured, so these open the dev sign-in, where you pick a test account. Set AUTH0_* in Backend/.env for real Google and
            email sign-in.
          </p>
        )}
        <ErrorText error={error || configError} />
      </div>
    </div>
  )
}
