import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api, setUnauthorizedHandler } from './api'
import * as auth from './auth'

const SessionContext = createContext(null)

/**
 * Who is signed in, for the whole app.
 *   status: "loading" | "signed-out" | "signed-in"
 *   me:     { user, driver, rating, next } from GET /me (next is the onboarding step, or "ready")
 *   config: public settings from GET /config (sign-in, vehicles, pricing segments, rating tags)
 */
export function SessionProvider({ children }) {
  const [status, setStatus] = useState('loading')
  const [me, setMe] = useState(null)
  const [config, setConfig] = useState(null)
  const [error, setError] = useState(null)

  const refreshMe = useCallback(async () => {
    const data = await api('/me')
    setMe(data)
    setStatus('signed-in')
    return data
  }, [])

  const signOut = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {})
    await auth.signOut()
    setMe(null)
    setStatus('signed-out')
  }, [])

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setMe(null)
      setStatus('signed-out')
    })
    auth
      .loadConfig()
      .then(setConfig)
      .catch((err) => setError(err.message))
    if (!auth.hasSession()) {
      setStatus('signed-out')
      return
    }
    refreshMe().catch(() => setStatus('signed-out'))
  }, [refreshMe])

  const value = useMemo(() => ({ status, me, config, error, refreshMe, signOut }), [status, me, config, error, refreshMe, signOut])
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession() {
  return useContext(SessionContext)
}
