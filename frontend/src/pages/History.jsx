import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import RateRide from '../components/RateRide'
import { ErrorText } from '../components/ui'
import { api } from '../lib/api'
import { useSession } from '../lib/session'
import { VEHICLE_ICONS, dateTime, pricingBadge, rupees, shortPlace } from '../lib/format'

/** Rides taken (rider) or trips made with earnings (driver), newest first, with ratings and receipts. */
export default function History() {
  const { me } = useSession()
  const isDriver = me.user.role === 'driver'
  const [items, setItems] = useState([])
  const [cursor, setCursor] = useState(null)
  const [earnings, setEarnings] = useState(null)
  const [rating, setRating] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(
    async (from = null) => {
      setLoading(true)
      try {
        const data = await api(`${isDriver ? '/me/trips' : '/me/rides'}?limit=20${from ? `&cursor=${from}` : ''}`)
        setItems((current) => (from ? [...current, ...data.items] : data.items))
        setCursor(data.nextCursor)
        if (data.earnings) setEarnings(data.earnings)
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    },
    [isDriver],
  )

  useEffect(() => {
    load()
  }, [load])

  if (rating) {
    return (
      <div className="relative h-full bg-neutral-100">
        <RateRide
          ride={rating}
          onDone={() => {
            setRating(null)
            load()
          }}
        />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b border-neutral-100 p-4">
        <Link to="/home" aria-label="Back" className="flex h-10 w-10 items-center justify-center rounded-full text-xl hover:bg-neutral-100">
          <i className="ri-arrow-left-line" />
        </Link>
        <h1 className="text-xl font-semibold">{isDriver ? 'Trips & earnings' : 'Your rides'}</h1>
      </header>
      <div className="flex-1 overflow-y-auto p-4">
        {earnings && (
          <div className="mb-4 grid grid-cols-3 gap-2 text-center">
            {[
              ['Today', earnings.today],
              ['7 days', earnings.week],
              ['All time', earnings.total],
            ].map(([label, bucket]) => (
              <div key={label} className="rounded-2xl bg-neutral-50 p-3">
                <p className="text-lg font-semibold">{rupees(bucket.amount)}</p>
                <p className="text-xs text-neutral-500">
                  {label} · {bucket.trips} trips
                </p>
              </div>
            ))}
          </div>
        )}
        <ErrorText error={error} />
        {!loading && !items.length && <p className="mt-10 text-center text-neutral-500">{isDriver ? 'No trips yet. Go online to start earning.' : 'No rides yet.'}</p>}
        <ul className="space-y-3">
          {items.map((ride) => (
            <li key={ride.id} className="rounded-2xl border border-neutral-100 p-4">
              <div className="flex items-start gap-3">
                <i className={`${VEHICLE_ICONS[ride.vehicleType]} mt-1 text-2xl`} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {shortPlace(ride.pickup.name)} → {shortPlace(ride.drop.name)}
                  </p>
                  <p className="text-sm text-neutral-500">{dateTime(ride.times.completed || ride.times.cancelled || ride.times.requested)}</p>
                  <p className="text-sm">
                    <span className={ride.status === 'cancelled' ? 'text-red-600' : 'text-neutral-600'}>{ride.statusLabel}</span>
                    {pricingBadge(ride.pricing) && <span className="ml-2 text-xs text-amber-700">{pricingBadge(ride.pricing)}</span>}
                  </p>
                </div>
                <p className="font-semibold">
                  {ride.status !== 'cancelled' ? rupees(ride.fare) : ride.cancellationFee ? rupees(ride.cancellationFee) : <span className="text-sm font-normal text-neutral-500">No charge</span>}
                </p>
              </div>
              <div className="mt-2 flex items-center gap-4 text-sm">
                {ride.myRating && (
                  <span className="text-amber-600">
                    You rated {'★'.repeat(ride.myRating.stars)}
                    <span className="text-neutral-300">{'★'.repeat(5 - ride.myRating.stars)}</span>
                  </span>
                )}
                {ride.status === 'completed' && !ride.myRating && (
                  <button className="font-medium underline" onClick={() => setRating(ride)}>
                    Rate this ride
                  </button>
                )}
                {(ride.status === 'completed' || ride.cancellationFee > 0) && (
                  <Link className="underline" to={`/receipt/${ride.id}`}>
                    Receipt
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
        {cursor && (
          <button className="btn-secondary mt-4 w-full" disabled={loading} onClick={() => load(cursor)}>
            Load more
          </button>
        )}
      </div>
    </div>
  )
}
