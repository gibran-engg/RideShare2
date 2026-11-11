import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // The Ola Maps SDK (MapLibre) copies its own code into a Web Worker. Down-levelling class
  // fields adds a __publicField helper the worker can't see, so keep modern syntax.
  optimizeDeps: {
    esbuildOptions: { target: 'es2022' },
  },
  build: {
    target: 'es2022',
  },
})
