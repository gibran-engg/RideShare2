import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The API (Backend/, `npm run dev`) listens on port 3000.
const API = process.env.API_URL || 'http://localhost:3000'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Must stay localhost:5173: it's the sign-in redirect registered with Auth0 and the dev sign-in.
    port: 5173,
    strictPort: true,
    // API calls and live updates go through Vite, so the browser never needs CORS for the API.
    proxy: {
      '/api': API,
      '/ws': { target: API, ws: true },
      // The test-mode card/UPI checkout page.
      '/pay': API,
    },
  },
  // The Ola Maps SDK (MapLibre) copies its own code into a Web Worker. Down-levelling class
  // fields adds a __publicField helper the worker can't see, so keep modern syntax.
  optimizeDeps: {
    esbuildOptions: { target: 'es2022' },
  },
  build: {
    target: 'es2022',
  },
})
