import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import MapView from '../components/MapView'
import PlaceSearch from '../components/PlaceSearch'
import Chat, { UnreadWatcher } from '../components/Chat'
import RateRide from '../components/RateRide'
import { Avatar, CancelDialog, ErrorText, Menu, RatingText, RideProgress, SosDialog, TopBar } from '../components/ui'
import { api, newIdempotencyKey } from '../lib/api'
import { useInterval, useLiveUpdates } from '../lib/live'
import { useSession } from '../lib/session'
import { DEFAULT_CENTER, VEHICLE_ICONS, firstName, pricingBadge, rupees, shortPlace, vehicleText } from '../lib/format'

const PAYMENT_METHODS = [
  ['cash', 'ri-money-rupee-circle-line', 'Cash'],
  ['upi', 'ri-qr-code-line', 'UPI'],
  ['card', 'ri-bank-card-line', 'Card'],
]

/** The rider's app: where to → choose a ride → follow it (chat, OTP, share, SOS) → rate. */
export default function RiderHome() {
  const { config } = useSession()
  const [menuOpen, setMenuOpen] = useState(false)
  const [location, setLocation] = useState(null)
  const [locationOff, setLocationOff] = useState(false)
  const [pickup, setPickup] = useState(null)
  const pickupIsAuto = useRef(true)
  const [drop, setDrop] = useState(null)
  const [searching, setSearching] = useState(null)
  const [savedPlaces, setSavedPlaces] = useState([])
  const [nearbyCabs, setNearbyCabs] = useState([])
  const [estimate, setEstimate] = useState(null)
  const [vehicleType, setVehicleType] = useState('car')
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [showBreakdown, setShowBreakdown] = useState(false)
  const [ride, setRide] = useState(null)
  const [rideLoaded, setRideLoaded] = useState(false)
  const [rateRide, setRateRide] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [chatOpen, setChatOpen] = useState(false)
  const [unread, setUnread] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [sosOpen, setSosOpen] = useState(false)
  const [notice, setNotice] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const lastRideId = useRef(null)
  const bookingKey = useRef(null)

  // ---- The current ride, kept fresh by live updates ----

  const loadRide = useCallback(async () => {
    try {
      const { ride: current } = await api('/rides/active')
      setRide(current)
      setRideLoaded(true)
      if (current) {
        lastRideId.current = current.id
        return
      }
      // The ride just ended: show the fare and rating if it completed and isn't rated yet.
      if (lastRideId.current) {
        const { ride: finished } = await api(`/rides/${lastRideId.current}`)
        lastRideId.current = null
        if (finished.status === 'completed' && !finished.myRating) setRateRide(finished)
        if (finished.status === 'cancelled' && finished.cancelledBy !== 'rider') setNotice('Your ride was cancelled.')
      }
    } catch (err) {
      setError(err.message)
    }
  }, [])

  useEffect(() => {
    loadRide()
    api('/me/places')
      .then((data) => setSavedPlaces(data.places))
      .catch(() => {})
  }, [loadRide])

  useLiveUpdates(() => {
    loadRide()
    setRefreshKey((key) => key + 1)
  })

  // ---- Where the rider is ----

  const lastLookup = useRef(null)
  async function handleLocate(point) {
    setLocation(point)
    setLocationOff(false)
    if (!pickupIsAuto.current) return
    // GPS updates often; only look the address up again after moving about 50 m.
    const last = lastLookup.current
    if (last && Math.abs(last.lat - point.lat) < 0.0005 && Math.abs(last.lng - point.lng) < 0.0005) return
    lastLookup.current = point
    try {
      const { place } = await api(`/places/reverse?lat=${point.lat}&lng=${point.lng}`)
      if (pickupIsAuto.current) setPickup({ name: place.name, lat: point.lat, lng: point.lng })
    } catch {
      if (pickupIsAuto.current) setPickup({ name: 'Current location', ...point })
    }
  }

  // Online cabs near the pickup (or the rider), while not on a ride.
  const cabsCentre = pickup || location
  useInterval(
    () => {
      if (!cabsCentre) return
      api(`/places/nearby-drivers?lat=${cabsCentre.lat}&lng=${cabsCentre.lng}`)
        .then((data) => setNearbyCabs(data.drivers))
        .catch(() => {})
    },
    15000,
    Boolean(cabsCentre) && !ride,
  )

  // ---- Quote ----

  useEffect(() => {
    if (!pickup || !drop || ride) {
      setEstimate(null)
      return
    }
    let cancelled = false
    setBusy(true)
    setError(null)
    bookingKey.current = newIdempotencyKey()
    api('/rides/estimate', { method: 'POST', body: { pickup, drop } })
      .then((data) => {
        if (!cancelled) setEstimate(data)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setBusy(false)
      })
    return () => {
      cancelled = true
    }
  }, [pickup, drop, ride])

  async function book() {
    setBusy(true)
    setError(null)
    try {
      const { ride: booked } = await api('/rides', {
        method: 'POST',
        // The quote id books at exactly the price shown, even if traffic changes the route meanwhile.
        body: { pickup, drop, vehicleType, paymentMethod, quoteId: estimate?.quoteId },
        idempotencyKey: bookingKey.current,
      })
      lastRideId.current = booked.id
      setNotice(null)
      setRide(booked)
      setEstimate(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  // ---- During the ride ----

  async function rideAction(path, body) {
    setBusy(true)
    setError(null)
    try {
      const data = await api(`/rides/${ride.id}/${path}`, { method: 'POST', body })
      if (data.ride !== undefined) setRide(data.ride)
      return data
    } catch (err) {
      setError(err.message)
      return null
    } finally {
      setBusy(false)
    }
  }

  async function cancel(reason) {
    const result = await rideAction('cancel', { reason })
    setCancelOpen(false)
    if (result) {
      lastRideId.current = null
      setRide(null)
      setDrop(null)
      setNotice(result.ride?.cancellationFee ? `Ride cancelled. A ${rupees(result.ride.cancellationFee)} fee applies.` : 'Ride cancelled.')
    }
  }

  async function share() {
    const result = await rideAction('share')
    if (!result) return
    const text = `Follow my RideShare trip live: ${result.url}`
    try {
      if (navigator.share) await navigator.share({ title: 'My RideShare trip', text, url: result.url })
      else {
        await navigator.clipboard.writeText(result.url)
        setNotice('Trip link copied. Send it to family or friends.')
      }
    } catch {
      setNotice(result.url)
    }
  }

  async function pay() {
    setBusy(true)
    try {
      const { checkoutUrl } = await api(`/rides/${rateRide.id}/payments/checkout`, {
        method: 'POST',
        body: { method: rateRide.paymentMethod, returnUrl: `${window.location.origin}/home` },
        idempotencyKey: newIdempotencyKey(),
      })
      window.location.assign(checkoutUrl)
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  // ---- Map ----

  const markers = useMemo(() => {
    const list = []
    const stops = ride || (pickup && { pickup, drop })
    if (stops?.pickup) list.push({ id: 'pickup', kind: 'pickup', title: 'Pickup', ...stops.pickup })
    if (stops?.drop) list.push({ id: 'drop', kind: 'drop', title: 'Drop', ...stops.drop })
    if (ride?.driver?.location) list.push({ id: 'driver', kind: 'driver', title: ride.driver.name, ...ride.driver.location })
    if (!ride) nearbyCabs.forEach((cab) => list.push({ id: cab.id, kind: 'cab', title: cab.vehicleType, lat: cab.lat, lng: cab.lng }))
    return list
  }, [ride, pickup, drop, nearbyCabs])

  const route = ride?.route || estimate?.route.geometry || null
  const fit = useMemo(() => {
    if (ride?.driver?.location && (ride.status === 'accepted' || ride.status === 'arrived')) return [ride.driver.location, ride.pickup]
    if (ride) return [ride.pickup, ride.drop]
    if (pickup && drop) return [pickup, drop]
    return null
  }, [ride, pickup, drop])

  // ---- Screens ----

  const current = config?.pricing?.current
  const selected = estimate?.options.find((option) => option.type === vehicleType)
  const chatOpenable = ride && ['accepted', 'arrived', 'in_progress'].includes(ride.status)

  return (
    <div className="relative h-full">
      <MapView
        markers={markers}
        route={route}
        fit={fit}
        onLocate={handleLocate}
        onLocateError={() => {
          setLocationOff(true)
          if (!location) setLocation(DEFAULT_CENTER)
        }}
      />
      <TopBar onMenu={() => setMenuOpen(true)} />
      <Menu open={menuOpen} onClose={() => setMenuOpen(false)} />

      {rateRide ? (
        <div>
          {rateRide.paymentMethod !== 'cash' && rateRide.paymentStatus !== 'paid' && (
            <div className="absolute inset-x-4 top-20 z-30 rounded-2xl bg-white p-4 shadow-lg">
              <p className="font-semibold">Pay {rupees(rateRide.fare)} by {rateRide.paymentMethod.toUpperCase()}</p>
              <button className="btn-primary mt-2 w-full" disabled={busy} onClick={pay}>
                Pay now
              </button>
            </div>
          )}
          <RateRide
            ride={rateRide}
            onDone={() => {
              setRateRide(null)
              setDrop(null)
            }}
          />
        </div>
      ) : ride ? (
        <div className="sheet">
          <RideProgress status={ride.status} />
          <RideStatus ride={ride} />

          {ride.driver && (
            <div className="mt-4 flex items-center gap-3 rounded-2xl bg-neutral-50 p-3">
              <Avatar name={ride.driver.name} />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{ride.driver.name}</p>
                <p className="truncate text-sm text-neutral-500">{vehicleText(ride.driver.vehicle)}</p>
                <RatingText rating={ride.driver.rating} />
              </div>
              <p className="rounded-lg border-2 border-black px-2 py-1 font-mono text-sm font-bold">{ride.driver.vehicle.plate}</p>
            </div>
          )}

          {ride.status === 'arrived' && <OtpCard ride={ride} busy={busy} onNewCode={() => rideAction('otp')} />}

          {ride.status !== 'requested' && (
            <div className="mt-4 grid grid-cols-3 gap-2">
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
              <button className="btn-secondary flex-col gap-0 py-2 text-xs" onClick={share} disabled={busy}>
                <i className="ri-share-forward-line text-xl" />
                Share trip
              </button>
              <button className="btn-secondary flex-col gap-0 py-2 text-xs text-red-600" onClick={() => setSosOpen(true)}>
                <i className="ri-alarm-warning-line text-xl" />
                SOS
              </button>
            </div>
          )}

          <div className="mt-4 space-y-2 text-sm">
            <p>
              <i className="ri-checkbox-blank-circle-fill mr-2 text-[10px] text-green-600" />
              {shortPlace(ride.pickup.name)}
            </p>
            <p>
              <i className="ri-checkbox-blank-fill mr-2 text-[10px]" />
              {shortPlace(ride.drop.name)}
            </p>
            <p className="flex items-center justify-between pt-1">
              <span>
                {rupees(ride.fare)} · {ride.paymentMethod === 'cash' ? 'Cash' : ride.paymentMethod.toUpperCase()}
              </span>
              {pricingBadge(ride.pricing) && <span className="chip bg-amber-100 text-amber-800">{pricingBadge(ride.pricing)}</span>}
            </p>
          </div>

          {notice && <p className="mt-3 break-all rounded-lg bg-neutral-100 px-3 py-2 text-sm">{notice}</p>}
          <ErrorText error={error} />
          {['requested', 'accepted', 'arrived'].includes(ride.status) && (
            <button className="mt-4 w-full py-2 text-sm font-medium text-red-600" onClick={() => setCancelOpen(true)}>
              Cancel ride
            </button>
          )}
        </div>
      ) : estimate ? (
        <div className="sheet">
          <div className="mb-3 flex items-center gap-2">
            <button aria-label="Back" className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-neutral-100" onClick={() => setDrop(null)}>
              <i className="ri-arrow-left-line text-xl" />
            </button>
            <h2 className="flex-1 text-xl font-semibold">Choose a ride</h2>
            {pricingBadge(estimate.pricing) && <span className="chip bg-amber-100 text-amber-800">{pricingBadge(estimate.pricing)}</span>}
          </div>
          <p className="mb-3 text-sm text-neutral-500">
            {estimate.route.distanceKm} km · {shortPlace(estimate.pickup.name)} → {shortPlace(estimate.drop.name)}
          </p>
          <div className="space-y-2">
            {estimate.options.map((option) => (
              <button
                key={option.type}
                onClick={() => setVehicleType(option.type)}
                aria-pressed={vehicleType === option.type}
                className={`flex w-full items-center gap-3 rounded-2xl border-2 p-3 text-left ${vehicleType === option.type ? 'border-black' : 'border-neutral-100'}`}
              >
                <i className={`${VEHICLE_ICONS[option.type]} text-3xl`} />
                <span className="flex-1">
                  <span className="block font-semibold">
                    {option.label} <span className="text-sm font-normal text-neutral-500"><i className="ri-user-3-fill" /> {option.seats}</span>
                  </span>
                  <span className="block text-sm text-neutral-500">{option.durationMin} min trip</span>
                </span>
                <span className="text-lg font-semibold">{rupees(option.fare)}</span>
              </button>
            ))}
          </div>
          {selected && (
            <button className="mt-2 text-sm text-neutral-600 underline" onClick={() => setShowBreakdown(!showBreakdown)}>
              {showBreakdown ? 'Hide' : 'How is this calculated?'}
            </button>
          )}
          {selected && showBreakdown && <FareBreakdown breakdown={selected.breakdown} />}
          <div className="mt-4 grid grid-cols-3 gap-2">
            {PAYMENT_METHODS.map(([value, icon, label]) => (
              <button key={value} aria-pressed={paymentMethod === value} onClick={() => setPaymentMethod(value)} className={`chip justify-center py-2 ${paymentMethod === value ? 'bg-black text-white' : ''}`}>
                <i className={icon} />
                {label}
              </button>
            ))}
          </div>
          <ErrorText error={error} />
          <button className="btn-primary mt-4 w-full" disabled={busy || !selected} onClick={book}>
            Book {selected?.label} · {rupees(selected?.fare)}
          </button>
        </div>
      ) : (
        <div className="sheet">
          {current && current.segment !== 'normal' && (
            <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <i className="ri-flashlight-line mr-1" />
              {current.label}: fares are ×{current.multiplier} right now.
            </p>
          )}
          <h2 className="mb-3 text-2xl font-semibold">Where to?</h2>
          <div className="relative rounded-2xl bg-neutral-100">
            <div className="absolute bottom-6 left-[22px] top-6 w-0.5 bg-neutral-300" />
            <button className="flex w-full items-center gap-3 px-4 py-3 text-left" onClick={() => setSearching('pickup')}>
              <i className="ri-checkbox-blank-circle-fill z-10 text-xs text-green-600" />
              <span className={`truncate ${pickup ? '' : 'text-neutral-500'}`}>{pickup ? shortPlace(pickup.name) : locationOff ? 'Set your pickup' : 'Finding your location…'}</span>
            </button>
            <div className="mx-4 border-t border-neutral-200" />
            <button className="flex w-full items-center gap-3 px-4 py-3 text-left" onClick={() => setSearching('drop')}>
              <i className="ri-checkbox-blank-fill z-10 text-xs" />
              <span className="text-neutral-500">Where are you going?</span>
            </button>
          </div>
          {savedPlaces.length > 0 && (
            <div className="mt-3 flex gap-2 overflow-x-auto">
              {savedPlaces.map((place) => (
                <button key={place.id} className="chip shrink-0" onClick={() => setDrop({ name: place.name, lat: place.lat, lng: place.lng })}>
                  <i className={place.label === 'Home' ? 'ri-home-4-line' : place.label === 'Work' ? 'ri-briefcase-4-line' : 'ri-bookmark-line'} />
                  {place.label}
                </button>
              ))}
            </div>
          )}
          <p className="mt-3 text-sm text-neutral-500">
            <i className="ri-taxi-line mr-1" />
            {nearbyCabs.length ? `${nearbyCabs.length} cab${nearbyCabs.length > 1 ? 's' : ''} nearby` : 'No cabs online nearby right now'}
            {locationOff && ' · location is off'}
          </p>
          {notice && <p className="mt-2 rounded-lg bg-neutral-100 px-3 py-2 text-sm">{notice}</p>}
          {busy && <p className="mt-2 text-sm text-neutral-500">Getting prices…</p>}
          <ErrorText error={error} />
          {!rideLoaded && <p className="mt-2 text-sm text-neutral-500">Loading…</p>}
          <Link to="/places" className="mt-3 block text-sm underline">
            Manage saved places
          </Link>
        </div>
      )}

      {searching && (
        <PlaceSearch
          title={searching === 'pickup' ? 'Pickup location' : 'Where to?'}
          near={location || pickup}
          savedPlaces={savedPlaces}
          onClose={() => setSearching(null)}
          extraOptions={
            searching === 'pickup' && location ? (
              <button
                className="flex w-full items-center gap-3 rounded-xl px-2 py-3 text-left hover:bg-neutral-50"
                onClick={() => {
                  pickupIsAuto.current = true
                  lastLookup.current = null
                  setSearching(null)
                  handleLocate(location)
                }}
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100">
                  <i className="ri-crosshair-2-line" />
                </span>
                <span className="font-medium">Use my current location</span>
              </button>
            ) : null
          }
          onSelect={(place) => {
            if (searching === 'pickup') {
              pickupIsAuto.current = false
              setPickup(place)
            } else setDrop(place)
            setNotice(null)
            setSearching(null)
          }}
        />
      )}

      {chatOpen && ride && (
        <Chat
          rideId={ride.id}
          role="rider"
          otherName={firstName(ride.driver?.name)}
          canSend={chatOpenable}
          refreshKey={refreshKey}
          onClose={() => setChatOpen(false)}
        />
      )}
      {!chatOpen && chatOpenable && <UnreadWatcher rideId={ride.id} refreshKey={refreshKey} onUnread={() => setUnread(true)} />}
      {cancelOpen && ride && (
        <CancelDialog role="rider" fee={ride.status === 'arrived' ? config?.cancellationFee : 0} busy={busy} onClose={() => setCancelOpen(false)} onConfirm={cancel} />
      )}
      {sosOpen && ride && <SosDialog alerted={Boolean(ride.sosAt)} onClose={() => setSosOpen(false)} onAlert={() => rideAction('sos')} />}
    </div>
  )
}

function RideStatus({ ride }) {
  const driver = firstName(ride.driver?.name)
  const lines = {
    requested: ['Finding your driver…', 'Nearby drivers are being offered your ride.'],
    accepted: [`${driver} is on the way`, "You'll get your OTP when they arrive."],
    arrived: [`${driver} has arrived`, 'Share the OTP below to start your trip.'],
    in_progress: [`On the way to ${shortPlace(ride.drop.name)}`, `About ${ride.durationMin} min. Share your trip so someone can follow along.`],
  }
  const [title, subtitle] = lines[ride.status] || [ride.statusLabel, '']
  return (
    <div>
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="text-sm text-neutral-500">{subtitle}</p>
      {ride.status === 'requested' && (
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-neutral-100">
          <div className="h-full w-1/3 animate-pulse rounded-full bg-black" />
        </div>
      )}
    </div>
  )
}

/** The trip OTP with a countdown to its expiry, and a button for a new one. */
function OtpCard({ ride, busy, onNewCode }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const left = ride.otpExpiresAt ? Math.max(0, Date.parse(ride.otpExpiresAt) - now) : 0
  const expired = !ride.otp || left === 0
  const minutes = Math.floor(left / 60000)
  const seconds = String(Math.floor((left % 60000) / 1000)).padStart(2, '0')
  return (
    <div className="mt-4 rounded-2xl bg-black p-4 text-center text-white">
      <p className="text-sm text-neutral-300">Your trip OTP</p>
      {expired ? (
        <p className="my-2 text-lg font-semibold">Your code expired</p>
      ) : (
        <p className="my-1 font-mono text-4xl font-bold tracking-[0.4em]" aria-label={`OTP ${ride.otp.split('').join(' ')}`}>
          {ride.otp}
        </p>
      )}
      <div className="flex items-center justify-between text-sm text-neutral-300">
        <span>{expired ? 'Ask for a new one' : `Expires in ${minutes}:${seconds}`}</span>
        <button className="font-semibold text-white underline" disabled={busy} onClick={onNewCode}>
          New code
        </button>
      </div>
    </div>
  )
}

function FareBreakdown({ breakdown }) {
  return (
    <dl className="mt-2 grid grid-cols-2 gap-y-1 rounded-xl bg-neutral-50 p-3 text-sm">
      <dt className="text-neutral-500">Base fare</dt>
      <dd className="text-right">{rupees(breakdown.base)}</dd>
      <dt className="text-neutral-500">Distance</dt>
      <dd className="text-right">{rupees(breakdown.distanceCharge)}</dd>
      <dt className="text-neutral-500">Time</dt>
      <dd className="text-right">{rupees(breakdown.timeCharge)}</dd>
      {breakdown.minimumApplied && (
        <>
          <dt className="text-neutral-500">Minimum fare applies</dt>
          <dd />
        </>
      )}
      <dt className="text-neutral-500">{breakdown.segmentLabel || 'Pricing'}</dt>
      <dd className="text-right">×{breakdown.multiplier}</dd>
      <dt className="font-semibold">Total</dt>
      <dd className="text-right font-semibold">{rupees(breakdown.fare)}</dd>
    </dl>
  )
}
