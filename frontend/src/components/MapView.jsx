import { useEffect, useRef, useState } from 'react'
import { OlaMaps } from 'olamaps-web-sdk'
import { DEFAULT_CENTER } from '../lib/format'

const OLA_KEY = import.meta.env.VITE_OLA_MAPS_API_KEY
const OLA_STYLE = 'https://api.olamaps.io/tiles/vector/v1/styles/default-light-standard/style.json'
// Fallback when Ola Maps has no key or is down: plain OpenStreetMap tiles (light use only, per OSM's policy).
const OSM_STYLE = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 19,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
}

let olaCheck = null
/** Whether Ola's map style loads with our key; checked once per page load. */
function olaWorks() {
  if (!OLA_KEY) return Promise.resolve(false)
  olaCheck ??= fetch(`${OLA_STYLE}?api_key=${encodeURIComponent(OLA_KEY)}`)
    .then((res) => res.ok)
    .catch(() => false)
  return olaCheck
}

const MARKER_STYLES = {
  cab: { className: 'h-7 w-7 bg-black text-white text-sm', icon: 'ri-taxi-fill' },
  driver: { className: 'h-9 w-9 bg-black text-white text-lg ring-4 ring-white', icon: 'ri-car-fill' },
  pickup: { className: 'h-6 w-6 bg-green-600 text-white text-xs ring-4 ring-white', icon: 'ri-user-fill' },
  drop: { className: 'h-6 w-6 bg-black text-white text-xs ring-4 ring-white rounded-md', icon: 'ri-flag-fill' },
  request: { className: 'h-8 w-8 bg-amber-400 text-black text-base ring-2 ring-white', icon: 'ri-user-location-fill' },
}

function markerElement(kind, title) {
  const style = MARKER_STYLES[kind] || MARKER_STYLES.cab
  const element = document.createElement('div')
  element.className = `${style.className} rounded-full shadow-lg flex items-center justify-center`
  element.title = title || ''
  element.innerHTML = `<i class="${style.icon}"></i>`
  return element
}

const toLngLat = (point) => [point.lng, point.lat]

/**
 * The app's map. Ola Maps tiles (OpenStreetMap if Ola fails), a locate-me button that shows and
 * follows the user, extra markers, an optional route line, and fit-to-points.
 *   markers:  [{ id, lat, lng, kind: cab | driver | pickup | drop | request, title }]
 *   route:    [[lat, lng], ...]
 *   fit:      [{ lat, lng }, ...]  the map zooms to show these whenever they change
 *   onLocate: ({ lat, lng }) whenever the browser reports the user's position
 *   onLocateError: () when the browser has no location for us
 */
export default function MapView({ markers = [], route = null, fit = null, onLocate, onLocateError, padding = { top: 90, bottom: 340, left: 40, right: 40 } }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const sdkRef = useRef(null)
  const drawnRef = useRef({})
  const callbacks = useRef({ onLocate, onLocateError })
  callbacks.current = { onLocate, onLocateError }
  const [ready, setReady] = useState(false)
  const [source, setSource] = useState(null)

  useEffect(() => {
    let cancelled = false
    let map

    olaWorks().then(async (useOla) => {
      if (cancelled) return
      const olaMaps = new OlaMaps({ apiKey: OLA_KEY || 'none' })
      sdkRef.current = olaMaps
      map = await olaMaps.init({
        style: useOla ? OLA_STYLE : OSM_STYLE,
        container: containerRef.current,
        center: toLngLat(DEFAULT_CENTER),
        zoom: 14,
        // The SDK adds our Ola key to every request; never send it to OpenStreetMap.
        ...(useOla ? {} : { transformRequest: (url) => ({ url }) }),
      })
      if (cancelled) {
        map.remove()
        return
      }
      mapRef.current = map
      setSource(useOla ? 'Ola Maps' : 'OpenStreetMap')

      // Make sure the map redraws once street data arrives.
      map.on('sourcedata', () => map.triggerRepaint())
      map.on('error', (event) => {
        const message = event.error?.message || ''
        // Ola's default style lists a 3D layer whose data isn't served; that one is harmless.
        if (!message.includes('3d_model')) console.error('Map:', message)
      })

      // Locate-me: a blue dot that follows the user until they drag the map.
      const geolocate = olaMaps.addGeolocateControls({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true })
      map.addControl(geolocate, 'top-right')
      geolocate.on('geolocate', (position) => callbacks.current.onLocate?.({ lat: position.coords.latitude, lng: position.coords.longitude }))
      geolocate.on('error', () => callbacks.current.onLocateError?.())
      const locate = (attempt = 0) => {
        if (cancelled) return
        if (geolocate.trigger() === false && attempt < 10) setTimeout(() => locate(attempt + 1), 300)
      }
      locate()

      const onStyle = () => {
        if (cancelled || map.getSource('route')) return
        map.addSource('route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
        map.addLayer({ id: 'route-casing', type: 'line', source: 'route', paint: { 'line-color': '#ffffff', 'line-width': 9 } })
        map.addLayer({ id: 'route', type: 'line', source: 'route', paint: { 'line-color': '#111111', 'line-width': 5 } })
        setReady(true)
      }
      if (map.isStyleLoaded()) onStyle()
      else map.once('load', onStyle)
      map.triggerRepaint()
    })

    return () => {
      cancelled = true
      Object.values(drawnRef.current).forEach((marker) => marker.remove())
      drawnRef.current = {}
      map?.remove()
      mapRef.current = null
    }
  }, [])

  // Markers follow the `markers` prop.
  useEffect(() => {
    if (!ready) return
    const drawn = drawnRef.current
    const wanted = new Map(markers.filter((m) => m.lat != null && m.lng != null).map((m) => [`${m.kind}:${m.id}`, m]))
    for (const key of Object.keys(drawn)) {
      if (!wanted.has(key)) {
        drawn[key].remove()
        delete drawn[key]
      }
    }
    for (const [key, marker] of wanted) {
      if (drawn[key]) drawn[key].setLngLat(toLngLat(marker))
      else drawn[key] = sdkRef.current.addMarker({ element: markerElement(marker.kind, marker.title) }).setLngLat(toLngLat(marker)).addTo(mapRef.current)
    }
  }, [markers, ready])

  // The route line.
  useEffect(() => {
    if (!ready) return
    const coordinates = (route || []).map(([lat, lng]) => [lng, lat])
    mapRef.current.getSource('route')?.setData({
      type: 'FeatureCollection',
      features: coordinates.length > 1 ? [{ type: 'Feature', geometry: { type: 'LineString', coordinates }, properties: {} }] : [],
    })
  }, [route, ready])

  // Zoom to show the points that matter (pickup, drop, driver...).
  const fitKey = JSON.stringify(fit || [])
  useEffect(() => {
    if (!ready || !fit || !fit.length) return
    const map = mapRef.current
    if (fit.length === 1) {
      map.easeTo({ center: toLngLat(fit[0]), zoom: 15 })
      return
    }
    const lngs = fit.map((p) => p.lng)
    const lats = fit.map((p) => p.lat)
    map.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      { padding, maxZoom: 16, duration: 600 },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, ready])

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="h-full w-full" />
      {source === 'OpenStreetMap' && (
        <p className="pointer-events-none absolute bottom-1 left-1 rounded bg-white/80 px-1 text-[10px] text-neutral-600">
          Ola Maps unavailable · showing OpenStreetMap
        </p>
      )}
    </div>
  )
}
