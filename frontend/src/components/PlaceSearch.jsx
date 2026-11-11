import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'

/**
 * Full-sheet place search: saved places first, then results from /places/search (Ola Maps,
 * OpenStreetMap as fallback), nearest to `near` first.
 */
export default function PlaceSearch({ title, near, savedPlaces = [], onSelect, onClose, extraOptions = null }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const requestId = useRef(0)

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setResults([])
      return
    }
    const id = ++requestId.current
    const timer = setTimeout(async () => {
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams({ q })
        if (near) {
          params.set('lat', near.lat)
          params.set('lng', near.lng)
        }
        const data = await api(`/places/search?${params}`)
        if (id === requestId.current) setResults(data.places)
      } catch (err) {
        if (id === requestId.current) setError(err.message)
      } finally {
        if (id === requestId.current) setLoading(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [query, near])

  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-white" role="dialog" aria-label={title}>
      <div className="flex items-center gap-2 border-b border-neutral-100 p-4">
        <button onClick={onClose} aria-label="Back" className="flex h-10 w-10 items-center justify-center rounded-full text-xl hover:bg-neutral-100">
          <i className="ri-arrow-left-line" />
        </button>
        <input autoFocus className="input" placeholder={title} value={query} onChange={(e) => setQuery(e.target.value)} aria-label={title} />
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-2">
        {extraOptions}
        {!query &&
          savedPlaces.map((place) => (
            <button key={place.id} onClick={() => onSelect({ name: place.name, lat: place.lat, lng: place.lng })} className="flex w-full items-center gap-3 rounded-xl px-2 py-3 text-left hover:bg-neutral-50">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100">
                <i className={place.label === 'Home' ? 'ri-home-4-fill' : place.label === 'Work' ? 'ri-briefcase-4-fill' : 'ri-bookmark-fill'} />
              </span>
              <span>
                <span className="block font-medium">{place.label}</span>
                <span className="block text-sm text-neutral-500">{place.name}</span>
              </span>
            </button>
          ))}
        {loading && <p className="px-2 py-3 text-sm text-neutral-500">Searching…</p>}
        {error && <p className="px-2 py-3 text-sm text-red-600">{error}</p>}
        {!loading && query.trim().length >= 2 && !results.length && !error && <p className="px-2 py-3 text-sm text-neutral-500">No places found.</p>}
        {results.map((place, index) => (
          <button
            key={`${place.lat},${place.lng},${index}`}
            onClick={() => onSelect({ name: place.name, lat: place.lat, lng: place.lng, address: place.address })}
            className="flex w-full items-center gap-3 rounded-xl px-2 py-3 text-left hover:bg-neutral-50"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neutral-100">
              <i className="ri-map-pin-2-fill" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{place.name}</span>
              <span className="block truncate text-sm text-neutral-500">{place.area || place.address}</span>
            </span>
            {place.distanceKm != null && <span className="shrink-0 text-xs text-neutral-500">{place.distanceKm} km</span>}
          </button>
        ))}
      </div>
    </div>
  )
}
