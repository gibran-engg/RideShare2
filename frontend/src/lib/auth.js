/**
 * Sign-in with Auth0 (or the dev sign-in that imitates it): OAuth 2.0 Authorization Code + PKCE.
 *
 * The browser goes to Auth0's login page (Google, or email + password), comes back to /auth with a
 * code, and swaps it (with the PKCE verifier only this tab knows) for a JWT access token that every
 * API call carries. Tokens live in sessionStorage, so each tab has its own sign-in: a rider in one
 * tab and a driver in another.
 */

const TOKENS_KEY = 'rideshare.tokens'
const PENDING_KEY = 'rideshare.signin'
// offline_access asks for a refresh token, so the tab stays signed in after the access token expires.
const SCOPES = 'openid profile email offline_access'
// Refresh a minute before the access token actually expires.
const EXPIRY_MARGIN_MS = 60 * 1000

export const redirectUri = () => `${window.location.origin}/auth`

let configRequest = null
/** Public settings from the API: which Auth0 tenant, application and API audience to use, plus pricing etc. */
export function loadConfig() {
  configRequest ??= fetch('/api/v1/config')
    .then((res) => {
      if (!res.ok) throw new Error("Can't reach the RideShare server. Is the backend running?")
      return res.json()
    })
    .catch((err) => {
      configRequest = null
      throw err
    })
  return configRequest
}

const discoveries = new Map()
/** The issuer's endpoints (authorize, token, revoke) from its OpenID configuration. */
function discover(issuer) {
  const key = issuer.replace(/\/+$/, '')
  if (!discoveries.has(key)) {
    discoveries.set(
      key,
      fetch(`${key}/.well-known/openid-configuration`)
        .then((res) => {
          if (!res.ok) throw new Error('The sign-in service is unreachable.')
          return res.json()
        })
        .catch((err) => {
          discoveries.delete(key)
          throw err
        }),
    )
  }
  return discoveries.get(key)
}

function base64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function randomString(bytes = 32) {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)))
}

async function pkcePair() {
  const verifier = randomString(32)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return { verifier, challenge: base64url(digest) }
}

/**
 * Go to the login page. `connection: 'google-oauth2'` skips straight to Google on Auth0;
 * `signup: true` opens Auth0's sign-up form (email + password) instead of log-in.
 */
export async function startSignIn({ connection, signup } = {}) {
  const { auth } = await loadConfig()
  const endpoints = await discover(auth.issuer)
  const { verifier, challenge } = await pkcePair()
  const state = randomString(16)
  sessionStorage.setItem(PENDING_KEY, JSON.stringify({ verifier, state, issuer: auth.issuer }))

  const url = new URL(endpoints.authorization_endpoint)
  const params = {
    response_type: 'code',
    client_id: auth.clientId,
    redirect_uri: redirectUri(),
    scope: SCOPES,
    audience: auth.audience,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    // Always show the login form, so one browser can switch between rider and driver accounts.
    prompt: 'login',
  }
  if (auth.provider === 'auth0' && connection) params.connection = connection
  if (auth.provider === 'auth0' && signup) params.screen_hint = 'signup'
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  window.location.assign(url.toString())
}

function saveTokens(response, previousRefreshToken = null) {
  const tokens = {
    accessToken: response.access_token,
    expiresAt: Date.now() + (response.expires_in || 3600) * 1000,
    // Auth0 rotates refresh tokens: keep the new one when it sends one.
    refreshToken: response.refresh_token || previousRefreshToken,
  }
  sessionStorage.setItem(TOKENS_KEY, JSON.stringify(tokens))
  return tokens
}

function storedTokens() {
  try {
    return JSON.parse(sessionStorage.getItem(TOKENS_KEY) || 'null')
  } catch {
    return null
  }
}

export function hasSession() {
  return Boolean(storedTokens())
}

async function tokenRequest(tokenEndpoint, body) {
  const res = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const error = new Error(data.error_description || 'Sign-in failed. Please try again.')
    error.code = data.error
    throw error
  }
  return data
}

/** Called on /auth: checks the state, then swaps the code for tokens. */
export async function finishSignIn(search) {
  const params = new URLSearchParams(search)
  const pending = JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null')
  sessionStorage.removeItem(PENDING_KEY)

  if (params.get('error')) throw new Error(params.get('error_description') || 'Sign-in was cancelled.')
  if (!pending || !params.get('code') || params.get('state') !== pending.state) {
    throw new Error('This sign-in link is no longer valid. Please sign in again.')
  }
  const { auth } = await loadConfig()
  const endpoints = await discover(pending.issuer)
  const response = await tokenRequest(endpoints.token_endpoint, {
    grant_type: 'authorization_code',
    client_id: auth.clientId,
    code: params.get('code'),
    redirect_uri: redirectUri(),
    code_verifier: pending.verifier,
  })
  saveTokens(response)
}

let refreshing = null
/** A valid access token: the stored one, or a new one from the refresh token. null when signed out. */
export async function accessToken() {
  const current = storedTokens()
  if (!current) return null
  if (current.expiresAt - EXPIRY_MARGIN_MS > Date.now()) return current.accessToken
  if (!current.refreshToken) return null

  // Several requests may notice the expiry at once; refresh only once.
  refreshing ??= (async () => {
    try {
      const { auth } = await loadConfig()
      const endpoints = await discover(auth.issuer)
      const response = await tokenRequest(endpoints.token_endpoint, {
        grant_type: 'refresh_token',
        client_id: auth.clientId,
        refresh_token: current.refreshToken,
      })
      return saveTokens(response, current.refreshToken).accessToken
    } catch (err) {
      // Refresh token revoked or expired: sign in again.
      if (err.code === 'invalid_grant') sessionStorage.removeItem(TOKENS_KEY)
      return null
    } finally {
      refreshing = null
    }
  })()
  return refreshing
}

/** Revokes the refresh token (best effort) and forgets this tab's tokens. */
export async function signOut() {
  const current = storedTokens()
  sessionStorage.removeItem(TOKENS_KEY)
  if (!current?.refreshToken) return
  try {
    const { auth } = await loadConfig()
    const endpoints = await discover(auth.issuer)
    const revoke = endpoints.revocation_endpoint || `${auth.issuer.replace(/\/+$/, '')}/oauth/revoke`
    await fetch(revoke, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: auth.clientId, token: current.refreshToken }),
    })
  } catch {
    // The tokens are already gone from this tab; an unrevoked refresh token simply expires.
  }
}
