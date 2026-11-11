import { useEffect, useRef } from 'react'
import { accessToken } from './auth'

/**
 * Live updates over the API's WebSocket (/ws, proxied by Vite). The app signs in with its first
 * message; the server then sends { type: "refresh" } whenever something on screen changed (ride
 * status, driver position, a chat message, new requests, an admin decision) and the page re-fetches.
 */
export function useLiveUpdates(onRefresh, { onSignedOut } = {}) {
  const handlers = useRef({ onRefresh, onSignedOut })
  handlers.current = { onRefresh, onSignedOut }

  useEffect(() => {
    let socket = null
    let retryTimer = null
    let stopped = false
    let attempt = 0

    async function connect() {
      const token = await accessToken()
      if (stopped || !token) return
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
      socket = new WebSocket(`${protocol}://${window.location.host}/ws`)
      socket.onopen = () => socket.send(JSON.stringify({ type: 'auth', token }))
      socket.onmessage = (event) => {
        let message
        try {
          message = JSON.parse(event.data)
        } catch {
          return
        }
        if (message.type === 'ready') {
          attempt = 0
          // Catch up on anything that changed while disconnected.
          handlers.current.onRefresh?.()
        } else if (message.type === 'refresh') handlers.current.onRefresh?.()
        else if (message.type === 'signed-out') handlers.current.onSignedOut?.()
      }
      socket.onclose = (event) => {
        if (stopped) return
        if (event.code === 4003) return handlers.current.onSignedOut?.()
        // Token expired (4001) or the connection dropped: reconnect with a fresh token, backing off.
        attempt += 1
        retryTimer = setTimeout(connect, Math.min(10_000, 1000 * attempt))
      }
    }

    connect()
    return () => {
      stopped = true
      clearTimeout(retryTimer)
      socket?.close()
    }
  }, [])
}

/** Runs `fn` now and every `ms` while `enabled`. */
export function useInterval(fn, ms, enabled = true) {
  const saved = useRef(fn)
  saved.current = fn
  useEffect(() => {
    if (!enabled) return
    saved.current()
    const timer = setInterval(() => saved.current(), ms)
    return () => clearInterval(timer)
  }, [ms, enabled])
}
