import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useLiveUpdates } from '../lib/live'
import { useSession } from '../lib/session'
import { ErrorText } from '../components/ui'

/**
 * Setting up an account, step by step (the API says which step is next):
 *   profile → verify (SMS code) → driver (licence, vehicle, insurance, documents) → pending → ready
 */
export default function Onboarding() {
  const { me, refreshMe, signOut } = useSession()
  const navigate = useNavigate()
  const next = me?.next

  useEffect(() => {
    if (next === 'ready') navigate('/home', { replace: true })
  }, [next, navigate])

  // Waiting for approval: the screen updates by itself when an admin decides.
  useLiveUpdates(() => {
    if (next === 'pending') refreshMe()
  })

  if (!me) return null
  return (
    <div className="h-full overflow-y-auto px-6 pb-10 pt-8">
      <div className="mb-6 flex items-center justify-between">
        <p className="text-2xl font-bold tracking-tight">RideShare</p>
        <button className="text-sm text-neutral-500 underline" onClick={signOut}>
          Sign out
        </button>
      </div>
      {next === 'profile' && <ProfileStep me={me} onSaved={refreshMe} />}
      {next === 'verify' && <VerifyStep me={me} onSaved={refreshMe} />}
      {(next === 'driver' || next === 'rejected') && <DriverStep me={me} onSaved={refreshMe} />}
      {next === 'pending' && <PendingStep me={me} />}
    </div>
  )
}

function Steps({ current }) {
  const steps = ['About you', 'Phone', 'Vehicle', 'Approval']
  return (
    <ol className="mb-6 flex gap-1">
      {steps.map((step, index) => (
        <li key={step} className="flex-1">
          <div className={`h-1 rounded-full ${index <= current ? 'bg-black' : 'bg-neutral-200'}`} />
          <p className="mt-1 text-[11px] text-neutral-500">{step}</p>
        </li>
      ))}
    </ol>
  )
}

function ProfileStep({ me, onSaved }) {
  const [role, setRole] = useState(me.user.role || '')
  const [name, setName] = useState(me.user.name || '')
  const [phone, setPhone] = useState((me.user.phone || '').replace(/^\+91/, ''))
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api('/onboarding/profile', { method: 'POST', body: { role, name, phone } })
      await onSaved()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit}>
      <Steps current={0} />
      <h1 className="mb-1 text-2xl font-semibold">Welcome{me.user.name ? `, ${me.user.name.split(' ')[0]}` : ''}!</h1>
      <p className="mb-6 text-neutral-600">How will you use RideShare?</p>
      <div className="mb-5 grid grid-cols-2 gap-3">
        {[
          ['rider', 'ri-user-location-line', 'Ride', 'Book bikes, autos and cars'],
          ['driver', 'ri-steering-2-line', 'Drive', 'Earn by giving rides'],
        ].map(([value, icon, label, hint]) => (
          <button
            key={value}
            type="button"
            disabled={Boolean(me.user.role) && me.user.role !== value}
            aria-pressed={role === value}
            onClick={() => setRole(value)}
            className={`rounded-2xl border-2 p-4 text-left transition disabled:opacity-40 ${role === value ? 'border-black bg-neutral-50' : 'border-neutral-200'}`}
          >
            <i className={`${icon} text-2xl`} />
            <p className="mt-2 font-semibold">{label}</p>
            <p className="text-xs text-neutral-500">{hint}</p>
          </button>
        ))}
      </div>
      <label className="label" htmlFor="name">
        Full name
      </label>
      <input id="name" className="input mb-4" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
      <label className="label" htmlFor="phone">
        Mobile number
      </label>
      <div className="mb-2 flex gap-2">
        <span className="input w-auto shrink-0">+91</span>
        <input id="phone" className="input" inputMode="tel" placeholder="98765 43210" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel-national" required />
      </div>
      <p className="mb-6 text-xs text-neutral-500">We&apos;ll text you a code to confirm it.</p>
      <ErrorText error={error} />
      <button className="btn-primary mt-2 w-full" disabled={busy || !role}>
        Continue
      </button>
    </form>
  )
}

function VerifyStep({ me, onSaved }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api('/onboarding/verify', { method: 'POST', body: { code } })
      await onSaved()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  async function resend() {
    setError(null)
    try {
      await api('/onboarding/resend', { method: 'POST' })
      await onSaved()
      setNotice('A new code is on its way.')
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <form onSubmit={submit}>
      <Steps current={1} />
      <h1 className="mb-1 text-2xl font-semibold">Enter the code</h1>
      <p className="mb-6 text-neutral-600">We sent a 6-digit code to {me.user.phone}.</p>
      {me.devSms && <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">Development: {me.devSms}</p>}
      <input
        className="input mb-4 text-center font-mono text-2xl tracking-[0.5em]"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
        aria-label="SMS code"
      />
      <ErrorText error={error} />
      {notice && <p className="mt-2 text-sm text-green-700">{notice}</p>}
      <button className="btn-primary mt-4 w-full" disabled={busy || code.length !== 6}>
        Verify
      </button>
      <button type="button" className="mt-3 w-full py-2 text-sm underline" onClick={resend}>
        Send a new code
      </button>
    </form>
  )
}

const today = () => new Date().toISOString().slice(0, 10)

function DriverStep({ me, onSaved }) {
  const driver = me.driver
  const [fields, setFields] = useState({
    licenseNumber: driver?.licenseNumber || '',
    licenseExpiry: driver?.licenseExpiry || '',
    vehicleType: driver?.vehicle.type || 'car',
    vehicleMake: driver?.vehicle.make || '',
    vehicleModel: driver?.vehicle.model || '',
    vehicleYear: driver?.vehicle.year || '',
    vehicleColor: driver?.vehicle.color || '',
    vehiclePlate: driver?.vehicle.plate || '',
    insuranceExpiry: driver?.insuranceExpiry || '',
  })
  const [files, setFiles] = useState({})
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (key) => (e) => setFields({ ...fields, [key]: e.target.value })
  const resubmitting = Boolean(driver)

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const form = new FormData()
    for (const [key, value] of Object.entries(fields)) form.set(key, value)
    for (const [key, file] of Object.entries(files)) if (file) form.set(key, file)
    try {
      await api('/onboarding/driver', { method: 'POST', form })
      await onSaved()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  const fileInput = (key, label) => (
    <label className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-neutral-300 px-4 py-3">
      <span>
        <span className="block font-medium">{label}</span>
        <span className="block text-xs text-neutral-500">{files[key]?.name || (resubmitting ? 'Uploaded · choose a file to replace' : 'Photo (JPG/PNG) or PDF, up to 8 MB')}</span>
      </span>
      <i className="ri-upload-2-line text-xl" />
      <input
        type="file"
        accept="image/jpeg,image/png,application/pdf"
        className="sr-only"
        required={!resubmitting}
        onChange={(e) => setFiles({ ...files, [key]: e.target.files?.[0] || null })}
      />
    </label>
  )

  return (
    <form onSubmit={submit}>
      <Steps current={2} />
      <h1 className="mb-1 text-2xl font-semibold">Your licence and vehicle</h1>
      <p className="mb-6 text-neutral-600">We check these before you can go online.</p>
      {driver?.verificationStatus === 'rejected' && (
        <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          Changes needed: {driver.rejectionReason}. Update the details below and submit again.
        </p>
      )}

      <h2 className="mb-2 font-semibold">Driving licence</h2>
      <label className="label" htmlFor="licenseNumber">
        Licence number
      </label>
      <input id="licenseNumber" className="input mb-3 uppercase" placeholder="MH02 20190012345" value={fields.licenseNumber} onChange={set('licenseNumber')} required />
      <label className="label" htmlFor="licenseExpiry">
        Valid until
      </label>
      <input id="licenseExpiry" type="date" min={today()} className="input mb-3" value={fields.licenseExpiry} onChange={set('licenseExpiry')} required />
      {fileInput('licenseDoc', 'Photo of your licence')}

      <h2 className="mb-2 mt-6 font-semibold">Vehicle</h2>
      <div className="mb-3 grid grid-cols-3 gap-2">
        {[
          ['bike', 'ri-motorbike-fill', 'Bike'],
          ['auto', 'ri-taxi-fill', 'Auto'],
          ['car', 'ri-car-fill', 'Car'],
        ].map(([value, icon, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={fields.vehicleType === value}
            onClick={() => setFields({ ...fields, vehicleType: value })}
            className={`rounded-xl border-2 py-3 ${fields.vehicleType === value ? 'border-black' : 'border-neutral-200'}`}
          >
            <i className={`${icon} text-xl`} />
            <p className="text-sm font-medium">{label}</p>
          </button>
        ))}
      </div>
      <div className="mb-3 grid grid-cols-2 gap-2">
        <div>
          <label className="label" htmlFor="vehicleMake">
            Make
          </label>
          <input id="vehicleMake" className="input" placeholder="Maruti" value={fields.vehicleMake} onChange={set('vehicleMake')} required />
        </div>
        <div>
          <label className="label" htmlFor="vehicleModel">
            Model
          </label>
          <input id="vehicleModel" className="input" placeholder="Swift" value={fields.vehicleModel} onChange={set('vehicleModel')} required />
        </div>
        <div>
          <label className="label" htmlFor="vehicleYear">
            Year
          </label>
          <input id="vehicleYear" className="input" inputMode="numeric" placeholder="2021" value={fields.vehicleYear} onChange={set('vehicleYear')} required />
        </div>
        <div>
          <label className="label" htmlFor="vehicleColor">
            Colour
          </label>
          <input id="vehicleColor" className="input" placeholder="White" value={fields.vehicleColor} onChange={set('vehicleColor')} />
        </div>
      </div>
      <label className="label" htmlFor="vehiclePlate">
        Registration (RC) number
      </label>
      <input id="vehiclePlate" className="input mb-3 uppercase" placeholder="MH 02 AB 1234" value={fields.vehiclePlate} onChange={set('vehiclePlate')} required />
      {fileInput('rcDoc', 'Photo of the RC')}

      <h2 className="mb-2 mt-6 font-semibold">Insurance</h2>
      <label className="label" htmlFor="insuranceExpiry">
        Valid until
      </label>
      <input id="insuranceExpiry" type="date" min={today()} className="input mb-3" value={fields.insuranceExpiry} onChange={set('insuranceExpiry')} required />
      {fileInput('insuranceDoc', 'Insurance certificate')}

      <ErrorText error={error} />
      <button className="btn-primary mt-6 w-full" disabled={busy}>
        {busy ? 'Uploading…' : 'Submit for approval'}
      </button>
    </form>
  )
}

function PendingStep({ me }) {
  return (
    <div>
      <Steps current={3} />
      <div className="mt-10 text-center">
        <i className="ri-time-line text-5xl" />
        <h1 className="mt-3 text-2xl font-semibold">We&apos;re checking your documents</h1>
        <p className="mt-2 text-neutral-600">
          This usually takes a few hours. This screen updates by itself, and we&apos;ll text {me.user.phone} when you&apos;re approved.
        </p>
        <div className="mt-6 rounded-2xl bg-neutral-50 p-4 text-left text-sm">
          <p>
            <span className="text-neutral-500">Vehicle:</span> {me.driver?.vehicle.color} {me.driver?.vehicle.make} {me.driver?.vehicle.model} ({me.driver?.vehicle.year})
          </p>
          <p>
            <span className="text-neutral-500">Registration:</span> {me.driver?.vehicle.plate}
          </p>
          <p>
            <span className="text-neutral-500">Licence:</span> {me.driver?.licenseNumber}
          </p>
        </div>
      </div>
    </div>
  )
}
