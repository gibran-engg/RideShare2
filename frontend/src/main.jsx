import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import 'remixicon/fonts/remixicon.css'
import './index.css'
import App from './App.jsx'
import { SessionProvider } from './lib/session.jsx'

createRoot(document.getElementById('root')).render(
  <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
    <SessionProvider>
      <App />
    </SessionProvider>
  </BrowserRouter>,
)
