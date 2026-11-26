import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Tauri espera un puerto fijo y no debe vigilar src-tauri.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true, watch: { ignored: ['**/src-tauri/**'] } },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: { target: 'es2022' },
})
