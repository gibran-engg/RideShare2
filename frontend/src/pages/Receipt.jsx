import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ErrorText } from '../components/ui'
import { api } from '../lib/api'
import { dateTime, rupees } from '../lib/format'

/** A printable fare receipt for a finished ride. */
export default function Receipt() {
  const { id } = useParams()
  const [receipt, setReceipt] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    api(`/rides/${id}/receipt`)
      .then((data) => setReceipt(data.receipt))
      .catch((err) => setError(err.message))
  }, [id])

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b border-neutral-100 p-4 print:hidden">
        <Link to="/history" aria-label="Back" className="flex h-10 w-10 items-center justify-center rounded-full text-xl hover:bg-neutral-100">
          <i className="ri-arrow-left-line" />
        </Link>
        <h1 className="flex-1 text-xl font-semibold">Receipt</h1>
        {receipt && (
          <button className="btn-secondary py-2" onClick={() => window.print()}>
            <i className="ri-printer-line" /> Print
          </button>
        )}
      </header>
      <div className="flex-1 overflow-y-auto p-6">
        <ErrorText error={error} />
        {receipt && (
          <div>
            <p className="text-2xl font-bold tracking-tight">RideShare</p>
            <p className="text-sm text-neutral-500">
              Receipt {receipt.number} · {dateTime(receipt.date)}
            </p>
            <p className="mt-6 text-4xl font-bold">{rupees(receipt.total)}</p>
            <p className="text-sm text-neutral-500">
              {receipt.status === 'completed' ? `Paid by ${receipt.paymentMethod.toUpperCase()} · ${receipt.paymentStatus}` : 'Cancellation fee'}
            </p>

            <dl className="mt-6 grid grid-cols-[auto,1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-neutral-500">From</dt>
              <dd>{receipt.pickup}</dd>
              <dt className="text-neutral-500">To</dt>
              <dd>{receipt.drop}</dd>
              <dt className="text-neutral-500">Ride</dt>
              <dd>
                {receipt.vehicle} · {receipt.distanceKm} km · {receipt.durationMin} min
              </dd>
              <dt className="text-neutral-500">Driver</dt>
              <dd>
                {receipt.driver} · {receipt.vehiclePlate}
              </dd>
              <dt className="text-neutral-500">Rider</dt>
              <dd>{receipt.rider}</dd>
            </dl>

            {receipt.status === 'completed' && receipt.fareBreakdown && (
              <dl className="mt-6 grid grid-cols-2 gap-y-2 border-t border-neutral-200 pt-4 text-sm">
                <dt className="text-neutral-500">Base fare</dt>
                <dd className="text-right">{rupees(receipt.fareBreakdown.base)}</dd>
                <dt className="text-neutral-500">Distance ({receipt.distanceKm} km)</dt>
                <dd className="text-right">{rupees(receipt.fareBreakdown.distanceCharge)}</dd>
                <dt className="text-neutral-500">Time ({receipt.durationMin} min)</dt>
                <dd className="text-right">{rupees(receipt.fareBreakdown.timeCharge)}</dd>
                <dt className="text-neutral-500">{receipt.pricing.label} pricing</dt>
                <dd className="text-right">×{receipt.pricing.multiplier}</dd>
                <dt className="font-semibold">Total</dt>
                <dd className="text-right font-semibold">{rupees(receipt.fare)}</dd>
              </dl>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
