import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173
  },
  build: {
    // Keep PDF-related libraries isolated without forcing circular vendor chunks.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes('node_modules') &&
            (id.includes('jspdf') ||
              id.includes('html2canvas') ||
              id.includes('purify') ||
              id.includes('html2pdf'))
          ) {
            return 'vendor-heavy'
          }
        }
      }
    },
    chunkSizeWarningLimit: 700
  }
})
