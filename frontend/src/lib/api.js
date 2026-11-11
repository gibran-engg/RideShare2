import { accessToken } from './auth'

/** Errors from the API keep its stable code (e.g. OTP_EXPIRED) and the message to show the user. */
export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

let onUnauthorized = () => {}
export function setUnauthorizedHandler(handler) {
  onUnauthorized = handler
}

/**
 * Calls /api/v1 (proxied to the backend by Vite). JSON in and out; pass `form` for file uploads and
 * `idempotencyKey` so a double tap or retry never books twice.
 */
export async function api(path, { method = 'GET', body, form, idempotencyKey, auth = true } = {}) {
  const headers = { Accept: 'application/json' }
  if (auth) {
    const token = await accessToken()
    if (!token) {
      onUnauthorized()
      throw new ApiError(401, 'UNAUTHENTICATED', 'Please sign in again.')
    }
    headers.Authorization = `Bearer ${token}`
  }
  let payload
  if (form) payload = form
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey

  let res
  try {
    res = await fetch(`/api/v1${path}`, { method, headers, body: payload })
  } catch {
    throw new ApiError(0, 'NETWORK', "Can't reach RideShare. Check your connection.")
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const error = data.error || {}
    if (res.status === 401) onUnauthorized()
    throw new ApiError(res.status, error.code, error.message || 'Something went wrong. Please try again.', error.details)
  }
  return data
}

export const newIdempotencyKey = () => crypto.randomUUID()
