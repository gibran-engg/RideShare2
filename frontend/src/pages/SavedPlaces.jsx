import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import PlaceSearch from '../components/PlaceSearch'
import { ErrorText } from '../components/ui'
import { api } from '../lib/api'

const SUGGESTED_LABELS = ['Home', 'Work', 'Gym', 'College']

/** Manage saved places (Home, Work, …) used as one-tap destinations. */
export default function SavedPlaces() {
  const [places, setPlaces] = useState([])
  const [label, setLabel] = useState('Home')
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState(null)

  const load = () =>
    api('/me/places')
      .then((data) => setPlaces(data.places))
      .catch((err) => setError(err.message))
  useEffect(() => {
    load()
  }, [])

  async function save(place) {
    setPicking(false)
    setError(null)
    try {
      await api('/me/places', { method: 'POST', body: { label: label.trim(), name: place.name, lat: place.lat, lng: place.lng } })
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  async function remove(id) {
    setError(null)
    try {
      await api(`/me/places/${id}/delete`, { method: 'POST' })
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="relative flex h-full flex-col">
      <header className="flex items-center gap-2 border-b border-neutral-100 p-4">
        <Link to="/home" aria-label="Back" className="flex h-10 w-10 items-center justify-center rounded-full text-xl hover:bg-neutral-100">
          <i className="ri-arrow-left-line" />
        </Link>
        <h1 className="text-xl font-semibold">Saved places</h1>
      </header>
      <div className="flex-1 overflow-y-auto p-4">
        <ul className="space-y-2">
          {places.map((place) => (
            <li key={place.id} className="flex items-center gap-3 rounded-2xl bg-neutral-50 p-3">
              <i className={`text-xl ${place.label === 'Home' ? 'ri-home-4-fill' : place.label === 'Work' ? 'ri-briefcase-4-fill' : 'ri-bookmark-fill'}`} />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{place.label}</p>
                <p className="truncate text-sm text-neutral-500">{place.name}</p>
              </div>
              <button className="text-sm text-red-600" onClick={() => remove(place.id)} aria-label={`Remove ${place.label}`}>
                Remove
              </button>
            </li>
          ))}
        </ul>
        {!places.length && <p className="mb-4 text-sm text-neutral-500">Save places you go to often, then book them with one tap.</p>}

        <h2 className="mb-2 mt-6 font-semibold">Add a place</h2>
        <div className="mb-2 flex flex-wrap gap-2">
          {SUGGESTED_LABELS.map((item) => (
            <button key={item} className={`chip ${label === item ? 'bg-black text-white' : ''}`} onClick={() => setLabel(item)}>
              {item}
            </button>
          ))}
        </div>
        <input className="input mb-3" maxLength={30} value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Label" placeholder="Label, e.g. Mom's place" />
        <button className="btn-primary w-full" disabled={!label.trim()} onClick={() => setPicking(true)}>
          Choose the place for “{label.trim() || '…'}”
        </button>
        <ErrorText error={error} />
      </div>
      {picking && <PlaceSearch title={`Search for ${label}`} onClose={() => setPicking(false)} onSelect={save} />}
    </div>
  )
}
