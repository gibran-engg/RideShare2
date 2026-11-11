import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import MapView from '../components/MapView'
import { useInterval } from '../lib/live'
import { shortPlace } from '../lib/format'

const STATUS_TEXT = {
  requested: ' is looking for a driver',
  accepted: "'s driver is on the way",
  arrived: "'s driver has arrived",
  in_progress: ' is on the way',
  completed: ' has arrived safely',
  cancelled: "'s ride was cancelled",
}

/** The page behind a shared trip link: anyone with the link can follow the ride live, no sign-in. */
export default function Track() {
  const { token } = useParams()
  const [ride, setRide] = useState(null)
  const [error, setError] = useState(null)

  const active = !ride || !['completed', 'cancelled'].includes(ride.status)
  useInterval(
    async () => {
      try {
        const res = await fetch(`/api/v1/share/${encodeURIComponent(token)}`)
        const data = await res.json()
        if (!res.ok) throw new Error(data.error?.message || "This trip link isn't valid.")
        setRide(data.ride)
        setError(null)
      } catch (err) {
        setError(err.message)
      }
    },
    5000,
    active,
  )

  const markers = useMemo(() => {
    if (!ride) return []
    const list = [
      { id: 'pickup', kind: 'pickup', ...ride.pickup },
      { id: 'drop', kind: 'drop', ...ride.drop },
    ]
    if (ride.driver?.location) list.push({ id: 'driver', kind: 'driver', ...ride.driver.location })
    return list
  }, [ride])
  const fit = useMemo(() => (ride ? [ride.pickup, ride.drop, ...(ride.driver?.location ? [ride.driver.location] : [])] : null), [ride])

  return (
    <div className="relative h-full">
      <MapView markers={markers} fit={fit} padding={{ top: 60, bottom: 240, left: 40, right: 40 }} />
      <div className="sheet">
        <p className="text-sm font-semibold tracking-tight">RideShare · live trip</p>
        {error && <p className="mt-2 text-red-600">{error}</p>}
        {ride && (
          <>
            <h1 className="mt-1 text-xl font-semibold">
              {ride.riderFirstName || 'Your contact'}
              {STATUS_TEXT[ride.status] || ''}
            </h1>
            <p className="mt-2 text-sm">
              {shortPlace(ride.pickup.name)} → {shortPlace(ride.drop.name)}
            </p>
            {ride.driver && (
              <p className="mt-2 text-sm text-neutral-600">
                {ride.driver.name} · {ride.driver.vehicle} · <span className="font-mono font-semibold">{ride.driver.plate}</span>
              </p>
            )}
            <p className="mt-3 text-xs text-neutral-500">{active ? 'Updates every few seconds.' : 'This trip has ended.'} In an emergency, call 112.</p>
          </>
        )}
      </div>
    </div>
  )
}
