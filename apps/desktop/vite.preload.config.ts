import path from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/preload/index.ts'),
      formats: ['cjs'],
      fileName: () => 'index.js',
    },
    outDir: path.resolve(__dirname, 'dist/preload'),
    emptyOutDir: false,
    rollupOptions: {
      external: ['electron'],
    },
  },
})
