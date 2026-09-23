import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Local dev against a deployed stack:
//   VITE_API_ORIGIN=https://dxxxx.cloudfront.net npm run dev
// proxies /api/* and /files/* so the app code always uses relative URLs.
// Direct-to-S3 uploads from localhost:5173 are allowed by the bucket CORS (extra_upload_origins).
const target = process.env.VITE_API_ORIGIN;

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: target
      ? {
          '/api': { target, changeOrigin: true },
          '/files': { target, changeOrigin: true },
        }
      : undefined,
  },
});
