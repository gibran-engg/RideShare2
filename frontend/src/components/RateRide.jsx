import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { useSession } from '../lib/session'
import { firstName, rupees } from '../lib/format'
import { ErrorText, Stars } from './ui'

/** After a completed trip: the fare, then rate the other person (stars, tags, comment). */
export default function RateRide({ ride, onDone }) {
  const { config } = useSession()
  const isRider = ride.viewerRole === 'rider'
  const other = isRider ? ride.driver?.name : ride.rider?.name
  const tagOptions = (isRider ? config?.ratingTags?.rider : config?.ratingTags?.driver) || []
  const [stars, setStars] = useState(0)
  const [tags, setTags] = useState([])
  const [comment, setComment] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      await api(`/rides/${ride.id}/rating`, { method: 'POST', body: { stars, tags, comment: comment || null } })
      onDone()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <div className="sheet">
      <div className="mb-4 text-center">
        <p className="text-sm text-neutral-500">{isRider ? 'You arrived' : 'Trip completed'}</p>
        <p className="text-3xl font-bold">{rupees(ride.fare)}</p>
        <p className="text-sm text-neutral-500">
          {ride.paymentMethod === 'cash' ? (isRider ? 'Pay your driver in cash' : 'Collect cash from the rider') : ride.paymentMethod.toUpperCase()} ·{' '}
          <Link className="underline" to={`/receipt/${ride.id}`}>
            Receipt
          </Link>
        </p>
      </div>
      <h3 className="mb-2 text-center text-lg font-semibold">How was {firstName(other)}?</h3>
      <Stars value={stars} onChange={setStars} />
      {stars > 0 && (
        <>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {tagOptions.map((tag) => {
              const on = tags.includes(tag)
              return (
                <button
                  key={tag}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setTags(on ? tags.filter((t) => t !== tag) : [...tags, tag])}
                  className={`chip ${on ? 'bg-black text-white' : ''}`}
                >
                  {tag}
                </button>
              )
            })}
          </div>
          <textarea className="input mt-4" rows={2} maxLength={300} placeholder="Add a comment (optional)" value={comment} onChange={(e) => setComment(e.target.value)} />
        </>
      )}
      <ErrorText error={error} />
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button className="btn-secondary" onClick={onDone}>
          Skip
        </button>
        <button className="btn-primary" disabled={!stars || busy} onClick={submit}>
          Submit
        </button>
      </div>
    </div>
  )
}
