import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import Script from 'next/script'

import { Providers } from '@/components/providers'

import './globals.css'

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] })
const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

// Dominio de producción (Vercel lo inyecta en build); en local cae a localhost.
// Se usa para absolutizar las URLs de Open Graph / Twitter.
const siteUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : 'http://localhost:3000'

const siteDescription =
  'Control de gastos personales y en pareja: MSI, compartidos y cuentas.'

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: 'Quanto — Gastos en pareja', template: '%s · Quanto' },
  description: siteDescription,
  applicationName: 'Quanto',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Quanto',
  },
  formatDetection: { telephone: false },
  openGraph: {
    type: 'website',
    locale: 'es_MX',
    siteName: 'Quanto',
    title: 'Quanto — Gastos en pareja',
    description: siteDescription,
    images: [
      {
        url: '/icons/Web/og.png',
        width: 1200,
        height: 630,
        alt: 'Quanto — Gastos en pareja',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Quanto — Gastos en pareja',
    description: siteDescription,
    images: ['/icons/Web/og.png'],
  },
  icons: {
    icon: [
      { url: '/icons/Web/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/icons/Web/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      {
        url: '/icons/Web/android-chrome-192x192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        url: '/icons/Web/android-chrome-512x512.png',
        sizes: '512x512',
        type: 'image/png',
      },
    ],
    shortcut: [
      {
        url: '/favicon.ico',
        sizes: '16x16 32x32 48x48',
        type: 'image/x-icon',
      },
    ],
    apple: [
      {
        url: '/icons/Web/apple-touch-icon.png',
        sizes: '180x180',
        type: 'image/png',
      },
    ],
  },
  other: {
    'mobile-web-app-capable': 'yes',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
  interactiveWidget: 'resizes-content',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f4f4f5' },
    { media: '(prefers-color-scheme: dark)', color: '#09090b' },
  ],
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="es"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full`}>
      <body className="min-h-full bg-(--background) text-(--foreground) antialiased">
        <Script id="theme-init" strategy="beforeInteractive">
          {`try{var t=localStorage.getItem("quanto-theme")||"dark";var r=t==="system"?(window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):t;if(r==="dark"){document.documentElement.classList.add("dark")}else{document.documentElement.classList.remove("dark")}document.documentElement.style.colorScheme=r;}catch(e){}`}
        </Script>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
