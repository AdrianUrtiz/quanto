import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Client Cache: volver a una tab visitada reutiliza el RSC sin refetch.
  // `dynamic: 120` = 2 min para páginas dinámicas (Actividad/Resumen/Cuentas);
  // `static: 300` = 5 min para segmentos estáticos. La frescura de datos la
  // garantiza Dexie-first + revalidación del snapshot en background.
  experimental: {
    staleTimes: {
      dynamic: 120,
      static: 300,
    },
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
      {
        source: '/sw.js',
        headers: [
          {
            key: 'Content-Type',
            value: 'application/javascript; charset=utf-8',
          },
          {
            key: 'Cache-Control',
            value: 'no-cache, no-store, must-revalidate',
          },
        ],
      },
    ]
  },
}

export default nextConfig
