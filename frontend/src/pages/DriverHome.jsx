import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import MapView from '../components/MapView'
import Chat, { UnreadWatcher } from '../components/Chat'
import RateRide from '../components/RateRide'
import { Avatar, CancelDialog, ErrorText, Menu, RatingText, RideProgress, SosDialog, TopBar } from '../components/ui'
import { api } from '../lib/api'
import { useInterval, useLiveUpdates } from '../lib/live'
import { useSession } from '../lib/session'
import { DEFAULT_CENTER, directionsUrl, firstName, pricingBadge, rupees, shortPlace } from '../lib/format'

// Send the driver's position at most this often (riders follow it on their map).
const LOCATION_EVERY_MS = 8000

/** The driver's app: go online → see and accept nearby requests → pickup with OTP → trip → rate. */
export default function DriverHome() {
  const { me, refreshMe } = useSession()
  const [menuOpen, setMenuOpen] = useState(false)
  const [online, setOnline] = useState(Boolean(me.driver?.isOnline))
  const [location, setLocation] = useState(null)
  const [demoLocation, setDemoLocation] = useState(false)
  const [stats, setStats] = useState(null)
  const [requests, setRequests] = useState([])
  const [ride, setRide] = useState(null)
  const [rateRide, setRateRide] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [chatOpen, setChatOpen] = useState(false)
  const [unread, setUnread] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [sosOpen, setSosOpen] = useState(false)
  const [otp, setOtp] = useState('')
  const [notice, setNotice] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const lastSent = useRef(0)
  const lastRideId = useRef(null)

  const load = useCallback(async () => {
    try {
      const [{ ride: current }, earnings] = await Promise.all([api('/rides/active'), api('/driver/earnings')])
      setStats(earnings)
      setRide(current)
      if (current) {
        lastRideId.current = current.id
        setRequests([])
        return
      }
      if (lastRideId.current) {
        const { ride: finished } = await api(`/rides/${lastRideId.current}`).catch(() => ({ ride: null }))
        lastRideId.current = null
        if (finished?.status === 'completed' && !finished.myRating) setRateRide(finished)
        else if (finished?.status === 'cancelled') setNotice('The rider cancelled the ride.')
      }
      if (online) setRequests((await api('/driver/requests')).rides)
    } catch (err) {
      setError(err.message)
    }
  }, [online])

  useEffect(() => {
    load()
  }, [load])

  useLiveUpdates(() => {
    load()
    refreshMe().catch(() => {})
    setRefreshKey((key) => key + 1)
  })
  // Hours online keep counting even when nothing else changes.
  useInterval(() => api('/driver/earnings').then(setStats).catch(() => {}), 60000)

  // ---- Location ----

  const sendLocation = useCallback((point, force = false) => {
    if (!force && Date.now() - lastSent.current < LOCATION_EVERY_MS) return
    lastSent.current = Date.now()
    api('/driver/location', { method: 'POST', body: point }).catch(() => {})
  }, [])

  function handleLocate(point) {
    setLocation(point)
    setDemoLocation(false)
    sendLocation(point)
  }

  // A desktop browser often has no location: use the city centre so the demo still works.
  function handleLocateError() {
    if (location) return
    setDemoLocation(true)
    setLocation(DEFAULT_CENTER)
    sendLocation(DEFAULT_CENTER, true)
  }

  async function toggleOnline() {
    setBusy(true)
    setError(null)
    try {
      if (!online && location) await api('/driver/location', { method: 'POST', body: location })
      const { driver } = await api('/driver/online', { method: 'POST', body: { online: !online } })
      setOnline(driver.isOnline)
      await refreshMe()
      if (!driver.isOnline) setRequests([])
      else setRequests((await api('/driver/requests')).rides)
      setStats(await api('/driver/earnings'))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  // ---- Trip steps ----

  async function step(rideId, path, body) {
    setBusy(true)
    setError(null)
    try {
      const data = await api(`/rides/${rideId}/${path}`, { method: 'POST', body })
      if (path === 'accept') lastRideId.current = rideId
      setRide(data.ride)
      if (path === 'complete') {
        lastRideId.current = null
        setRateRide(data.ride)
        setRide(null)
        setStats(await api('/driver/earnings'))
      }
      setOtp('')
      return data
    } catch (err) {
      setError(err.message)
      if (err.code === 'RIDE_UNAVAILABLE') load()
      return null
    } finally {
      setBusy(false)
    }
  }

  async function release(reason) {
    const result = await step(ride.id, 'cancel', { reason })
    setCancelOpen(false)
    if (result) {
      lastRideId.current = null
      setRide(null)
      load()
    }
  }

  // ---- Map ----

  const markers = useMemo(() => {
    if (ride) {
      return [
        { id: 'pickup', kind: 'pickup', title: 'Pickup', ...ride.pickup },
        { id: 'drop', kind: 'drop', title: 'Drop', ...ride.drop },
      ]
    }
    return requests.map((request) => ({ id: request.id, kind: 'request', title: `${rupees(request.fare)} · ${shortPlace(request.pickup.name)}`, ...request.pickup }))
  }, [ride, requests])

  const fit = useMemo(() => {
    if (ride && location && (ride.status === 'accepted' || ride.status === 'arrived')) return [location, ride.pickup]
    if (ride) return [ride.pickup, ride.drop]
    if (requests.length && location) return [location, ...requests.slice(0, 5).map((r) => r.pickup)]
    return null
  }, [ride, requests, location])

  const rider = ride?.rider
  const chatOpenable = ride && ['accepted', 'arrived', 'in_progress'].includes(ride.status)

  return (
    <div className="relative h-full">
      <MapView markers={markers} route={ride?.route || null} fit={fit} onLocate={handleLocate} onLocateError={handleLocateError} />
      <TopBar onMenu={() => setMenuOpen(true)} />
      <Menu open={menuOpen} onClose={() => setMenuOpen(false)} />

      {rateRide ? (
        <RateRide ride={rateRide} onDone={() => setRateRide(null)} />
      ) : ride ? (
        <div className="sheet">
          <RideProgress status={ride.status} />
          <div className="flex items-center gap-3">
            <Avatar name={rider?.name} />
            <div className="flex-1">
              <p className="font-semibold">{rider?.name}</p>
              <RatingText rating={rider?.rating} />
            </div>
            <div className="text-right">
              <p className="text-lg font-semibold">{rupees(ride.fare)}</p>
              <p className="text-xs text-neutral-500">{ride.paymentMethod === 'cash' ? 'Cash' : ride.paymentMethod.toUpperCase()}</p>
            </div>
          </div>
          {pricingBadge(ride.pricing) && <p className="chip mt-2 bg-amber-100 text-amber-800">{pricingBadge(ride.pricing)}</p>}

          <div className="mt-3 space-y-1 text-sm">
            <p>
              <i className="ri-checkbox-blank-circle-fill mr-2 text-[10px] text-green-600" />
              {ride.pickup.name}
            </p>
            <p>
              <i className="ri-checkbox-blank-fill mr-2 text-[10px]" />
              {ride.drop.name}
            </p>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2">
            <a className="btn-secondary flex-col gap-0 py-2 text-xs" href={directionsUrl(ride.status === 'in_progress' ? ride.drop : ride.pickup)} target="_blank" rel="noreferrer">
              <i className="ri-navigation-line text-xl" />
              Navigate
            </a>
            <button
              className="btn-secondary relative flex-col gap-0 py-2 text-xs"
              onClick={() => {
                setChatOpen(true)
                setUnread(false)
              }}
            >
              <i className="ri-chat-3-line text-xl" />
              Chat
              {unread && <span className="absolute right-3 top-2 h-2.5 w-2.5 rounded-full bg-red-600" aria-label="New message" />}
            </button>
            <button className="btn-secondary flex-col gap-0 py-2 text-xs text-red-600" onClick={() => setSosOpen(true)}>
              <i className="ri-alarm-warning-line text-xl" />
              SOS
            </button>
          </div>

          {ride.status === 'accepted' && (
            <button className="btn-primary mt-4 w-full" disabled={busy} onClick={() => step(ride.id, 'arrived')}>
              I&apos;ve arrived at pickup
            </button>
          )}
          {ride.status === 'arrived' && (
            <form
              className="mt-4"
              onSubmit={(e) => {
                e.preventDefault()
                step(ride.id, 'start', { otp })
              }}
            >
              <label className="label" htmlFor="otp">
                Ask {firstName(rider?.name)} for the 4-digit OTP in their app
              </label>
              <div className="flex gap-2">
                <input
                  id="otp"
                  className="input text-center font-mono text-2xl tracking-[0.5em]"
                  inputMode="numeric"
                  maxLength={4}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                />
                <button className="btn-success shrink-0" disabled={busy || otp.length !== 4}>
                  Start trip
                </button>
              </div>
              <p className="mt-1 text-xs text-neutral-500">Codes expire after 15 minutes; after 3 wrong tries the rider gets a new one.</p>
            </form>
          )}
          {ride.status === 'in_progress' && (
            <button className="btn-success mt-4 w-full" disabled={busy} onClick={() => step(ride.id, 'complete')}>
              Complete trip at {shortPlace(ride.drop.name)}
            </button>
          )}
          <ErrorText error={error} />
          {['accepted', 'arrived'].includes(ride.status) && (
            <button className="mt-3 w-full py-2 text-sm font-medium text-red-600" onClick={() => setCancelOpen(true)}>
              Can&apos;t make it? Release ride
            </button>
          )}
        </div>
      ) : (
        <div className="sheet">
          <div className="grid grid-cols-4 gap-2 text-center">
            <Stat label="Today" value={stats ? rupees(stats.earnings.today.amount) : '–'} />
            <Stat label="Trips today" value={stats ? stats.earnings.today.trips : '–'} />
            <Stat label="Hours online" value={stats ? stats.hoursOnlineToday : '–'} />
            <Stat label="Rating" value={stats?.rating.count ? `${stats.rating.average.toFixed(1)}★` : 'New'} />
          </div>
          <button className={`mt-4 w-full ${online ? 'btn-secondary' : 'btn-success'}`} disabled={busy} onClick={toggleOnline}>
            <span className={`h-2.5 w-2.5 rounded-full ${online ? 'bg-green-500' : 'bg-white'}`} />
            {online ? "You're online · Go offline" : 'Go online'}
          </button>
          {demoLocation && <p className="mt-2 text-xs text-amber-700">Location is off: using a demo position in Mumbai so riders can find you.</p>}
          {notice && <p className="mt-2 rounded-lg bg-neutral-100 px-3 py-2 text-sm">{notice}</p>}
          <ErrorText error={error} />

          {online && (
            <div className="mt-5">
              <h3 className="mb-2 font-semibold">Ride requests near you</h3>
              {!requests.length && <p className="text-sm text-neutral-500">No requests right now. New ones appear here and on the map.</p>}
              <div className="space-y-2">
                {requests.map((request) => (
                  <div key={request.id} className="rounded-2xl border-2 border-neutral-100 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{shortPlace(request.pickup.name)}</p>
                        <p className="truncate text-sm text-neutral-500">to {shortPlace(request.drop.name)}</p>
                        <p className="text-xs text-neutral-500">
                          {request.pickupDistanceKm} km away · {request.distanceKm} km trip · <RatingText rating={request.rider.rating} />
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-lg font-semibold">{rupees(request.fare)}</p>
                        {pricingBadge(request.pricing) && <p className="text-xs text-amber-700">{pricingBadge(request.pricing)}</p>}
                      </div>
                    </div>
                    <button className="btn-primary mt-2 w-full py-2" disabled={busy} onClick={() => step(request.id, 'accept')}>
                      Accept
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {chatOpen && ride && (
        <Chat rideId={ride.id} role="driver" otherName={firstName(rider?.name)} canSend={chatOpenable} refreshKey={refreshKey} onClose={() => setChatOpen(false)} />
      )}
      {!chatOpen && chatOpenable && <UnreadWatcher rideId={ride.id} refreshKey={refreshKey} onUnread={() => setUnread(true)} />}
      {cancelOpen && ride && <CancelDialog role="driver" fee={0} busy={busy} onClose={() => setCancelOpen(false)} onConfirm={release} />}
      {sosOpen && ride && <SosDialog alerted={Boolean(ride.sosAt)} onClose={() => setSosOpen(false)} onAlert={() => step(ride.id, 'sos')} />}
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div className="rounded-xl bg-neutral-50 px-1 py-2">
      <p className="font-semibold">{value}</p>
      <p className="text-[11px] text-neutral-500">{label}</p>
    </div>
  )
}
