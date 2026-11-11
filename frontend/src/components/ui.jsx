import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useSession } from '../lib/session'

/** A circle with the person's initials (no stock profile photos). */
export function Avatar({ name, size = 'h-11 w-11 text-base' }) {
  const initials =
    (name || '?')
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase() || '?'
  return <div className={`${size} flex shrink-0 items-center justify-center rounded-full bg-neutral-800 font-semibold text-white`}>{initials}</div>
}

/** "4.8 ★ (12)" or "New" when nobody has rated them yet. */
export function RatingText({ rating }) {
  if (!rating || !rating.count) return <span className="text-sm text-neutral-500">New</span>
  return (
    <span className="inline-flex items-center gap-0.5 text-sm font-medium">
      <i className="ri-star-fill text-amber-500" />
      {rating.average.toFixed(1)} <span className="font-normal text-neutral-500">({rating.count})</span>
    </span>
  )
}

export function Stars({ value, onChange, size = 'text-3xl' }) {
  return (
    <div className="flex justify-center gap-1" role="radiogroup" aria-label="Rating">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          role="radio"
          aria-checked={value === star}
          aria-label={`${star} star${star > 1 ? 's' : ''}`}
          onClick={() => onChange?.(star)}
          className={`${size} ${star <= value ? 'text-amber-500' : 'text-neutral-300'}`}
        >
          <i className="ri-star-fill" />
        </button>
      ))}
    </div>
  )
}

const STEPS = [
  { status: 'requested', label: 'Finding' },
  { status: 'accepted', label: 'On the way' },
  { status: 'arrived', label: 'Arrived' },
  { status: 'in_progress', label: 'On trip' },
  { status: 'completed', label: 'Done' },
]

/** Finding driver → on the way → arrived → on trip → done. */
export function RideProgress({ status }) {
  const current = STEPS.findIndex((step) => step.status === status)
  return (
    <ol className="mb-4 flex items-center gap-1" aria-label="Ride progress">
      {STEPS.map((step, index) => (
        <li key={step.status} className="flex-1">
          <div className={`h-1.5 rounded-full ${index <= current ? 'bg-black' : 'bg-neutral-200'}`} />
          <p className={`mt-1 text-center text-[11px] ${index === current ? 'font-semibold text-black' : 'text-neutral-400'}`}>{step.label}</p>
        </li>
      ))}
    </ol>
  )
}

export function ErrorText({ error }) {
  if (!error) return null
  return (
    <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
      {error}
    </p>
  )
}

/** Top bar: menu button and the RideShare wordmark, over the map. */
export function TopBar({ onMenu }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center gap-3 p-4">
      <button
        onClick={onMenu}
        aria-label="Menu"
        className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full bg-white text-xl shadow-md"
      >
        <i className="ri-menu-line" />
      </button>
      <span className="rounded-full bg-white/90 px-3 py-1 text-lg font-bold tracking-tight shadow-sm">RideShare</span>
    </div>
  )
}

/** Slide-in menu: who you are, history, saved places, sign out. */
export function Menu({ open, onClose }) {
  const { me, signOut } = useSession()
  if (!open || !me) return null
  const isDriver = me.user.role === 'driver'
  return (
    <div className="absolute inset-0 z-50 flex" role="dialog" aria-label="Menu">
      <div className="h-full w-4/5 max-w-xs bg-white p-5 shadow-2xl">
        <div className="mb-6 flex items-center gap-3">
          <Avatar name={me.user.name} />
          <div>
            <p className="font-semibold">{me.user.name}</p>
            <p className="text-sm capitalize text-neutral-500">
              {me.user.role} · <RatingText rating={me.rating} />
            </p>
          </div>
        </div>
        <nav className="flex flex-col gap-1">
          <Link to="/home" onClick={onClose} className="rounded-lg px-3 py-3 hover:bg-neutral-100">
            <i className="ri-map-2-line mr-3" />
            {isDriver ? 'Drive' : 'Book a ride'}
          </Link>
          <Link to="/history" onClick={onClose} className="rounded-lg px-3 py-3 hover:bg-neutral-100">
            <i className="ri-history-line mr-3" />
            {isDriver ? 'Trips & earnings' : 'Your rides'}
          </Link>
          {!isDriver && (
            <Link to="/places" onClick={onClose} className="rounded-lg px-3 py-3 hover:bg-neutral-100">
              <i className="ri-bookmark-line mr-3" />
              Saved places
            </Link>
          )}
          <button onClick={signOut} className="rounded-lg px-3 py-3 text-left text-red-600 hover:bg-neutral-100">
            <i className="ri-logout-box-r-line mr-3" />
            Sign out
          </button>
        </nav>
      </div>
      <button className="flex-1 bg-black/40" aria-label="Close menu" onClick={onClose} />
    </div>
  )
}

const RIDER_REASONS = ['Driver is taking too long', 'Driver asked me to cancel', 'Booked by mistake', 'Plans changed', 'Found another ride']
const DRIVER_REASONS = ["Rider isn't answering", 'Pickup is too far', 'Vehicle problem', 'Rider asked me to cancel']

/** Pick a reason, then confirm; warns the rider about the fee once the driver has arrived. */
export function CancelDialog({ role, fee, onConfirm, onClose, busy }) {
  const reasons = role === 'driver' ? DRIVER_REASONS : RIDER_REASONS
  const [reason, setReason] = useState(reasons[0])
  return (
    <div className="absolute inset-0 z-50 flex items-end bg-black/40" role="dialog" aria-label="Cancel ride">
      <div className="w-full rounded-t-3xl bg-white p-5">
        <h3 className="mb-1 text-xl font-semibold">{role === 'driver' ? 'Release this ride?' : 'Cancel this ride?'}</h3>
        {role === 'driver' && <p className="mb-3 text-sm text-neutral-600">The rider will be matched with another driver.</p>}
        {fee > 0 && <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">Your driver has arrived, so a ₹{fee} cancellation fee applies.</p>}
        <div className="mb-4 flex flex-col gap-2">
          {reasons.map((item) => (
            <label key={item} className="flex items-center gap-3 rounded-xl border border-neutral-200 px-3 py-3">
              <input type="radio" name="reason" checked={reason === item} onChange={() => setReason(item)} />
              {item}
            </label>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button className="btn-secondary" onClick={onClose}>
            Keep ride
          </button>
          <button className="btn-danger" disabled={busy} onClick={() => onConfirm(reason)}>
            {role === 'driver' ? 'Release' : 'Cancel ride'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** SOS: alerts RideShare support and offers to call 112. */
export function SosDialog({ onAlert, onClose, alerted }) {
  return (
    <div className="absolute inset-0 z-50 flex items-end bg-black/50" role="alertdialog" aria-label="Emergency">
      <div className="w-full rounded-t-3xl bg-white p-5">
        <h3 className="mb-2 text-xl font-semibold text-red-600">
          <i className="ri-alarm-warning-fill mr-2" />
          Emergency help
        </h3>
        <p className="mb-4 text-sm text-neutral-600">
          {alerted ? 'RideShare safety has been alerted with your trip and location.' : 'Alert RideShare safety with your trip details and live location, or call emergency services.'}
        </p>
        <div className="flex flex-col gap-2">
          <a href="tel:112" className="btn-danger">
            <i className="ri-phone-fill" /> Call 112
          </a>
          {!alerted && (
            <button className="btn-primary" onClick={onAlert}>
              Alert RideShare safety
            </button>
          )}
          <button className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
