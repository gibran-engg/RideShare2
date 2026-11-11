import { Navigate, Route, Routes } from 'react-router-dom'
import { useSession } from './lib/session'
import AuthCallback from './pages/AuthCallback'
import DriverHome from './pages/DriverHome'
import History from './pages/History'
import Onboarding from './pages/Onboarding'
import Receipt from './pages/Receipt'
import RiderHome from './pages/RiderHome'
import SavedPlaces from './pages/SavedPlaces'
import Track from './pages/Track'
import Welcome from './pages/Welcome'

function Loading() {
  return <div className="flex h-full items-center justify-center text-neutral-500">Loading…</div>
}

/** Signed in, and finished onboarding (drivers: approved). Otherwise sends you where you need to be. */
function Ready({ children }) {
  const { status, me } = useSession()
  if (status === 'loading') return <Loading />
  if (status === 'signed-out') return <Navigate to="/" replace />
  if (me.next !== 'ready') return <Navigate to="/onboarding" replace />
  return children
}

function SignedIn({ children }) {
  const { status } = useSession()
  if (status === 'loading') return <Loading />
  if (status === 'signed-out') return <Navigate to="/" replace />
  return children
}

function Start() {
  const { status, me } = useSession()
  if (status === 'loading') return <Loading />
  if (status === 'signed-out') return <Welcome />
  return <Navigate to={me.next === 'ready' ? '/home' : '/onboarding'} replace />
}

function Home() {
  const { me } = useSession()
  return me.user.role === 'driver' ? <DriverHome /> : <RiderHome />
}

export default function App() {
  return (
    <div className="app-frame">
      <Routes>
        <Route path="/" element={<Start />} />
        <Route path="/auth" element={<AuthCallback />} />
        <Route path="/track/:token" element={<Track />} />
        <Route
          path="/onboarding"
          element={
            <SignedIn>
              <Onboarding />
            </SignedIn>
          }
        />
        <Route
          path="/home"
          element={
            <Ready>
              <Home />
            </Ready>
          }
        />
        <Route
          path="/history"
          element={
            <Ready>
              <History />
            </Ready>
          }
        />
        <Route
          path="/places"
          element={
            <Ready>
              <SavedPlaces />
            </Ready>
          }
        />
        <Route
          path="/receipt/:id"
          element={
            <Ready>
              <Receipt />
            </Ready>
          }
        />
        {/* Where the test-mode card/UPI checkout sends the rider back to. */}
        <Route path="/trips/:id" element={<Navigate to="/home" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  )
}
