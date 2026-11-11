// Mumbai, until the browser reports a location.
export const DEFAULT_CENTER = { lat: 19.076, lng: 72.8777 }

export const rupees = (amount) => `₹${Math.round(Number(amount) || 0).toLocaleString('en-IN')}`

export function dateTime(value) {
  if (!value) return ''
  // SQLite times are UTC without a zone ("2026-11-11 08:30:00").
  const date = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value.replace(' ', 'T')}Z`)
  return date.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
}

export const firstName = (name) => (name || '').split(' ')[0] || 'Someone'

export const shortPlace = (name) => (name || '').split(',')[0]

export const VEHICLE_ICONS = { bike: 'ri-motorbike-fill', auto: 'ri-taxi-fill', car: 'ri-car-fill' }

export function vehicleText(vehicle) {
  if (!vehicle) return ''
  return [vehicle.color, vehicle.make, vehicle.model].filter(Boolean).join(' ')
}

/** "Peak hours ×1.5" style label, or null for normal pricing. */
export function pricingBadge(pricing) {
  if (!pricing || pricing.segment === 'normal') return null
  return `${pricing.label} ×${pricing.multiplier}`
}

/** Opens Google Maps directions to a point (the driver's own navigation app). */
export const directionsUrl = (point) =>
  `https://www.google.com/maps/dir/?api=1&destination=${point.lat},${point.lng}&travelmode=driving`
